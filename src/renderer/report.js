// Turns a comparison into files to save: an HTML report for either kind, a
// patch for texts and a list of changed cells for spreadsheets. Loaded as a
// plain script in the renderer and via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./diff-engine'), require('../table-text'));
  } else {
    root.Report = factory(root.DiffEngine, root.TableText);
  }
})(typeof self !== 'undefined' ? self : this, function (DiffEngine, TableText) {
  // Unchanged lines kept around each change, in patches and in reports that
  // show only the differences.
  const CONTEXT = 3;

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);

  const plural = (count, unit) => `${count.toLocaleString('en')} ${count === 1 ? unit : `${unit}s`}`;
  const lineText = (side) => side.segments.map((segment) => segment.text).join('');

  function optionsText({ ignoreCase, ignoreWhitespace }) {
    const parts = [ignoreCase && 'case ignored', ignoreWhitespace && 'whitespace ignored'];
    return parts.filter(Boolean).join(', ') || 'exact comparison';
  }

  // A unified diff, as `git diff` writes it, of the rows of
  // DiffEngine.compare(). Empty when nothing differs. Unlike the comparison,
  // it has the blank lines only one side has, so that it turns the original
  // into the changed text exactly.
  const bothSides = (row) => Boolean(row.left && row.right);

  function textPatch({ rows, leftName, rightName }) {
    const runs = [];
    rows.forEach((row, index) => {
      if (row.type === 'equal' && bothSides(row)) return;
      const last = runs[runs.length - 1];
      if (last && index - last.end <= 2 * CONTEXT + 1) last.end = index;
      else runs.push({ start: index, end: index });
    });
    if (runs.length === 0) return '';

    const lines = [`--- a/${leftName}`, `+++ b/${rightName}`];
    for (const run of runs) {
      const start = Math.max(0, run.start - CONTEXT);
      const end = Math.min(rows.length - 1, run.end + CONTEXT);
      const hunk = rows.slice(start, end + 1);
      const before = rows.slice(0, start);
      const leftBefore = before.filter((row) => row.left).length;
      const rightBefore = before.filter((row) => row.right).length;
      const leftCount = hunk.filter((row) => row.left).length;
      const rightCount = hunk.filter((row) => row.right).length;
      // An empty side starts at the line before it, as in diff(1).
      const range = (before, count) => `${count === 0 ? before : before + 1},${count}`;
      lines.push(`@@ -${range(leftBefore, leftCount)} +${range(rightBefore, rightCount)} @@`);

      let removed = [];
      let added = [];
      const flush = () => {
        lines.push(...removed, ...added);
        removed = [];
        added = [];
      };
      for (const row of hunk) {
        if (row.type === 'equal' && bothSides(row)) {
          flush();
          lines.push(` ${lineText(row.left)}`);
          continue;
        }
        if (row.left) removed.push(`-${lineText(row.left)}`);
        if (row.right) added.push(`+${lineText(row.right)}`);
      }
      flush();
    }
    return `${lines.join('\n')}\n`;
  }

  const STYLE = `
    :root { color-scheme: light dark; --text: #18181b; --muted: #6b6b76; --border: #e6e6e9; --surface: #fff;
      --removed-bg: rgba(229,72,77,.08); --removed-hl: rgba(229,72,77,.26); --removed: #c62a2f;
      --added-bg: rgba(48,164,108,.1); --added-hl: rgba(48,164,108,.3); --added: #18794e; --hatch: rgba(0,0,0,.05); }
    @media (prefers-color-scheme: dark) { :root { --text: #ededed; --muted: #a3a3a3; --border: #353535; --surface: #1e1e1e;
      --removed-bg: rgba(229,72,77,.14); --removed-hl: rgba(229,72,77,.42); --removed: #ff8589;
      --added-bg: rgba(48,164,108,.14); --added-hl: rgba(48,164,108,.44); --added: #5fd09a; --hatch: rgba(255,255,255,.05); } }
    body { margin: 0; padding: 24px 16px 48px; background: var(--surface); color: var(--text);
      font: 14px/1.5 'Segoe UI', system-ui, sans-serif; }
    main { max-width: 1400px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    h2 { margin: 32px 0 8px; font-size: 17px; }
    .meta { margin: 0 0 16px; color: var(--muted); }
    .names { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0 8px; }
    .names div { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; overflow-wrap: anywhere; }
    .names small { display: block; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 8px 0 16px; }
    .summary .removed { color: var(--removed); } .summary .added { color: var(--added); }
    .scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; }
    .diff { table-layout: fixed; font: 13px/1.6 'Cascadia Mono', Consolas, monospace; }
    .diff col.num { width: 56px; }
    .diff td { padding: 0 10px 0 4px; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
    .diff td.num { padding: 0 10px 0 0; color: var(--muted); text-align: right; user-select: none; }
    .diff td.l:not(.num) { border-right: 1px solid var(--border); }
    .removed .l, .changed .l { background: var(--removed-bg); }
    .added .r, .changed .r { background: var(--added-bg); }
    .l .hl { background: var(--removed-hl); border-radius: 3px; }
    .r .hl { background: var(--added-hl); border-radius: 3px; }
    .filler { background-image: repeating-linear-gradient(-45deg, var(--hatch) 0 1px, transparent 1px 7px); }
    .gap td { padding: 2px 12px; border-block: 1px solid var(--border); color: var(--muted); text-align: center; font-family: 'Segoe UI', system-ui, sans-serif; }
    .cells th, .cells td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    .cells th { color: var(--muted); font-size: 12px; font-weight: 600; }
    .cells .ref { white-space: nowrap; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 12.5px; }
    .cells .old { background: var(--removed-bg); } .cells .new { background: var(--added-bg); }
    .none { color: var(--muted); }
  `;

  function page(title, body) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
  }

  function header(title, { leftName, rightName, options, created }) {
    return `<h1>${escapeHtml(title)}</h1>
<p class="meta">Made with Compare on ${escapeHtml(created)} · ${escapeHtml(optionsText(options))}</p>
<div class="names"><div><small>Original</small>${escapeHtml(leftName)}</div><div><small>Changed</small>${escapeHtml(rightName)}</div></div>`;
  }

  function summary(items) {
    const shown = items.filter(([count]) => count > 0);
    if (shown.length === 0) return '<p class="summary none">No differences.</p>';
    return `<p class="summary">${shown
      .map(([count, text, type]) => `<span class="${type}">${escapeHtml(plural(count, text))} ${type}</span>`)
      .join('')}</p>`;
  }

  // An HTML page with the two texts side by side, as the app shows them.
  // With `onlyDifferences`, unchanged lines away from the changes are left
  // out, as in the app.
  function textReport({ rows, stats, leftName, rightName, options, created, onlyDifferences }) {
    const hidden = onlyDifferences ? DiffEngine.hiddenRows(rows, CONTEXT) : rows.map(() => false);
    // As in the app: hatched where a line is missing, empty where a side only
    // has fewer blank lines.
    const side = (part, sideClass, spacing) => {
      if (!part) {
        const filler = spacing ? '' : ' filler';
        return `<td class="num ${sideClass}${filler}"></td><td class="${sideClass}${filler}"></td>`;
      }
      const text = part.segments
        .map((segment) => (segment.changed ? `<span class="hl">${escapeHtml(segment.text)}</span>` : escapeHtml(segment.text)))
        .join('');
      return `<td class="num ${sideClass}">${part.num}</td><td class="${sideClass}">${text}</td>`;
    };
    const body = [];
    for (let i = 0; i < rows.length; i++) {
      if (hidden[i]) {
        let end = i;
        while (end + 1 < rows.length && hidden[end + 1]) end++;
        body.push(`<tr class="gap"><td colspan="4">⋯ ${plural(end - i + 1, 'unchanged line')}</td></tr>`);
        i = end;
        continue;
      }
      const spacing = rows[i].type === 'equal';
      body.push(`<tr class="${rows[i].type}">${side(rows[i].left, 'l', spacing)}${side(rows[i].right, 'r', spacing)}</tr>`);
    }
    const title = 'Document comparison';
    return page(
      `${leftName} vs ${rightName}`,
      `${header(title, { leftName, rightName, options, created })}
${summary([
  [stats.changed, 'line', 'changed'],
  [stats.removed, 'line', 'removed'],
  [stats.added, 'line', 'added'],
])}
<div class="scroll"><table class="diff"><colgroup><col class="num"><col><col class="num"><col></colgroup>
<tbody>
${body.join('\n')}
</tbody></table></div>`
    );
  }

  // Everything that differs between two spreadsheets, as a list of changes:
  // [{ sheet, change, leftCell, rightCell, leftValue, rightValue }].
  function sheetChanges(diffs) {
    const changes = [];
    for (const diff of diffs) {
      const sheet = diff.name;
      const add = (change, leftCell = '', rightCell = '', leftValue = '', rightValue = '') =>
        changes.push({ sheet, change, leftCell, rightCell, leftValue, rightValue });
      if (!diff.right) {
        add('Sheet removed');
        continue;
      }
      if (!diff.left) {
        add('Sheet added');
        continue;
      }
      for (const column of diff.columns) {
        if (column.right < 0) add('Column removed', TableText.columnName(column.left));
        if (column.left < 0) add('Column added', '', TableText.columnName(column.right));
      }
      const value = (side, row, column) => diff[side].rows[row][column] ?? '';
      const ref = (column, row) => `${TableText.columnName(column)}${row + 1}`;
      for (const row of diff.rows) {
        if (row.type === 'changed') {
          for (const index of row.cells) {
            const { left, right } = diff.columns[index];
            add('Cell changed', ref(left, row.left), ref(right, row.right), value('left', row.left, left), value('right', row.right, right));
          }
        } else if (row.type === 'removed' || row.type === 'added') {
          const side = row.type === 'removed' ? 'left' : 'right';
          diff[side].rows[row[side]].forEach((text, column) => {
            if (text === '') return;
            if (side === 'left') add('Row removed', ref(column, row.left), '', text, '');
            else add('Row added', '', ref(column, row.right), '', text);
          });
        }
      }
    }
    return changes;
  }

  // The list of changes as CSV, which Excel opens as it is.
  function sheetCsv({ diffs }) {
    const field = (text) => (/[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const lines = [['Sheet', 'Change', 'Original cell', 'Changed cell', 'Original value', 'Changed value']];
    for (const change of sheetChanges(diffs)) {
      lines.push([change.sheet, change.change, change.leftCell, change.rightCell, change.leftValue, change.rightValue]);
    }
    // The byte order mark tells Excel the file is UTF-8.
    return `﻿${lines.map((line) => line.map(field).join(',')).join('\r\n')}\r\n`;
  }

  // An HTML page that lists, per sheet, every cell that differs.
  function sheetReport({ diffs, leftName, rightName, options, created }) {
    const changes = sheetChanges(diffs);
    const sections = [];
    const same = [];
    for (const diff of diffs) {
      const name = diff.name || 'Sheet';
      const rows = changes.filter((change) => change.sheet === diff.name);
      if (rows.length === 0) {
        same.push(name);
        continue;
      }
      let stats = '';
      if (diff.left && diff.right) {
        stats = summary([
          [diff.stats.changed, 'row', 'changed'],
          [diff.stats.removed, 'row', 'removed'],
          [diff.stats.added, 'row', 'added'],
          [diff.columnStats.removed, 'column', 'removed'],
          [diff.columnStats.added, 'column', 'added'],
        ]);
      }
      const table = rows
        .map(
          (change) => `<tr><td>${escapeHtml(change.change)}</td><td class="ref">${escapeHtml(change.leftCell)}</td>` +
            `<td class="ref">${escapeHtml(change.rightCell)}</td><td class="old">${escapeHtml(change.leftValue)}</td>` +
            `<td class="new">${escapeHtml(change.rightValue)}</td></tr>`
        )
        .join('\n');
      sections.push(`<h2>${escapeHtml(name)}</h2>
${stats}
<div class="scroll"><table class="cells"><thead><tr><th>Change</th><th>Original cell</th><th>Changed cell</th><th>Original value</th><th>Changed value</th></tr></thead>
<tbody>
${table}
</tbody></table></div>`);
    }
    if (sections.length === 0) sections.push('<p class="summary none">No differences — both spreadsheets show the same values.</p>');
    if (same.length > 0 && same.length < diffs.length) {
      sections.push(`<h2>No differences</h2><p>${same.map(escapeHtml).join(', ')}</p>`);
    }
    return page(
      `${leftName} vs ${rightName}`,
      `${header('Spreadsheet comparison', { leftName, rightName, options, created })}
${sections.join('\n')}`
    );
  }

  return { textPatch, textReport, sheetReport, sheetCsv, sheetChanges, escapeHtml };
});
