const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('../src/renderer/diff-engine');

const text = (side) => (side ? side.segments.map((s) => s.text).join('') : null);
const highlighted = (side) => side.segments.filter((s) => s.changed).map((s) => s.text);

test('identical texts produce only equal rows', () => {
  const { rows, stats } = compare('one\ntwo\n', 'one\ntwo');
  assert.deepEqual(rows.map((r) => r.type), ['equal', 'equal']);
  assert.deepEqual(stats, { changed: 0, removed: 0, added: 0 });
});

test('a changed word is highlighted on both sides', () => {
  const { rows, stats } = compare('The quick brown fox jumps', 'The quick red fox jumps');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'changed');
  assert.deepEqual(highlighted(rows[0].left), ['brown']);
  assert.deepEqual(highlighted(rows[0].right), ['red']);
  assert.equal(text(rows[0].left), 'The quick brown fox jumps');
  assert.equal(text(rows[0].right), 'The quick red fox jumps');
  assert.deepEqual(stats, { changed: 1, removed: 0, added: 0 });
});

test('inserted and deleted lines keep the rest aligned', () => {
  const { rows, stats } = compare('a\nb\nc\nd', 'a\nc\nnew\nd');
  assert.deepEqual(
    rows.map((r) => [r.type, text(r.left), text(r.right)]),
    [
      ['equal', 'a', 'a'],
      ['removed', 'b', null],
      ['equal', 'c', 'c'],
      ['added', null, 'new'],
      ['equal', 'd', 'd'],
    ]
  );
  assert.deepEqual(rows.map((r) => r.right && r.right.num), [1, null, 2, 3, 4]);
  assert.deepEqual(stats, { changed: 0, removed: 1, added: 1 });
});

test('unrelated lines are highlighted whole', () => {
  const { rows } = compare('Completely different sentence here', 'Nothing in common at all');
  assert.deepEqual(highlighted(rows[0].left), ['Completely different sentence here']);
  assert.deepEqual(highlighted(rows[0].right), ['Nothing in common at all']);
});

test('ignore options treat case and spacing differences as equal', () => {
  const left = 'Hello   World\n  indented';
  const right = 'hello world\nindented';
  assert.equal(compare(left, right).stats.changed, 2);
  const { rows, stats } = compare(left, right, { ignoreCase: true, ignoreWhitespace: true });
  assert.deepEqual(stats, { changed: 0, removed: 0, added: 0 });
  assert.equal(text(rows[0].left), 'Hello   World');
  assert.equal(text(rows[0].right), 'hello world');
});

test('ignoring whitespace still highlights real word changes', () => {
  const { rows } = compare('alpha  beta gamma delta', 'alpha beta GAMMA delta', { ignoreWhitespace: true });
  assert.deepEqual(highlighted(rows[0].left), ['gamma']);
  assert.deepEqual(highlighted(rows[0].right), ['GAMMA']);
});

test('empty inputs', () => {
  assert.deepEqual(compare('', '').rows, []);
  assert.deepEqual(compare('', 'x').stats, { changed: 0, removed: 0, added: 1 });
});
