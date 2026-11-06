// Turns two texts into aligned side-by-side rows with word-level highlights.
// Loaded as a plain script in the renderer and via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('diff'));
  } else {
    root.DiffEngine = factory(root.Diff);
  }
})(typeof self !== 'undefined' ? self : this, function (Diff) {
  // Below this share of common words, two lines are treated as unrelated and
  // highlighted whole instead of word by word.
  const MIN_SIMILARITY = 0.3;
  // Texts with next to nothing in common can take very long to line up; past
  // this many milliseconds their lines are compared by position instead.
  const DIFF_TIMEOUT = 3000;
  // The same for the words of a single, very long line, which is then
  // highlighted whole.
  const WORD_TIMEOUT = 200;

  const TOKEN_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

  function splitLines(text) {
    if (text === '') return [];
    const lines = text.split(/\r\n|\r|\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  function lineKey(line, opts) {
    let key = line;
    if (opts.ignoreWhitespace) key = key.trim().replace(/\s+/g, ' ');
    if (opts.ignoreCase) key = key.toLowerCase();
    return key;
  }

  // Diff parts that pair the items of two key arrays by position: equal keys
  // stay equal, the others count as removed and added.
  function partsInOrder(leftKeys, rightKeys) {
    const parts = [];
    const push = (kind, count) => {
      const last = parts[parts.length - 1];
      if (last && last.kind === kind) last.count += count;
      else parts.push({ kind, count, removed: kind === 'removed', added: kind === 'added' });
    };
    const common = Math.min(leftKeys.length, rightKeys.length);
    for (let i = 0; i < common; i++) {
      if (leftKeys[i] === rightKeys[i]) {
        push('equal', 1);
      } else {
        push('removed', 1);
        push('added', 1);
      }
    }
    if (leftKeys.length > common) push('removed', leftKeys.length - common);
    if (rightKeys.length > common) push('added', rightKeys.length - common);
    return parts;
  }

  // Runs a diff over two key arrays and returns, per side, which indexes have
  // no counterpart on the other side, or null when that took too long.
  function changedFlags(leftKeys, rightKeys) {
    const parts = Diff.diffArrays(leftKeys, rightKeys, { timeout: WORD_TIMEOUT });
    if (!parts) return null;
    const left = new Array(leftKeys.length).fill(false);
    const right = new Array(rightKeys.length).fill(false);
    let l = 0;
    let r = 0;
    for (const part of parts) {
      if (part.removed) {
        for (let i = 0; i < part.count; i++) left[l++] = true;
      } else if (part.added) {
        for (let i = 0; i < part.count; i++) right[r++] = true;
      } else {
        l += part.count;
        r += part.count;
      }
    }
    return { left, right };
  }

  function toSegments(tokens, flags) {
    const segments = [];
    for (let i = 0; i < tokens.length; i++) {
      const last = segments[segments.length - 1];
      if (last && last.changed === flags[i]) last.text += tokens[i];
      else segments.push({ text: tokens[i], changed: flags[i] });
    }
    return segments;
  }

  function plain(text) {
    return text === '' ? [] : [{ text, changed: false }];
  }

  function whole(text) {
    return text === '' ? [] : [{ text, changed: true }];
  }

  function diffWords(leftLine, rightLine, opts) {
    const sides = [leftLine, rightLine].map((line) => {
      const tokens = line.match(TOKEN_RE) || [];
      // Indexes of the tokens that take part in the comparison.
      const compared = [];
      tokens.forEach((token, i) => {
        if (!(opts.ignoreWhitespace && /^\s/.test(token))) compared.push(i);
      });
      const keys = compared.map((i) => (opts.ignoreCase ? tokens[i].toLowerCase() : tokens[i]));
      return { tokens, compared, keys };
    });

    const flags = changedFlags(sides[0].keys, sides[1].keys);
    if (!flags) return { left: whole(leftLine), right: whole(rightLine) };
    const words = (side) => side.keys.filter((key) => !/^\s/.test(key)).length;
    const commonWords = (side, sideFlags) =>
      side.keys.filter((key, i) => !sideFlags[i] && !/^\s/.test(key)).length;
    const total = words(sides[0]) + words(sides[1]);
    const similarity =
      total === 0 ? 1 : (commonWords(sides[0], flags.left) + commonWords(sides[1], flags.right)) / total;

    if (similarity < MIN_SIMILARITY) {
      return { left: whole(leftLine), right: whole(rightLine) };
    }

    const expand = (side, sideFlags) => {
      const tokenFlags = new Array(side.tokens.length).fill(false);
      side.compared.forEach((tokenIndex, i) => {
        tokenFlags[tokenIndex] = sideFlags[i];
      });
      return toSegments(side.tokens, tokenFlags);
    };
    return { left: expand(sides[0], flags.left), right: expand(sides[1], flags.right) };
  }

  // A line with nothing but whitespace on it, which only spaces the text out.
  const isBlank = (line) => !/\S/.test(line);

  // Lines the comparison puts side by side, as rows: { type, left, right },
  // with `type` one of equal, changed, removed and added, and each side
  // { num, segments } or null. Only the lines with text on them are
  // compared, so that paragraphs line up however many blank lines there are
  // between them. The blank lines are put back, side by side, and never
  // count as differences: where one side has fewer of them, an equal row
  // has null on that side, which stays empty so that the lines after it
  // still line up.
  function compare(leftText, rightText, options) {
    const opts = { ignoreCase: false, ignoreWhitespace: false, ...options };
    const leftLines = splitLines(leftText);
    const rightLines = splitLines(rightText);
    // The indexes of the lines with text on them.
    const textLines = (lines) => lines.flatMap((line, i) => (isBlank(line) ? [] : [i]));
    const leftTexts = textLines(leftLines);
    const rightTexts = textLines(rightLines);
    const leftKeys = leftTexts.map((i) => lineKey(leftLines[i], opts));
    const rightKeys = rightTexts.map((i) => lineKey(rightLines[i], opts));
    const parts =
      Diff.diffArrays(leftKeys, rightKeys, { timeout: DIFF_TIMEOUT }) || partsInOrder(leftKeys, rightKeys);

    const rows = [];
    const stats = { changed: 0, removed: 0, added: 0 };
    // The next line of each side to show.
    let l = 0;
    let r = 0;
    // The next line of each side with text on it, of leftTexts and rightTexts.
    let lt = 0;
    let rt = 0;
    let pendingRemoved = 0;
    let pendingAdded = 0;

    const line = (lines, i) => ({ num: i + 1, segments: plain(lines[i]) });

    // Shows the blank lines before the next row of text, on the sides it has
    // (`onLeft`, `onRight`). A side the row doesn't have shows as many of its
    // own blank lines as fit beside those, and keeps the rest for its next
    // line of text.
    const space = (onLeft, onRight) => {
      const leftBlanks = (lt < leftTexts.length ? leftTexts[lt] : leftLines.length) - l;
      const rightBlanks = (rt < rightTexts.length ? rightTexts[rt] : rightLines.length) - r;
      const count = Math.max(onLeft ? leftBlanks : 0, onRight ? rightBlanks : 0);
      for (let i = 0; i < count; i++) {
        rows.push({
          type: 'equal',
          left: i < leftBlanks ? line(leftLines, l++) : null,
          right: i < rightBlanks ? line(rightLines, r++) : null,
        });
      }
    };

    // A run of removed lines followed by added lines is shown as changed
    // lines, paired in order; whatever is left over stays removed or added.
    const flush = () => {
      const paired = Math.min(pendingRemoved, pendingAdded);
      for (let i = 0; i < paired; i++) {
        space(true, true);
        const words = diffWords(leftLines[l], rightLines[r], opts);
        rows.push({
          type: 'changed',
          left: { num: l + 1, segments: words.left },
          right: { num: r + 1, segments: words.right },
        });
        l++;
        r++;
        lt++;
        rt++;
      }
      for (let i = paired; i < pendingRemoved; i++) {
        space(true, false);
        rows.push({ type: 'removed', left: line(leftLines, l++), right: null });
        lt++;
      }
      for (let i = paired; i < pendingAdded; i++) {
        space(false, true);
        rows.push({ type: 'added', left: null, right: line(rightLines, r++) });
        rt++;
      }
      stats.changed += paired;
      stats.removed += pendingRemoved - paired;
      stats.added += pendingAdded - paired;
      pendingRemoved = 0;
      pendingAdded = 0;
    };

    for (const part of parts) {
      if (part.removed) {
        pendingRemoved += part.count;
      } else if (part.added) {
        pendingAdded += part.count;
      } else {
        flush();
        for (let i = 0; i < part.count; i++) {
          space(true, true);
          rows.push({ type: 'equal', left: line(leftLines, l++), right: line(rightLines, r++) });
          lt++;
          rt++;
        }
      }
    }
    flush();
    // The blank lines after the last line of text.
    space(true, true);

    return { rows, stats };
  }

  // Which rows "Differences only" hides: the equal ones more than `context`
  // rows away from any difference. Works for the rows of TableDiff too.
  function hiddenRows(rows, context) {
    const hidden = rows.map((row) => row.type === 'equal');
    let last = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].type !== 'equal') last = i;
      else if (i - last <= context) hidden[i] = false;
    }
    last = Infinity;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].type !== 'equal') last = i;
      else if (last - i <= context) hidden[i] = false;
    }
    return hidden;
  }

  return { compare, hiddenRows };
});
