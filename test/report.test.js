const test = require('node:test');
const assert = require('node:assert/strict');
const Diff = require('diff');
const DiffEngine = require('../src/renderer/diff-engine');
const TableDiff = require('../src/renderer/table-diff');
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

test('hidden rows keep the context around each difference', () => {
  const rows = ['equal', 'equal', 'equal', 'equal', 'equal', 'changed', 'equal', 'equal', 'equal', 'equal', 'equal'].map((type) => ({ type }));
  assert.deepEqual(DiffEngine.hiddenRows(rows, 3), [true, true, false, false, false, false, false, false, false, true, true]);
});
