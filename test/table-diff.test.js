const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('../src/renderer/table-diff');

const PEOPLE = [
  ['Name', 'Qty', 'City'],
  ['Ann', '1', 'Bern'],
  ['Bob', '2', 'Basel'],
  ['Cid', '3', 'Chur'],
  ['Dan', '4', 'Davos'],
];

const sheet = (rows, name = 'Sheet1') => ({ name, rows });
const compareRows = (left, right, options) => compare([sheet(left)], [sheet(right)], options)[0];
const summary = (diff) => diff.rows.map((row) => [row.type, row.left, row.right, row.cells]);

test('identical sheets have no differences', () => {
  const diff = compareRows(PEOPLE, PEOPLE);
  assert.ok(diff.rows.every((row) => row.type === 'equal'));
  assert.deepEqual(diff.stats, { changed: 0, removed: 0, added: 0 });
  assert.deepEqual(diff.columnStats, { removed: 0, added: 0 });
});

test('a changed cell marks its row and names the cell', () => {
  const right = PEOPLE.map((row) => (row[0] === 'Bob' ? ['Bob', '5', 'Basel'] : row));
  const diff = compareRows(PEOPLE, right);
  assert.deepEqual(diff.stats, { changed: 1, removed: 0, added: 0 });
  assert.deepEqual(summary(diff)[2], ['changed', 2, 2, [1]]);
});

test('separator characters in cells do not hide differences between rows', () => {
  const left = [['First', 'Second'], ['a\u001fb', 'c']];
  const right = [['First', 'Second'], ['a', 'b\u001fc']];
  const diff = compareRows(left, right);
  assert.deepEqual(summary(diff), [
    ['equal', 0, 0, []],
    ['changed', 1, 1, [0, 1]],
  ]);
  assert.deepEqual(diff.stats, { changed: 1, removed: 0, added: 0 });
});

test('inserted and deleted rows keep the rest aligned', () => {
  const right = [PEOPLE[0], PEOPLE[1], ['Eve', '9', 'Thun'], PEOPLE[2], PEOPLE[4]];
  const diff = compareRows(PEOPLE, right);
  assert.deepEqual(summary(diff), [
    ['equal', 0, 0, []],
    ['equal', 1, 1, []],
    ['added', -1, 2, []],
    ['equal', 2, 3, []],
    ['removed', 3, -1, []],
    ['equal', 4, 4, []],
  ]);
  assert.deepEqual(diff.stats, { changed: 0, removed: 1, added: 1 });
});

test('an edited row next to an inserted one pairs with its own earlier version', () => {
  const right = [PEOPLE[0], PEOPLE[1], ['Eve', '9', 'Thun'], ['Bob', '2', 'Biel'], PEOPLE[3], PEOPLE[4]];
  const diff = compareRows(PEOPLE, right);
  assert.deepEqual(summary(diff).slice(2, 4), [
    ['added', -1, 2, []],
    ['changed', 2, 3, [2]],
  ]);
});

test('rows with nothing in common are still paired in order', () => {
  const diff = compareRows([['a', 'b'], ['c', 'd']], [['w', 'x'], ['y', 'z'], ['q', 'r']]);
  assert.deepEqual(summary(diff), [
    ['changed', 0, 0, [0, 1]],
    ['changed', 1, 1, [0, 1]],
    ['added', -1, 2, []],
  ]);
});

test('an inserted column is a column difference, not one in every row', () => {
  const right = PEOPLE.map((row, i) => [row[0], i === 0 ? 'Age' : String(30 + i), row[1], row[2]]);
  const diff = compareRows(PEOPLE, right);
  assert.deepEqual(diff.columns, [
    { left: 0, right: 0 },
    { left: -1, right: 1 },
    { left: 1, right: 2 },
    { left: 2, right: 3 },
  ]);
  assert.deepEqual(diff.columnStats, { removed: 0, added: 1 });
  assert.deepEqual(diff.stats, { changed: 0, removed: 0, added: 0 });
});

test('a deleted column and an edit in another one are told apart', () => {
  const right = PEOPLE.map((row) => (row[0] === 'Cid' ? ['Cid', 'Zug'] : [row[0], row[2]]));
  const diff = compareRows(PEOPLE, right);
  assert.deepEqual(diff.columnStats, { removed: 1, added: 0 });
  assert.deepEqual(diff.stats, { changed: 1, removed: 0, added: 0 });
  // The cell index refers to the aligned columns, where City comes third.
  assert.deepEqual(summary(diff)[3], ['changed', 3, 3, [2]]);
});

test('a column whose values all changed stays the same column', () => {
  const right = PEOPLE.map((row, i) => (i === 0 ? row : [row[0], String(i * 100), row[2]]));
  const diff = compareRows(PEOPLE, right);
  assert.deepEqual(diff.columnStats, { removed: 0, added: 0 });
  assert.deepEqual(diff.stats, { changed: 4, removed: 0, added: 0 });
  assert.ok(diff.rows.slice(1).every((row) => row.cells.length === 1 && row.cells[0] === 1));
});

test('ignore options apply to each cell', () => {
  const left = [['Alpha', 'two  words']];
  const right = [['ALPHA', ' two words']];
  assert.equal(compareRows(left, right).stats.changed, 1);
  assert.equal(compareRows(left, right, { ignoreCase: true }).rows[0].cells.length, 1);
  assert.equal(compareRows(left, right, { ignoreCase: true, ignoreWhitespace: true }).stats.changed, 0);
});

test('missing cells at the end of a row equal empty ones', () => {
  const diff = compareRows([['a', 'b'], ['c']], [['a', 'b'], ['c', '']]);
  assert.deepEqual(diff.stats, { changed: 0, removed: 0, added: 0 });
});

test('sheets pair up by name, then in order, and the rest stands alone', () => {
  const left = [sheet([['x']], 'Data'), sheet([['old']], 'Old'), sheet([['same']], 'Notes')];
  const right = [sheet([['same']], 'Notes'), sheet([['new']], 'New'), sheet([['x']], 'Data'), sheet([['y']], 'Extra')];
  const diffs = compare(left, right);
  assert.deepEqual(
    diffs.map((diff) => [diff.name, diff.left && diff.left.name, diff.right && diff.right.name]),
    [
      ['Data', 'Data', 'Data'],
      ['Old → New', 'Old', 'New'],
      ['Notes', 'Notes', 'Notes'],
      ['Extra', null, 'Extra'],
    ]
  );
  assert.deepEqual(diffs[1].stats, { changed: 1, removed: 0, added: 0 });
  assert.deepEqual(summary(diffs[3]), [['added', -1, 0, []]]);
});

test('a single unnamed sheet pairs with the first sheet of a workbook', () => {
  const diffs = compare([sheet([['x']], '')], [sheet([['x']], 'Data'), sheet([['y']], 'More')]);
  assert.deepEqual(
    diffs.map((diff) => diff.name),
    ['Data', 'More']
  );
  assert.deepEqual(diffs[0].stats, { changed: 0, removed: 0, added: 0 });
});
