// Turns a comparison into files to save: an HTML report for every kind, a
// patch for texts and a list of changed cells for spreadsheets. Loaded as a
// plain script in the renderer and via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./diff-engine'), require('../table-text'), require('./code-diff'), require('./code-html'));
  } else {
    root.Report = factory(root.DiffEngine, root.TableText, root.CodeDiff, root.CodeHtml);
  }
})(typeof self !== 'undefined' ? self : this, function (DiffEngine, TableText, CodeDiff, CodeHtml) {
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
  const patchEqual = (row) => row.type === 'equal' && row.left && row.right && row.left.noEol === row.right.noEol;
  const patchLine = (prefix, side) => [
    `${prefix}${lineText(side)}`,
    ...(side.noEol ? ['\\ No newline at end of file'] : []),
  ];

  function textPatch({ rows, leftName, rightName }) {
    const runs = [];
    rows.forEach((row, index) => {
      if (patchEqual(row)) return;
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
        if (patchEqual(row)) {
          flush();
          lines.push(...patchLine(' ', row.left));
          continue;
        }
        if (row.left) removed.push(...patchLine('-', row.left));
        if (row.right) added.push(...patchLine('+', row.right));
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

  // Code as GitHub shows it, colored as on GitHub.
  const CODE_STYLE = `
    :root { --hunk: rgba(66,99,235,.1); --hunk-text: #6b6b76; --removed-num: rgba(229,72,77,.16); --added-num: rgba(48,164,108,.2);
      --empty: rgba(0,0,0,.03); --keyword: #cf222e; --entity: #8250df; --constant: #0550ae; --string: #0a3069;
      --variable: #953800; --comment: #6e7781; --tag: #116329; }
    @media (prefers-color-scheme: dark) { :root { --hunk: rgba(91,124,250,.16); --hunk-text: #a3a3a3;
      --removed-num: rgba(229,72,77,.26); --added-num: rgba(48,164,108,.26); --empty: rgba(255,255,255,.03);
      --keyword: #ff7b72; --entity: #d2a8ff; --constant: #79c0ff; --string: #a5d6ff; --variable: #ffa657;
      --comment: #8b949e; --tag: #7ee787; } }
    .code { table-layout: fixed; font: 12.5px/20px 'Cascadia Mono', Consolas, monospace; tab-size: 4; }
    .code col.num { width: 60px; }
    .code td { padding: 0 10px; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
    .code td.num { color: var(--muted); text-align: right; user-select: none; }
    .code td.line { position: relative; padding-left: 22px; }
    .code td.line.l { border-right: 1px solid var(--border); }
    .code td.line.del::before { content: '-'; position: absolute; left: 8px; color: var(--removed); }
    .code td.line.add::before { content: '+'; position: absolute; left: 8px; color: var(--added); }
    .code td.line.del { background: var(--removed-bg); } .code td.line.add { background: var(--added-bg); }
    .code td.num.del { background: var(--removed-num); } .code td.num.add { background: var(--added-num); }
    .code td.empty { background: var(--empty); }
    .code .del .x { background: var(--removed-hl); } .code .add .x { background: var(--added-hl); }
    .code tr.hunk td { padding: 5px 12px; background: var(--hunk); color: var(--hunk-text); white-space: pre; }
    .code .no-eol { color: var(--removed); }
    .hljs-doctag, .hljs-keyword, .hljs-template-tag, .hljs-template-variable, .hljs-type, .hljs-variable.language_ { color: var(--keyword); }
    .hljs-title { color: var(--entity); }
    .hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number, .hljs-operator, .hljs-variable,
      .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-section { color: var(--constant); }
    .hljs-regexp, .hljs-string { color: var(--string); }
    .hljs-built_in, .hljs-symbol, .hljs-bullet { color: var(--variable); }
    .hljs-comment, .hljs-code, .hljs-formula { color: var(--comment); }
    .hljs-name, .hljs-quote, .hljs-selector-pseudo, .hljs-selector-tag { color: var(--tag); }
    .hljs-section, .hljs-strong { font-weight: 600; } .hljs-emphasis { font-style: italic; }
    .hljs-addition { color: var(--added); } .hljs-deletion { color: var(--removed); }
  `;

  function page(title, body, style = STYLE) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${style}</style>
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

  // An HTML page with two versions of code as the app shows them: the rows
  // `shown` (one flag per row; by default each change with a few lines
  // around it) in hunks, split side by side or unified in one column
  // (`layout`), and colored by `tokens`: per side, the lines of tokens of
  // CodeHtml.toLines(), or null.
  function codeReport({ diff, shown, layout = 'split', tokens = {}, leftName, rightName, options, created }) {
    const split = layout !== 'unified';
    const code = (side, line) => {
      const html = CodeHtml.lineHtml(line.text, tokens[side]?.[line.num - 1] ?? null, line.segments);
      return line.noEol ? `${html} <span class="no-eol" title="No newline at end of file">⊖</span>` : html;
    };
    const body = [];
    for (const { gap, hunk } of CodeDiff.hunks(diff, shown ?? CodeDiff.initialShown(diff))) {
      const folded = gap.end - gap.start;
      if (hunk || folded > 0) {
        const text = hunk ? hunk.header : `⋯ ${plural(folded, 'unchanged line')}`;
        body.push(`<tr class="hunk"><td colspan="${split ? 4 : 3}">${escapeHtml(text)}</td></tr>`);
      }
      if (!hunk) continue;
      if (split) {
        for (let i = hunk.start; i < hunk.end; i++) {
          const row = diff.rows[i];
          const cells = ['left', 'right'].map((side, s) => {
            const line = row[side];
            const sideClass = s === 0 ? 'l' : 'r';
            if (!line) return `<td class="num empty"></td><td class="line ${sideClass} empty"></td>`;
            const kind = row.type === 'equal' ? '' : s === 0 ? ' del' : ' add';
            return `<td class="num${kind}">${line.num}</td><td class="line ${sideClass}${kind}">${code(side, line)}</td>`;
          });
          body.push(`<tr>${cells.join('')}</tr>`);
        }
      } else {
        for (const { row: i, side } of CodeDiff.unified(diff.rows, hunk.start, hunk.end)) {
          const row = diff.rows[i];
          if (!side) {
            body.push(`<tr><td class="num">${row.left.num}</td><td class="num">${row.right.num}</td><td class="line">${code('right', row.right)}</td></tr>`);
            continue;
          }
          const line = row[side];
          const kind = side === 'left' ? 'del' : 'add';
          const [leftNum, rightNum] = side === 'left' ? [line.num, ''] : ['', line.num];
          body.push(`<tr><td class="num ${kind}">${leftNum}</td><td class="num ${kind}">${rightNum}</td><td class="line ${kind}">${code(side, line)}</td></tr>`);
        }
      }
    }
    const columns = split ? '<col class="num"><col><col class="num"><col>' : '<col class="num"><col class="num"><col>';
    return page(
      `${leftName} vs ${rightName}`,
      `${header('Code comparison', { leftName, rightName, options, created })}
${summary([
  [diff.stats.additions, 'line', 'added'],
  [diff.stats.deletions, 'line', 'removed'],
])}
<div class="scroll"><table class="code"><colgroup>${columns}</colgroup>
<tbody>
${body.join('\n')}
</tbody></table></div>`,
      STYLE + CODE_STYLE
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
    const field = (text) => {
      // CSV quoting alone doesn't stop Excel from evaluating formulas. A tab
      // inside the quoted field keeps them as text (including sheet names).
      // Check past leading whitespace/controls and include full-width signs.
      // https://owasp.org/www-community/attacks/CSV_Injection
      const safe = /^[\s\x00-\x1f]*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r\n]/.test(text) ? `\t${text}` : text;
      return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
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

  return { textPatch, textReport, codeReport, sheetReport, sheetCsv, sheetChanges, escapeHtml };
});
