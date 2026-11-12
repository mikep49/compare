const test = require('node:test');
const assert = require('node:assert/strict');
const Diff = require('diff');
const DiffEngine = require('../src/renderer/diff-engine');
const TableText = require('../src/table-text');
const TableDiff = require('../src/renderer/table-diff');
const CodeDiff = require('../src/renderer/code-diff');
const CodeHtml = require('../src/renderer/code-html');
const Report = require('../src/renderer/report');

const lines = (count, label = 'line') => Array.from({ length: count }, (_, i) => `${label} ${i + 1}`);

test('a patch turns the original into the changed text', () => {
  const left = lines(40);
  const right = [...left];
  right[2] = 'line three, edited';
  right.splice(20, 2);
  right.splice(30, 0, 'new line', 'another new line');
  right.push('at the end');
  const [leftText, rightText] = [left, right].map((text) => `${text.join('\n')}\n`);
  const { rows } = DiffEngine.compare(leftText, rightText);
  const patch = Report.textPatch({ rows, leftName: 'old.txt', rightName: 'new.txt' });
  assert.match(patch, /^--- a\/old\.txt\n\+\+\+ b\/new\.txt\n@@ -1,6 \+1,6 @@\n/);
  assert.equal(Diff.applyPatch(leftText, patch), rightText);
});

test('a patch of identical texts is empty, and an empty side starts at line 0', () => {
  assert.equal(Report.textPatch({ rows: DiffEngine.compare('a\nb\n', 'a\nb\n').rows, leftName: 'x', rightName: 'y' }), '');
  const patch = Report.textPatch({ rows: DiffEngine.compare('', 'a\nb\n').rows, leftName: 'x', rightName: 'y' });
  assert.match(patch, /@@ -0,0 \+1,2 @@\n\+a\n\+b\n$/);
});

test('the text report escapes the texts and folds away unchanged lines when asked', () => {
  const left = [...lines(30), '<b>bold & "quoted"</b>'];
  const right = [...lines(30), '<b>bold & "changed"</b>'];
  const { rows, stats } = DiffEngine.compare(left.join('\n'), right.join('\n'));
  const options = { ignoreCase: false, ignoreWhitespace: true };
  const base = { rows, stats, leftName: 'a <1>.txt', rightName: 'b.txt', options, created: 'today' };
  const full = Report.textReport(base);
  assert.match(full, /&lt;b&gt;bold &amp; &quot;<span class="hl">quoted<\/span>/);
  assert.match(full, /a &lt;1&gt;\.txt/);
  assert.match(full, /whitespace ignored/);
  assert.match(full, /1 line changed/);
  assert.doesNotMatch(full, /unchanged line/);
  const folded = Report.textReport({ ...base, onlyDifferences: true });
  assert.match(folded, /⋯ 27 unchanged lines/);
  assert.doesNotMatch(folded, />line 1</);
  assert.match(folded, />line 28</);
});

test('spreadsheet changes list cells, rows, columns and sheets', () => {
  const left = [
    { name: 'Data', rows: [['Name', 'Age'], ['Ann', '30'], ['Bob', '40'], ['Cy', '50']] },
    { name: 'Old', rows: [['x']] },
    { name: 'Same', rows: [['y']] },
  ];
  const right = [
    { name: 'Data', rows: [['Name', 'Age'], ['Ann', '31'], ['Cy', '50'], ['Dee', '60']] },
    { name: 'Same', rows: [['y']] },
  ];
  const diffs = TableDiff.compare(left, right);
  const changes = Report.sheetChanges(diffs).map((c) => [c.sheet, c.change, c.leftCell, c.rightCell, c.leftValue, c.rightValue]);
  assert.deepEqual(changes, [
    ['Data', 'Cell changed', 'B2', 'B2', '30', '31'],
    ['Data', 'Row removed', 'A3', '', 'Bob', ''],
    ['Data', 'Row removed', 'B3', '', '40', ''],
    ['Data', 'Row added', '', 'A4', '', 'Dee'],
    ['Data', 'Row added', '', 'B4', '', '60'],
    ['Old', 'Sheet removed', '', '', '', ''],
  ]);

  const csv = Report.sheetCsv({ diffs });
  assert.ok(csv.startsWith('\ufeffSheet,Change,Original cell'));
  assert.match(csv, /\r\nData,Cell changed,B2,B2,30,31\r\n/);

  const html = Report.sheetReport({ diffs, leftName: 'a.xlsx', rightName: 'b.xlsx', options: {}, created: 'today' });
  assert.match(html, /<h2>Data<\/h2>/);
  assert.match(html, /1 row changed/);
  assert.match(html, /<h2>No differences<\/h2><p>Same<\/p>/);
});

test('CSV fields with commas, quotes or line breaks are quoted', () => {
  const diffs = TableDiff.compare([{ name: '', rows: [['a, b']] }], [{ name: '', rows: [['say "hi"\nthere']] }]);
  const csv = Report.sheetCsv({ diffs });
  assert.match(csv, /,"a, b","say ""hi""\nthere"\r\n$/);
});

test('CSV exports formula-like cell values as quoted text on both sides', () => {
  const values = [
    '=1+1', '+1+1', '-1+1', '@SUM(1,1)', '-42',
    '\t=1+1', '\r=1+1', '\n=1+1', '\ttext', '\rtext', '\ntext',
    ' =1+1', ' \t+1+1', '\u0000=1+1', '\ufeff=1+1',
    '\uff1d1+1', '\uff0b1+1', '\uff0d1+1', '\uff20SUM(1,1)',
    '=HYPERLINK("https://example.invalid/?a=1,b=2","click")\r\nnext',
  ];
  for (const value of values) {
    const sheet = (text) => [{ name: 'Data', rows: [['Key', 'Value'], ['item', text]] }];
    const diffs = TableDiff.compare(sheet(value), sheet(`${value} changed`));
    const changes = Report.sheetChanges(diffs);
    const csv = Report.sheetCsv({ diffs });
    assert.deepEqual(TableText.split(csv.slice(1), ',').slice(1), [
      ['Data', 'Cell changed', 'B2', 'B2', `\t${value}`, `\t${value} changed`],
    ], JSON.stringify(value));
    assert.ok(csv.includes(',"\t'), 'the protective tab must be inside a quoted field');
    assert.deepEqual(Report.sheetChanges(diffs), changes, 'export must not alter the comparison');
    assert.equal(diffs[0].left.rows[1][1], value);
    assert.equal(diffs[0].right.rows[1][1], `${value} changed`);
  }
});

test('CSV protects formula-like sheet names, including added and removed sheets', () => {
  for (const name of ['=1+1', '+1+1', '-1+1', '@SUM(1,1)']) {
    const sheet = [{ name, rows: [['value']] }];
    for (const [left, right, change] of [[sheet, [], 'Sheet removed'], [[], sheet, 'Sheet added']]) {
      const csv = Report.sheetCsv({ diffs: TableDiff.compare(left, right) });
      assert.deepEqual(TableText.split(csv.slice(1), ',').slice(1), [[`\t${name}`, change, '', '', '', '']]);
      assert.ok(csv.includes('\r\n"\t'), 'sheet names must use the same quoted text protection');
    }
  }
});

test('CSV protects values in added and removed rows', () => {
  const value = '=SUM(1,2)';
  const empty = [{ name: 'Data', rows: [['Key', 'Value']] }];
  const filled = [{ name: 'Data', rows: [['Key', 'Value'], ['item', value]] }];
  const removed = Report.sheetCsv({ diffs: TableDiff.compare(filled, empty) });
  const added = Report.sheetCsv({ diffs: TableDiff.compare(empty, filled) });
  assert.deepEqual(TableText.split(removed.slice(1), ',').at(-1), ['Data', 'Row removed', 'B2', '', `\t${value}`, '']);
  assert.deepEqual(TableText.split(added.slice(1), ',').at(-1), ['Data', 'Row added', '', 'B2', '', `\t${value}`]);
});

test('CSV leaves ordinary text, numbers and already escaped formulas unchanged', () => {
  const values = ['', '123', 'plain text', "'=1+1", 'a,=1+1', 'a";=1+1', 'two\nlines', ' padded '];
  for (const value of values) {
    const sheet = (text) => [{ name: 'Data', rows: [['Key', 'Value'], ['item', text]] }];
    const csv = Report.sheetCsv({ diffs: TableDiff.compare(sheet(value), sheet('replacement')) });
    assert.deepEqual(TableText.split(csv.slice(1), ',').slice(1), [
      ['Data', 'Cell changed', 'B2', 'B2', value, 'replacement'],
    ], JSON.stringify(value));
  }
});

test('hidden rows keep the context around each difference', () => {
  const rows = ['equal', 'equal', 'equal', 'equal', 'equal', 'changed', 'equal', 'equal', 'equal', 'equal', 'equal'].map((type) => ({ type }));
  assert.deepEqual(DiffEngine.hiddenRows(rows, 3), [true, true, false, false, false, false, false, false, false, true, true]);
});

test('a patch keeps the blank lines only one side has, so it still applies exactly', () => {
  const leftText = 'First paragraph.\n\n\nSecond paragraph here.\n\n\n' + lines(12).join('\n\n') + '\n';
  const rightText = 'First paragraph.\n\nSecond paragraph there.\n\n' + lines(12).join('\n\n\n') + '\n\n';
  const { rows } = DiffEngine.compare(leftText, rightText);
  const patch = Report.textPatch({ rows, leftName: 'old.txt', rightName: 'new.txt' });
  assert.equal(Diff.applyPatch(leftText, patch), rightText);
});

test('the text report leaves a side with fewer blank lines empty, not hatched', () => {
  const { rows, stats } = DiffEngine.compare('a\n\n\nb\nc', 'a\n\nb');
  const report = Report.textReport({
    rows,
    stats,
    leftName: 'x',
    rightName: 'y',
    options: { ignoreCase: false, ignoreWhitespace: false },
    created: 'today',
  });
  const filler = (type) => (report.match(new RegExp(`<tr class="${type}">.*`, 'g')) || []).filter((row) => row.includes('filler'));
  assert.equal(filler('equal').length, 0);
  assert.equal(filler('removed').length, 1);
});

test('the code report shows the hunks as the app does, colored and escaped', () => {
  const left = [...lines(30, '  item'), 'if (a < b) {', '}'];
  const right = [...lines(30, '  item'), 'if (a < c) {', '}'];
  const diff = CodeDiff.compare(left.join('\n'), right.join('\n'));
  const base = { diff, leftName: 'a.js', rightName: 'b.js', options: {}, created: 'today' };
  const has = (html, part) => assert.ok(html.includes(part), `missing: ${part}`);
  const split = Report.codeReport(base);
  has(split, '<h1>Code comparison</h1>');
  has(split, '1 line added');
  has(split, '<tr class="hunk"><td colspan="4">@@ -28,5 +28,5 @@</td></tr>');
  has(split, '<td class="num del">31</td><td class="line l del">if (a &lt; <span class="x">b</span>) {</td>');
  assert.ok(!split.includes('>  item 27<'));

  const colored = right.map((line) => CodeHtml.escapeHtml(line).replace('if', '<span class="hljs-keyword">if</span>')).join('\n');
  const tokens = { left: null, right: CodeHtml.toLines(colored) };
  const unified = Report.codeReport({ ...base, layout: 'unified', tokens, shown: new Uint8Array(diff.rows.length).fill(1) });
  has(unified, '<tr class="hunk"><td colspan="3">@@ -1,32 +1,32 @@</td></tr>');
  has(unified, '<td class="num del">31</td><td class="num del"></td><td class="line del">');
  has(unified, '<td class="line add"><span class="hljs-keyword">if</span> (a &lt; <span class="x">c</span>)');
});
