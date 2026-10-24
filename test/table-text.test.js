const test = require('node:test');
const assert = require('node:assert/strict');
const { toText, toSheets } = require('../src/table-text');

test('cells pasted from a spreadsheet are split on tabs', () => {
  const pasted = 'Item\tQty\tNote\r\nApple, red\t3\t"two\nlines"\r\nPear\t\t\r\n';
  assert.deepEqual(toSheets(pasted), [
    {
      name: '',
      rows: [
        ['Item', 'Qty', 'Note'],
        ['Apple, red', '3', 'two\nlines'],
        ['Pear'],
      ],
    },
  ]);
});

test('text without tabs is split on the delimiter it uses', () => {
  assert.deepEqual(toSheets('a;b\n1;2').at(0).rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(toSheets('just words\nmore words').at(0).rows, [['just words'], ['more words']]);
  assert.deepEqual(toSheets(''), [{ name: '', rows: [] }]);
});

test('a single sheet is written without a name', () => {
  assert.equal(toText([{ name: 'Data', rows: [['a', 'b'], [], ['c\nd', 'e\tf']] }]), 'a\tb\n\nc d\te f');
});

test('the text of a workbook reads back as its sheets', () => {
  const sheets = [
    { name: 'Costs', rows: [['Item', 'Amount'], [], ['Rent', '1,200.00'], ['', '[note]']] },
    { name: 'Empty', rows: [] },
    { name: 'Second', rows: [[], ['', 'offset']] },
  ];
  const text = toText(sheets);
  assert.equal(text, '[Costs]\nItem\tAmount\n\nRent\t1,200.00\n\t[note]\n\n[Empty]\n\n[Second]\n\n\toffset');
  assert.deepEqual(toSheets(text), sheets);
  // An edited cell keeps the sheets apart.
  assert.deepEqual(
    toSheets(text.replace('1,200.00', '1,250.00')).map((sheet) => sheet.name),
    ['Costs', 'Empty', 'Second']
  );
});
