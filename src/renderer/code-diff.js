// Compares two versions of source code line by line, as git and GitHub do.
// Unlike documents, every line counts, blank ones too, and so does a line
// break missing at the end of a file. The changes are shown in hunks with a
// few unchanged lines around them, each with a header that says where it
// is. Loaded as a plain script in the renderer and via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('diff'), require('./diff-engine'));
  } else {
    root.CodeDiff = factory(root.Diff, root.DiffEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (Diff, DiffEngine) {
  // Unchanged lines shown around each change.
  const CONTEXT = 3;
  // How much of the line a hunk's header quotes, as in git.
  const FUNCTION_LENGTH = 80;
  // Added to the key of a last line without a line break, so that it
  // differs from the same line with one.
  const NO_EOL = '\u0000';
  const NO_EOL_NOTE = '\\ No newline at end of file';

  const EQUAL = 0;
  const REMOVED = 1;
  const ADDED = 2;

  const isBlank = (line) => !/\S/.test(line);

  // The lines of a text, and whether the last one ends with a line break.
  // An empty text has no lines, so it misses no line break either.
  function splitLines(text) {
    if (text === '') return { lines: [], eol: true };
    const lines = text.split(/\r\n|\r|\n/);
    const eol = lines[lines.length - 1] === '';
    if (eol) lines.pop();
    return { lines, eol };
  }

  // The diff as one entry per line: EQUAL, REMOVED or ADDED.
  function toOps(parts) {
    const ops = [];
    for (const part of parts) {
      const op = part.removed ? REMOVED : part.added ? ADDED : EQUAL;
      for (let i = 0; i < part.count; i++) ops.push(op);
    }
    return ops;
  }

  // A run of lines only one side has can often be a few lines higher or
  // lower just as well: a function added between two others may take the
  // closing brace of the one before it, or keep its own. Like git's
  // compaction heuristic, each such run goes as far down as it can, or up
  // from there to the nearest place where it ends with a blank line.
  // Moving a run of added lines down a line swaps it with the unchanged line
  // after it, which takes when that line is the same as the run's first.
  function slide(ops, left, right) {
    let p = 0;
    let l = 0;
    let r = 0;
    while (p < ops.length) {
      if (ops[p] === EQUAL) {
        p++;
        l++;
        r++;
        continue;
      }
      let q = p;
      let removed = 0;
      while (q < ops.length && ops[q] !== EQUAL) {
        if (ops[q] === REMOVED) removed++;
        q++;
      }
      const size = q - p;
      // Lines removed and added in the same place stay where they are.
      if (removed > 0 && removed < size) {
        l += removed;
        r += size - removed;
        p = q;
        continue;
      }
      const op = ops[p];
      const { keys, lines } = op === REMOVED ? left : right;
      const start = op === REMOVED ? l : r;
      let up = 0;
      while (p - up > 0 && ops[p - up - 1] === EQUAL && keys[start - up - 1] === keys[start - up + size - 1]) up++;
      let down = 0;
      while (q + down < ops.length && ops[q + down] === EQUAL && keys[start + down] === keys[start + down + size]) {
        down++;
      }
      let shift = down;
      while (shift > -up && !isBlank(lines[start + shift + size - 1])) shift--;
      if (!isBlank(lines[start + shift + size - 1])) shift = down;
      for (let i = p - up; i < q + down; i++) {
        const offset = i - (p - up) - up - shift;
        ops[i] = offset >= 0 && offset < size ? op : EQUAL;
      }
      l += down + (op === REMOVED ? size : 0);
      r += down + (op === ADDED ? size : 0);
      p = q + down;
    }
    return ops;
  }

  // Compares two texts as code. Returns:
  // - left, right: { lines, eol } of each text.
  // - rows: { type, left, right }, with type equal, changed, removed or
  //   added, and each side null or a line { num, text, segments, noEol }.
  //   Lines removed and added in the same place are paired as changed, in
  //   order. `segments` marks the words that changed in a changed line, as
  //   DiffEngine does; it is null on other lines, and on changed lines with
  //   too little in common for that. `noEol` marks a last line that lacks
  //   the line break the other side's has.
  // - stats: { additions, deletions }, the lines added and removed, as
  //   GitHub counts them: a changed line is one of each.
  // - blocks: the first row of each run of differing rows; blockOf: the
  //   run of each row, -1 for equal rows.
  // - leftAt, rightAt: per row, the lines of each side before it.
  // - functionAt: per line of the left side, the nearest line at or before
  //   it that starts a function, as git finds them, -1 for none.
  function compare(leftText, rightText, options) {
    const opts = { ignoreCase: false, ignoreWhitespace: false, ...options };
    const left = splitLines(leftText);
    const right = splitLines(rightText);
    const keysOf = (side) => {
      const keys = side.lines.map((line) => DiffEngine.lineKey(line, opts));
      // With whitespace ignored, a missing line break is too.
      if (!side.eol && !opts.ignoreWhitespace) keys[keys.length - 1] += NO_EOL;
      return keys;
    };
    const leftKeys = keysOf(left);
    const rightKeys = keysOf(right);
    const parts =
      Diff.diffArrays(leftKeys, rightKeys, { timeout: DiffEngine.DIFF_TIMEOUT }) ||
      DiffEngine.partsInOrder(leftKeys, rightKeys);
    const ops = slide(toOps(parts), { keys: leftKeys, lines: left.lines }, { keys: rightKeys, lines: right.lines });

    const rows = [];
    const stats = { additions: 0, deletions: 0 };
    const blocks = [];
    const eolDiffers = left.eol !== right.eol && !opts.ignoreWhitespace;
    const line = (side, index) => ({
      num: index + 1,
      text: side.lines[index],
      segments: null,
      noEol: eolDiffers && !side.eol && index === side.lines.length - 1,
    });
    let l = 0;
    let r = 0;
    let removed = 0;
    let added = 0;
    const flush = () => {
      if (removed + added === 0) return;
      blocks.push(rows.length);
      const firstLeft = l - removed;
      const firstRight = r - added;
      for (let i = 0; i < Math.max(removed, added); i++) {
        const leftLine = i < removed ? line(left, firstLeft + i) : null;
        const rightLine = i < added ? line(right, firstRight + i) : null;
        if (leftLine && rightLine) {
          const words = DiffEngine.diffWords(leftLine.text, rightLine.text, opts);
          if (!words.whole) {
            leftLine.segments = words.left;
            rightLine.segments = words.right;
          }
        }
        const type = leftLine && rightLine ? 'changed' : leftLine ? 'removed' : 'added';
        rows.push({ type, left: leftLine, right: rightLine });
      }
      stats.deletions += removed;
      stats.additions += added;
      removed = 0;
      added = 0;
    };
    for (const op of ops) {
      if (op === REMOVED) {
        removed++;
        l++;
      } else if (op === ADDED) {
        added++;
        r++;
      } else {
        flush();
        rows.push({ type: 'equal', left: line(left, l++), right: line(right, r++) });
      }
    }
    flush();

    const leftAt = new Int32Array(rows.length + 1);
    const rightAt = new Int32Array(rows.length + 1);
    const blockOf = new Int32Array(rows.length).fill(-1);
    rows.forEach((row, i) => {
      leftAt[i + 1] = leftAt[i] + (row.left ? 1 : 0);
      rightAt[i + 1] = rightAt[i] + (row.right ? 1 : 0);
    });
    blocks.forEach((start, block) => {
      for (let i = start; i < rows.length && rows[i].type !== 'equal'; i++) blockOf[i] = block;
    });
    // git's default: a line that starts with a letter, _ or $.
    const functionAt = new Int32Array(left.lines.length);
    let lastFunction = -1;
    left.lines.forEach((text, i) => {
      if (/^[A-Za-z_$]/.test(text)) lastFunction = i;
      functionAt[i] = lastFunction;
    });

    return { left, right, rows, stats, blocks, blockOf, leftAt, rightAt, functionAt };
  }

  // Which rows are on show at first: every difference, and CONTEXT rows
  // around each. One flag per row.
  const initialShown = (diff) => Uint8Array.from(DiffEngine.hiddenRows(diff.rows, CONTEXT), (hidden) => (hidden ? 0 : 1));

  // A hunk's header, as git writes it: where it starts on each side and how
  // many lines it has there, then the line of the function it is in.
  function header(diff, start, end) {
    const range = (before, count) => {
      if (count === 0) return `${before},0`;
      return count === 1 ? `${before + 1}` : `${before + 1},${count}`;
    };
    const leftBefore = diff.leftAt[start];
    const rightBefore = diff.rightAt[start];
    const ranges = `@@ -${range(leftBefore, diff.leftAt[end] - leftBefore)} +${range(rightBefore, diff.rightAt[end] - rightBefore)} @@`;
    const functionLine = leftBefore > 0 ? diff.functionAt[leftBefore - 1] : -1;
    if (functionLine < 0) return ranges;
    return `${ranges} ${diff.left.lines[functionLine].trimEnd().slice(0, FUNCTION_LENGTH)}`;
  }

  // The rows `shown` (one flag per row) as hunks: [{ gap, hunk }], where
  // `hunk` is a run of rows on show, { start, end, header }, and `gap` the
  // run of folded rows before it, { start, end }, which may be empty.
  // Folded rows after the last hunk come last, with `hunk` null.
  function hunks(diff, shown) {
    const { rows } = diff;
    const result = [];
    let i = 0;
    while (i < rows.length) {
      const gap = { start: i, end: i };
      while (i < rows.length && !shown[i]) i++;
      gap.end = i;
      if (i === rows.length) {
        result.push({ gap, hunk: null });
        break;
      }
      const start = i;
      while (i < rows.length && shown[i]) i++;
      result.push({ gap, hunk: { start, end: i, header: header(diff, start, i) } });
    }
    return result;
  }

  // Rows `start` to `end` in one column, as a unified diff has them: of each
  // run of differing rows, the removed lines first, then the added ones.
  // Returns [{ row, side }], with side 'left' for a removed line, 'right'
  // for an added one and null for an unchanged one.
  function unified(rows, start, end) {
    const lines = [];
    let i = start;
    while (i < end) {
      if (rows[i].type === 'equal') {
        lines.push({ row: i, side: null });
        i++;
        continue;
      }
      let j = i;
      while (j < end && rows[j].type !== 'equal') j++;
      for (let k = i; k < j; k++) if (rows[k].left) lines.push({ row: k, side: 'left' });
      for (let k = i; k < j; k++) if (rows[k].right) lines.push({ row: k, side: 'right' });
      i = j;
    }
    return lines;
  }

  // The changes as a unified diff, as `git diff` writes it, which turns the
  // left text into the right one. Empty when nothing differs.
  function patch(diff, { leftName, rightName }) {
    if (diff.blocks.length === 0) return '';
    const lines = [`--- a/${leftName}`, `+++ b/${rightName}`];
    const push = (prefix, line, side) => {
      lines.push(`${prefix}${line.text}`);
      if (!side.eol && line.num === side.lines.length) lines.push(NO_EOL_NOTE);
    };
    for (const { hunk } of hunks(diff, initialShown(diff))) {
      if (!hunk) continue;
      lines.push(hunk.header);
      for (const { row, side } of unified(diff.rows, hunk.start, hunk.end)) {
        const { left, right } = diff.rows[row];
        if (side === 'right') push('+', right, diff.right);
        else push(side === 'left' ? '-' : ' ', left, diff.left);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  // GitHub's five squares, as 'added', 'removed' and 'neutral': how much of
  // the change is added lines and how much removed ones.
  function diffstat({ additions, deletions }) {
    const total = additions + deletions;
    let added = additions;
    let removed = deletions;
    if (total > 5) {
      added = Math.round((additions / total) * 5);
      if (additions > 0) added = Math.max(1, added);
      if (deletions > 0) added = Math.min(4, added);
      removed = 5 - added;
    }
    return [
      ...Array(added).fill('added'),
      ...Array(removed).fill('removed'),
      ...Array(5 - added - removed).fill('neutral'),
    ];
  }

  return { compare, initialShown, hunks, unified, patch, diffstat, CONTEXT };
});
