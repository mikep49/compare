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

test('large texts with nothing in common are compared line by line in good time', () => {
  const lines = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix} ${i} ${(i * 7919) % 10007}`);
  const left = lines('left', 30000);
  const right = lines('right', 30001);
  // A few lines the two have in common, at the same place.
  for (const i of [0, 15000, 29999]) right[i] = left[i];
  const started = Date.now();
  const { rows, stats } = compare(left.join('\n'), right.join('\n'));
  assert.ok(Date.now() - started < 15000);
  assert.equal(rows.length, 30001);
  assert.deepEqual(stats, { changed: 29997, removed: 0, added: 1 });
  assert.equal(rows[15000].type, 'equal');
});

const sides = (rows) => rows.map((r) => [r.type, r.left && r.left.num, text(r.left), r.right && r.right.num, text(r.right)]);

test('paragraphs line up however many blank lines there are between them', () => {
  const left = 'First paragraph.\n\n\nSecond paragraph.\n\n\nThird paragraph.';
  const right = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
  const { rows, stats } = compare(left, right);
  // The changed text has one blank line fewer each time: it's left empty.
  assert.deepEqual(sides(rows), [
    ['equal', 1, 'First paragraph.', 1, 'First paragraph.'],
    ['equal', 2, '', 2, ''],
    ['equal', 3, '', null, null],
    ['equal', 4, 'Second paragraph.', 3, 'Second paragraph.'],
    ['equal', 5, '', 4, ''],
    ['equal', 6, '', null, null],
    ['equal', 7, 'Third paragraph.', 5, 'Third paragraph.'],
  ]);
  assert.deepEqual(stats, { changed: 0, removed: 0, added: 0 });
  // The same the other way round.
  assert.deepEqual(compare(right, left).stats, { changed: 0, removed: 0, added: 0 });
});

test('a changed paragraph stays beside its counterpart when the blank lines differ', () => {
  const left = 'First paragraph.\n\n\nSecond paragraph here.\n\n\nThird paragraph.';
  const right = 'First paragraph.\n\nSecond paragraph there.\n   \nThird paragraph.';
  const { rows, stats } = compare(left, right);
  assert.deepEqual(sides(rows), [
    ['equal', 1, 'First paragraph.', 1, 'First paragraph.'],
    ['equal', 2, '', 2, ''],
    ['equal', 3, '', null, null],
    ['changed', 4, 'Second paragraph here.', 3, 'Second paragraph there.'],
    ['equal', 5, '', 4, '   '],
    ['equal', 6, '', null, null],
    ['equal', 7, 'Third paragraph.', 5, 'Third paragraph.'],
  ]);
  assert.deepEqual(stats, { changed: 1, removed: 0, added: 0 });
});

test('blank lines go with the paragraphs removed or added', () => {
  assert.deepEqual(sides(compare('A\n\nGone\n\nB', 'A\n\nB').rows), [
    ['equal', 1, 'A', 1, 'A'],
    ['equal', 2, '', 2, ''],
    ['removed', 3, 'Gone', null, null],
    ['equal', 4, '', null, null],
    ['equal', 5, 'B', 3, 'B'],
  ]);
  assert.deepEqual(sides(compare('A\n\nB', 'A\nNew\n\nB').rows), [
    ['equal', 1, 'A', 1, 'A'],
    ['added', null, null, 2, 'New'],
    ['equal', 2, '', 3, ''],
    ['equal', 3, 'B', 4, 'B'],
  ]);
  // Blank lines before the first line of text and after the last.
  assert.deepEqual(sides(compare('\n\nA\n\n', 'A\n').rows), [
    ['equal', 1, '', null, null],
    ['equal', 2, '', null, null],
    ['equal', 3, 'A', 1, 'A'],
    ['equal', 4, '', null, null],
  ]);
});
