const test = require('node:test');
const assert = require('node:assert/strict');
const Diff = require('diff');
const CodeDiff = require('../src/renderer/code-diff');

const text = (lines) => `${lines.join('\n')}\n`;
const shape = (diff) => diff.rows.map((row) => [row.type, row.left?.text ?? null, row.right?.text ?? null]);
const all = (diff) => new Uint8Array(diff.rows.length).fill(1);

test('blank lines count as lines, and a changed line pairs up with its word changes', () => {
  const diff = CodeDiff.compare(text(['a', '', 'let x = 1;']), text(['a', 'let x = 2;']));
  assert.deepEqual(shape(diff), [
    ['equal', 'a', 'a'],
    ['changed', '', 'let x = 2;'],
    ['removed', 'let x = 1;', null],
  ]);
  assert.deepEqual(diff.stats, { additions: 1, deletions: 2 });
  assert.deepEqual(diff.blocks, [1]);
  assert.deepEqual([...diff.blockOf], [-1, 0, 0]);

  const words = CodeDiff.compare('let x = 1;\n', 'let x = 2;\n').rows[0];
  assert.deepEqual(
    words.right.segments.filter((segment) => segment.changed).map((segment) => segment.text),
    ['2']
  );
  // Lines with little in common are marked as lines, not word by word.
  assert.equal(CodeDiff.compare('alpha beta gamma\n', 'one two three\n').rows[0].left.segments, null);
});

test('a function added between two others keeps the braces where they belong', () => {
  const left = ['function a() {', '  return 1;', '}', '', 'function c() {', '  return 3;', '}'];
  const right = [...left.slice(0, 4), 'function b() {', '  return 2;', '}', '', ...left.slice(4)];
  const added = CodeDiff.compare(text(left), text(right)).rows.filter((row) => row.type === 'added');
  assert.deepEqual(
    added.map((row) => row.right.text),
    ['function b() {', '  return 2;', '}', '']
  );
  // Without blank lines, the run goes down as far as it can.
  const block = ['  if (a) {', '    x();', '  }', '}'];
  const more = [...block.slice(0, 3), '  if (b) {', '    y();', '  }', '}'];
  assert.deepEqual(
    CodeDiff.compare(text(block), text(more))
      .rows.filter((row) => row.type === 'added')
      .map((row) => row.right.text),
    ['  if (b) {', '    y();', '  }']
  );
});

test('hunks have git headers, with the function they are in', () => {
  const left = ['import x', '', 'def first():', ...Array.from({ length: 10 }, (_, i) => `    a${i} = ${i}`), '', 'def second():', '    return 1'];
  const right = [...left];
  right[8] = '    a5 = 50';
  right.push('    # done');
  const diff = CodeDiff.compare(text(left), text(right));
  const hunks = CodeDiff.hunks(diff, CodeDiff.initialShown(diff));
  // As in git, the function is the one before the hunk starts.
  assert.deepEqual(
    hunks.map(({ gap, hunk }) => [gap.end - gap.start, hunk && hunk.header]),
    [
      [5, '@@ -6,7 +6,7 @@ def first():'],
      [1, '@@ -14,3 +14,4 @@ def first():'],
    ]
  );
  const later = CodeDiff.compare(text([...left, '', 'x = 1', 'y = 2', 'z = 3']), text([...left, '', 'x = 1', 'y = 2', 'z = 4']));
  assert.equal(CodeDiff.hunks(later, CodeDiff.initialShown(later))[0].hunk.header, '@@ -17,4 +17,4 @@ def second():');
  // A single line has no count, and an empty side starts at the line before.
  const one = CodeDiff.compare('a\n', 'b\n');
  assert.equal(CodeDiff.hunks(one, all(one))[0].hunk.header, '@@ -1 +1 @@');
  const added = CodeDiff.compare('', 'x\ny\n');
  assert.equal(CodeDiff.hunks(added, all(added))[0].hunk.header, '@@ -0,0 +1,2 @@');
});

test('folded rows come back where they are asked for', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  const changed = [...lines];
  changed[0] = 'first';
  changed[59] = 'last';
  const diff = CodeDiff.compare(text(lines), text(changed));
  const shown = CodeDiff.initialShown(diff);
  const gaps = () => CodeDiff.hunks(diff, shown).map(({ gap, hunk }) => [gap.start, gap.end, Boolean(hunk)]);
  assert.deepEqual(gaps(), [
    [0, 0, true],
    [4, 56, true],
  ]);
  shown.fill(1, 4, 24);
  assert.deepEqual(gaps(), [
    [0, 0, true],
    [24, 56, true],
  ]);
  assert.match(CodeDiff.hunks(diff, shown)[0].hunk.header, /^@@ -1,24 \+1,24 @@/);
  // Folded rows at the end come last, without a hunk.
  const end = CodeDiff.compare(text(changed.slice(0, 50)), text(lines.slice(0, 50)));
  assert.deepEqual(
    CodeDiff.hunks(end, CodeDiff.initialShown(end)).map(({ gap, hunk }) => [gap.start, gap.end, Boolean(hunk)]),
    [
      [0, 0, true],
      [4, 50, false],
    ]
  );
});

test('the unified layout puts removed lines before added ones', () => {
  const diff = CodeDiff.compare(text(['a', 'b', 'c', 'd']), text(['a', 'B', 'C', 'd']));
  assert.deepEqual(
    CodeDiff.unified(diff.rows, 0, diff.rows.length).map(({ row, side }) => (side ? diff.rows[row][side].text : diff.rows[row].left.text)),
    ['a', 'b', 'c', 'B', 'C', 'd']
  );
});

test('a missing line break at the end is a change, unless whitespace is ignored', () => {
  const diff = CodeDiff.compare('a\nb\n', 'a\nb');
  assert.deepEqual(shape(diff), [
    ['equal', 'a', 'a'],
    ['changed', 'b', 'b'],
  ]);
  assert.equal(diff.rows[1].left.noEol, false);
  assert.equal(diff.rows[1].right.noEol, true);
  assert.equal(CodeDiff.compare('a\nb\n', 'a\nb', { ignoreWhitespace: true }).blocks.length, 0);
  // Both without one is no change.
  assert.equal(CodeDiff.compare('a\nb', 'a\nb').blocks.length, 0);
});

test('ignoring whitespace and case', () => {
  assert.equal(CodeDiff.compare('if x:\n    y()\n', 'if x:\n  y()\n', { ignoreWhitespace: true }).blocks.length, 0);
  assert.equal(CodeDiff.compare('SELECT 1\n', 'select 1\n', { ignoreCase: true }).blocks.length, 0);
  assert.equal(CodeDiff.compare('SELECT 1\n', 'select 1\n').blocks.length, 1);
});

test('a patch turns the original into the changed code, line breaks and all', () => {
  const left = Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`);
  const right = [...left];
  right[3] = 'const v3 = 30;';
  right.splice(20, 2);
  right.splice(30, 0, '', 'const added = true;');
  const cases = [
    [text(left), text(right)],
    [text(left), right.join('\n')],
    [left.join('\n'), text(right)],
    ['', text(right)],
    [text(left), ''],
  ];
  for (const [before, after] of cases) {
    const patch = CodeDiff.patch(CodeDiff.compare(before, after), { leftName: 'a.js', rightName: 'b.js' });
    assert.equal(Diff.applyPatch(before, patch), after);
  }
  const patch = CodeDiff.patch(CodeDiff.compare(text(left), right.join('\n')), { leftName: 'a.js', rightName: 'b.js' });
  assert.match(patch, /^--- a\/a\.js\n\+\+\+ b\/b\.js\n@@ -1,7 \+1,7 @@\n/);
  assert.match(patch, /\+const v39 = 39;\n\\ No newline at end of file\n$/);
  assert.equal(CodeDiff.patch(CodeDiff.compare('same\n', 'same\n'), { leftName: 'a', rightName: 'b' }), '');
});

test('the five squares share out added and removed lines', () => {
  assert.deepEqual(CodeDiff.diffstat({ additions: 0, deletions: 0 }), ['neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
  assert.deepEqual(CodeDiff.diffstat({ additions: 2, deletions: 1 }), ['added', 'added', 'removed', 'neutral', 'neutral']);
  assert.deepEqual(CodeDiff.diffstat({ additions: 100, deletions: 1 }), ['added', 'added', 'added', 'added', 'removed']);
  assert.deepEqual(CodeDiff.diffstat({ additions: 0, deletions: 9 }), ['removed', 'removed', 'removed', 'removed', 'removed']);
});
