// Carries a text comparison over to the documents it was made from, for the
// document view. The comparison is of the text read from each file; the
// view shows the file itself, whose text breaks its lines elsewhere and may
// have more of it, such as page headers. The two are lined up character by
// character, leaving out whitespace. Loaded as a plain script in the
// renderer and via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('diff'));
  } else {
    root.DocAlign = factory(root.Diff);
  }
})(typeof self !== 'undefined' ? self : this, function (Diff) {
  // Lining up two readings of a document gives up on the stretches where
  // they differ after this many milliseconds in all.
  const TIME_BUDGET = 3000;

  // Start of every line of a text, as DiffEngine numbers them from 1.
  function lineStarts(text) {
    const starts = [0];
    for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
    return starts;
  }

  // What the rows of DiffEngine.compare() mark on one side (`left` or
  // `right`) of the comparison, as places in that side's text:
  // - `ranges`: [{ start, end, block }], the lines removed or added and the
  //   changed words of changed lines, words with only spaces between them
  //   taken together; `block` numbers the runs of differing rows, as the
  //   navigator counts them.
  // - `anchors`: per run, the place to show for it: its first marked
  //   stretch, else its first line, else where the other side's lines would
  //   go in.
  function changes(rows, text, side) {
    const starts = lineStarts(text);
    const lineStart = (num) => starts[num - 1] ?? text.length;
    const ranges = [];
    const anchors = [];
    let block = -1;
    let previous = 'equal';
    // The line on this side after the last one seen.
    let nextLine = 1;
    // Per run: its first line on this side, then its first marked stretch.
    let firstLine = null;
    let firstRange = null;
    let insertion = 0;
    const closeBlock = () => {
      if (block >= 0) anchors[block] = firstRange ?? firstLine ?? insertion;
    };
    for (const row of rows) {
      const part = row[side];
      if (row.type !== 'equal' && previous === 'equal') {
        closeBlock();
        block++;
        firstLine = null;
        firstRange = null;
        insertion = lineStart(nextLine);
      }
      previous = row.type;
      if (!part) continue;
      nextLine = part.num + 1;
      if (row.type === 'equal') continue;
      let offset = lineStart(part.num);
      firstLine ??= offset;
      const lineRanges = ranges.length;
      for (const segment of part.segments) {
        const end = offset + segment.text.length;
        if ((row.type !== 'changed' || segment.changed) && end > offset) {
          const last = ranges[ranges.length - 1];
          if (ranges.length > lineRanges && /^[^\S\r\n]*$/.test(text.slice(last.end, offset))) last.end = end;
          else ranges.push({ start: offset, end, block });
          firstRange ??= offset;
        }
        offset = end;
      }
    }
    closeBlock();
    return { ranges, anchors };
  }

  // Places that correspond on the two sides: the start of every pair of
  // lines the comparison put side by side, as [left, right].
  function syncPoints(rows, leftText, rightText) {
    const left = lineStarts(leftText);
    const right = lineStarts(rightText);
    const points = [];
    for (const row of rows) {
      if (row.left && row.right) points.push([left[row.left.num - 1], right[row.right.num - 1]]);
    }
    return points;
  }

  // Characters left out when lining up: whitespace, control characters,
  // soft hyphens and zero-width characters.
  function isSkipped(code) {
    if (code <= 32) return true;
    if (code < 0xa0) return false;
    return (
      code === 0xa0 ||
      code === 0xad ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200d) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x202f ||
      code === 0x205f ||
      code === 0x2060 ||
      code === 0x3000 ||
      code === 0xfeff
    );
  }

  // A text without the skipped characters: `chars`, where each of them was
  // (`pos`), and where each line and each word starts among them (`lines`,
  // `words`). Every line starts a word.
  function project(text) {
    const codes = new Uint16Array(text.length);
    const pos = new Int32Array(text.length);
    const lines = [];
    const words = [];
    let count = 0;
    let lineBreak = true;
    let wordBreak = true;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 10 || code === 13) lineBreak = true;
      if (isSkipped(code)) {
        wordBreak = true;
        continue;
      }
      if (lineBreak) lines.push(count);
      if (wordBreak) words.push(count);
      lineBreak = wordBreak = false;
      codes[count] = code;
      pos[count] = i;
      count++;
    }
    let chars = '';
    for (let i = 0; i < count; i += 8192) {
      chars += String.fromCharCode.apply(null, codes.subarray(i, Math.min(count, i + 8192)));
    }
    return { chars, pos: pos.subarray(0, count), lines, words };
  }

  // Lines up `source` and `target`, which are two readings of the same
  // document: line by line, then word by word where lines differ, then
  // character by character where words do. Fills `map` with the index in
  // target.chars of each of source.chars, or leaves it at -1.
  function lineUp(source, target, map) {
    const deadline = Date.now() + TIME_BUDGET;
    const LEVELS = ['lines', 'words'];

    // The chunks of [a, b), cut where `starts` says: their bounds and text.
    const chunks = (projection, starts, a, b) => {
      const bounds = [a];
      for (let i = lowerBound(starts, a + 1); i < starts.length && starts[i] < b; i++) bounds.push(starts[i]);
      bounds.push(b);
      const keys = [];
      for (let i = 0; i + 1 < bounds.length; i++) keys.push(projection.chars.slice(bounds[i], bounds[i + 1]));
      return { bounds, keys };
    };

    // Character by character, from both ends in, then the middle.
    const byChar = (a0, a1, b0, b1) => {
      while (a0 < a1 && b0 < b1 && source.chars[a0] === target.chars[b0]) map[a0++] = b0++;
      while (a1 > a0 && b1 > b0 && source.chars[a1 - 1] === target.chars[b1 - 1]) map[--a1] = --b1;
      const timeout = deadline - Date.now();
      if (a0 === a1 || b0 === b1 || timeout <= 0) return;
      const parts = Diff.diffArrays(source.chars.slice(a0, a1).split(''), target.chars.slice(b0, b1).split(''), {
        timeout,
      });
      if (!parts) return;
      for (const part of parts) {
        if (part.removed) a0 += part.count;
        else if (part.added) b0 += part.count;
        else for (let k = 0; k < part.count; k++) map[a0++] = b0++;
      }
    };

    // Lines up [a0, a1) of the source with [b0, b1) of the target in chunks
    // of LEVELS[level], and what differs in finer ones.
    const span = (a0, a1, b0, b1, level) => {
      if (a0 >= a1 || b0 >= b1) return;
      if (level === LEVELS.length) {
        byChar(a0, a1, b0, b1);
        return;
      }
      const s = chunks(source, source[LEVELS[level]], a0, a1);
      const t = chunks(target, target[LEVELS[level]], b0, b1);
      // Comparing chunks only pays off when most have a match; when they
      // don't, the two are cut up differently and finer chunks do better.
      const targetKeys = new Set(t.keys);
      const shared = s.keys.reduce((sum, key) => sum + (targetKeys.has(key) ? 1 : 0), 0);
      const timeout = deadline - Date.now();
      const parts =
        shared * 2 >= Math.min(s.keys.length, t.keys.length) && timeout > 0
          ? Diff.diffArrays(s.keys, t.keys, { timeout })
          : null;
      if (!parts) {
        span(a0, a1, b0, b1, level + 1);
        return;
      }
      // Chunks in each where the stretch since the last equal chunk began.
      let i = 0;
      let j = 0;
      let fromI = 0;
      let fromJ = 0;
      for (const part of parts) {
        if (part.removed) {
          i += part.count;
        } else if (part.added) {
          j += part.count;
        } else {
          span(s.bounds[fromI], s.bounds[i], t.bounds[fromJ], t.bounds[j], level + 1);
          const a = s.bounds[i];
          const b = t.bounds[j];
          const length = s.bounds[i + part.count] - a;
          for (let k = 0; k < length; k++) map[a + k] = b + k;
          i += part.count;
          j += part.count;
          fromI = i;
          fromJ = j;
        }
      }
      span(s.bounds[fromI], a1, t.bounds[fromJ], b1, level + 1);
    };

    span(0, source.chars.length, 0, target.chars.length, 0);
  }

  // First index in the sorted `array` whose value is at least `value`.
  function lowerBound(array, value) {
    let low = 0;
    let high = array.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (array[mid] < value) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  // Lines up the text that was compared (`source`) with the text of the
  // document on show (`target`). Returns:
  // - ranges(start, end): the stretches of target, as [[start, end]], that
  //   hold the characters of source between `start` and `end`. Whitespace
  //   between characters that follow on from each other is included.
  // - point(offset): the place in target of a place in source, or of the
  //   nearest character after it that has one, else before it.
  // - coverage: the share of source characters found in target.
  function align(sourceText, targetText) {
    const source = project(sourceText);
    const target = project(targetText);
    const count = source.chars.length;
    const map = new Int32Array(count).fill(-1);
    if (source.chars === target.chars) {
      for (let i = 0; i < count; i++) map[i] = i;
    } else {
      lineUp(source, target, map);
    }

    function ranges(start, end) {
      const result = [];
      let first = -1;
      let last = -1;
      const close = () => {
        if (first >= 0) result.push([target.pos[first], target.pos[last] + 1]);
        first = -1;
      };
      for (let k = lowerBound(source.pos, start); k < count && source.pos[k] < end; k++) {
        const j = map[k];
        if (j < 0) {
          close();
        } else if (first >= 0 && j === last + 1) {
          last = j;
        } else {
          close();
          first = last = j;
        }
      }
      close();
      return result;
    }

    // Per source character, the nearest one at or after it that has a
    // counterpart (count when none has), worked out on first use.
    let nextMapped = null;
    function point(offset) {
      if (!nextMapped) {
        nextMapped = new Int32Array(count + 1).fill(count);
        for (let k = count - 1; k >= 0; k--) nextMapped[k] = map[k] >= 0 ? k : nextMapped[k + 1];
      }
      const k = nextMapped[lowerBound(source.pos, offset)];
      if (k < count) return target.pos[map[k]];
      // Nothing after it is in the target; the last that is will do.
      for (let back = count - 1; back >= 0; back--) {
        if (map[back] >= 0) return target.pos[map[back]] + 1;
      }
      return 0;
    }

    let mapped = 0;
    for (let i = 0; i < count; i++) if (map[i] >= 0) mapped++;
    return { ranges, point, coverage: count === 0 ? 1 : mapped / count };
  }

  // Cuts the stretch [start, end) of a document's text into the runs it is
  // made of: the text nodes it is shown in. `runStarts` and `runEnds` are
  // where each run is in the text, in order. Adds { run, start, end } to
  // `out` for each, with start and end within the run, and `extra` mixed in.
  function pieces(start, end, { runStarts, runEnds }, out, extra) {
    for (let i = lowerBound(runEnds, start + 1); i < runStarts.length && runStarts[i] < end; i++) {
      const from = Math.max(start, runStarts[i]);
      const to = Math.min(end, runEnds[i]);
      if (to > from) out.push({ run: i, start: from - runStarts[i], end: to - runStarts[i], ...extra });
    }
    return out;
  }

  // The run that holds a place in a document's text, or the nearest before.
  function runAt(offset, { runStarts }) {
    return Math.max(0, lowerBound(runStarts, offset + 1) - 1);
  }

  return { lineStarts, changes, syncPoints, align, pieces, runAt };
});
