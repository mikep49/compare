// Compares two spreadsheets sheet by sheet: lines up their columns and rows,
// then lists the cells that differ. Loaded as a plain script in the renderer
// and via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('diff'));
  } else {
    root.TableDiff = factory(root.Diff);
  }
})(typeof self !== 'undefined' ? self : this, function (Diff) {
  // Rows or columns at least this alike are taken to be the same one.
  const MIN_SIMILARITY = 0.5;
  // With more candidate pairs than this, looking for the best match takes too
  // long and items are paired in order instead.
  const MAX_CANDIDATES = 250000;
  // Lining up the columns looks at this many rows at most, fewer in very wide
  // sheets so that the work stays bounded.
  const COLUMN_SAMPLE = 2000;
  const COLUMN_WORK = 20000000;
  // Sheets with next to nothing in common can take very long to line up row
  // by row; past this many milliseconds their rows are compared by position.
  const DIFF_TIMEOUT = 3000;
  const EMPTY_SHEET = { name: '', rows: [] };

  function cellKey(text, opts) {
    let key = text;
    if (opts.ignoreWhitespace) key = key.trim().replace(/\s+/g, ' ');
    if (opts.ignoreCase) key = key.toLowerCase();
    return key;
  }

  // The order-preserving set of [left, right] matches with the highest total
  // similarity, among pairs that are similar enough. Of equally good sets it
  // returns the one that matches the earliest items.
  function bestMatches(leftCount, rightCount, similarity) {
    const width = rightCount + 1;
    const scores = new Float64Array((leftCount + 1) * width);
    for (let l = 1; l <= leftCount; l++) {
      for (let r = 1; r <= rightCount; r++) {
        const value = similarity(l - 1, r - 1);
        const skip = Math.max(scores[(l - 1) * width + r], scores[l * width + r - 1]);
        const take = value >= MIN_SIMILARITY ? scores[(l - 1) * width + r - 1] + value : 0;
        scores[l * width + r] = Math.max(skip, take);
      }
    }

    const matches = [];
    let l = leftCount;
    let r = rightCount;
    while (l > 0 && r > 0) {
      const score = scores[l * width + r];
      if (score === scores[(l - 1) * width + r]) l--;
      else if (score === scores[l * width + r - 1]) r--;
      else matches.push([--l, --r]);
    }
    return matches.reverse();
  }

  // Pairs up the items of two lists without reordering them: similar items
  // first, then whatever lies between two matches in order. Returns
  // [left, right] index pairs, with -1 for an item that has no partner.
  function pairInOrder(leftCount, rightCount, similarity) {
    const few = leftCount * rightCount <= MAX_CANDIDATES;
    const matches = few ? bestMatches(leftCount, rightCount, similarity) : [];
    const pairs = [];
    let l = 0;
    let r = 0;
    for (const [matchLeft, matchRight] of [...matches, [leftCount, rightCount]]) {
      while (l < matchLeft && r < matchRight) pairs.push([l++, r++]);
      while (l < matchLeft) pairs.push([l++, -1]);
      while (r < matchRight) pairs.push([-1, r++]);
      if (l < leftCount) pairs.push([l++, r++]);
    }
    return pairs;
  }

  // Lines up the columns of two sheets, so that an inserted or deleted column
  // doesn't shift everything after it. Two columns are the same one when
  // they share most of their values; an equal heading counts in their favour.
  function alignColumns(leftRows, rightRows, leftWidth, rightWidth) {
    const sample = Math.max(50, Math.min(COLUMN_SAMPLE, Math.floor(COLUMN_WORK / (leftWidth * rightWidth || 1))));
    const describe = (rows, width) => {
      const values = Array.from({ length: width }, () => new Set());
      for (const row of rows.slice(0, sample)) {
        row.forEach((cell, column) => {
          if (cell !== '') values[column].add(cell);
        });
      }
      return { values, headings: rows.find((row) => row.some((cell) => cell !== '')) || [] };
    };
    const left = describe(leftRows, leftWidth);
    const right = describe(rightRows, rightWidth);

    return pairInOrder(leftWidth, rightWidth, (l, r) => {
      const a = left.values[l];
      const b = right.values[r];
      let shared = 0;
      for (const value of a) {
        if (b.has(value)) shared++;
      }
      const all = a.size + b.size - shared;
      const overlap = all === 0 ? 1 : shared / all;
      const sameHeading = Boolean(left.headings[l]) && left.headings[l] === right.headings[r];
      return sameHeading ? (1 + overlap) / 2 : overlap;
    }).map(([l, r]) => ({ left: l, right: r }));
  }

  function compareSheets(left, right, opts) {
    const normalize = (sheet) =>
      opts.ignoreCase || opts.ignoreWhitespace
        ? sheet.rows.map((row) => row.map((cell) => cellKey(cell, opts)))
        : sheet.rows;
    const width = (rows) => rows.reduce((max, row) => Math.max(max, row.length), 0);
    const leftRows = normalize(left);
    const rightRows = normalize(right);

    const columns = alignColumns(leftRows, rightRows, width(leftRows), width(rightRows));
    // Rows are lined up and compared on the columns both sheets have. A
    // column only one of them has is a difference of its own, not one in
    // every row.
    const sharedColumns = columns.filter((column) => column.left >= 0 && column.right >= 0);
    const columnStats = {
      removed: columns.filter((column) => column.right < 0).length,
      added: columns.filter((column) => column.left < 0).length,
    };

    // Encode cell boundaries so characters inside cells cannot make different rows share a key.
    const rowKey = (row, side) => JSON.stringify(sharedColumns.map((column) => row[column[side]] ?? ''));
    const similarity = (leftRow, rightRow) => {
      let filled = 0;
      let same = 0;
      for (const column of sharedColumns) {
        const l = leftRow[column.left] ?? '';
        const r = rightRow[column.right] ?? '';
        if (l === '' && r === '') continue;
        filled++;
        if (l === r) same++;
      }
      return filled === 0 ? 0 : same / filled;
    };

    const rows = [];
    const stats = { changed: 0, removed: 0, added: 0 };
    const push = (type, l, r, cells) => {
      rows.push({ type, left: l, right: r, cells });
      if (type !== 'equal') stats[type]++;
    };
    const pushPair = (l, r) => {
      const cells = [];
      columns.forEach((column, index) => {
        if (column.left < 0 || column.right < 0) return;
        if ((leftRows[l][column.left] ?? '') !== (rightRows[r][column.right] ?? '')) cells.push(index);
      });
      push(cells.length > 0 ? 'changed' : 'equal', l, r, cells);
    };

    const parts = Diff.diffArrays(
      leftRows.map((row) => rowKey(row, 'left')),
      rightRows.map((row) => rowKey(row, 'right')),
      { timeout: DIFF_TIMEOUT }
    ) || [
      { removed: true, count: leftRows.length },
      { added: true, count: rightRows.length },
    ];

    let l = 0;
    let r = 0;
    let pendingRemoved = 0;
    let pendingAdded = 0;

    // A run of removed rows followed by added rows is shown as changed rows
    // where they pair up; whatever is left over stays removed or added.
    const flush = () => {
      const pairs = pairInOrder(pendingRemoved, pendingAdded, (i, j) => similarity(leftRows[l + i], rightRows[r + j]));
      for (const [i, j] of pairs) {
        if (j < 0) push('removed', l + i, -1, []);
        else if (i < 0) push('added', -1, r + j, []);
        else pushPair(l + i, r + j);
      }
      l += pendingRemoved;
      r += pendingAdded;
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
        for (let i = 0; i < part.count; i++) push('equal', l++, r++, []);
      }
    }
    flush();

    return { columns, rows, stats, columnStats };
  }

  function pairName(left, right) {
    if (left && right && left.name && right.name && left.name !== right.name) return `${left.name} → ${right.name}`;
    return (left && left.name) || (right && right.name) || '';
  }

  // `leftSheets` and `rightSheets` are [{ name, rows }] with rows of cell
  // texts. Sheets pair up by name, the remaining ones in order. Returns, per
  // pair, { name, left, right, columns, rows, stats, columnStats }:
  //   left, right  the two sheets, null when a sheet has no counterpart
  //   columns      [{ left, right }] column indexes, -1 where a side lacks it
  //   rows         [{ type, left, right, cells }] with row indexes (-1 where
  //                a side lacks the row) and, for changed rows, the indexes
  //                into `columns` of the cells that differ
  //   stats        numbers of changed, removed and added rows
  //   columnStats  numbers of removed and added columns
  function compare(leftSheets, rightSheets, options) {
    const opts = { ignoreCase: false, ignoreWhitespace: false, ...options };
    const unnamed = rightSheets.filter((sheet) => !leftSheets.some((other) => other.name === sheet.name));
    const pairs = leftSheets.map((left) => ({
      left,
      right: rightSheets.find((sheet) => sheet.name === left.name) ?? unnamed.shift() ?? null,
    }));
    for (const right of unnamed) pairs.push({ left: null, right });

    return pairs.map(({ left, right }) => ({
      name: pairName(left, right),
      left,
      right,
      ...compareSheets(left || EMPTY_SHEET, right || EMPTY_SHEET, opts),
    }));
  }

  return { compare };
});
