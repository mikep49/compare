const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('../src/renderer/diff-engine');
const { changes, syncPoints, align, pieces, runAt, lineStarts } = require('../src/renderer/doc-align');

// The text of each stretch, to compare by what it covers.
const texts = (text, ranges) => ranges.map(({ start, end }) => text.slice(start, end));
const spans = (text, ranges) => ranges.map(([start, end]) => text.slice(start, end));

test('line starts follow every kind of line break', () => {
  assert.deepEqual(lineStarts('a\r\nbc\rd\n'), [0, 3, 6, 8]);
  assert.deepEqual(lineStarts(''), [0]);
});

test('changes mark changed words, and whole lines removed or added', () => {
  const left = 'Intro\nThe quick brown fox\nGone line\nSame\nEnd';
  const right = 'Intro\nThe quick red fox\nSame\nNew line\nEnd';
  const { rows } = compare(left, right);
  const l = changes(rows, left, 'left');
  const r = changes(rows, right, 'right');
  assert.deepEqual(texts(left, l.ranges), ['brown', 'Gone line']);
  assert.deepEqual(texts(right, r.ranges), ['red', 'New line']);
  assert.deepEqual(
    l.ranges.map((range) => range.block),
    [0, 0]
  );
  assert.deepEqual(
    r.ranges.map((range) => range.block),
    [0, 1]
  );
  // The second run only adds a line: on the left it goes before "End".
  assert.equal(l.anchors.length, 2);
  assert.equal(left.slice(l.anchors[0]), 'brown fox\nGone line\nSame\nEnd');
  assert.equal(left.slice(l.anchors[1]), 'End');
  assert.equal(right.slice(r.anchors[1]), 'New line\nEnd');
});

test('changed words with only spaces between them are marked as one', () => {
  const left = 'the meaning given to such term on Schedule I, or as stated';
  const right = 'the meaning set forth in the Schedule I, and as stated';
  const { rows } = compare(left, right);
  // The original has a space more, which counts as changed too; spaces
  // aren't marked on the document either way.
  const trimmed = (text, side) => texts(text, changes(rows, text, side).ranges).map((part) => part.trim());
  assert.deepEqual(trimmed(left, 'left'), ['given to such term on', 'or']);
  assert.deepEqual(trimmed(right, 'right'), ['set forth in the', 'and']);
});

test('an insertion at the very end anchors at the end of the other side', () => {
  const { rows } = compare('a\nb', 'a\nb\nc');
  const { ranges, anchors } = changes(rows, 'a\nb', 'left');
  assert.deepEqual(ranges, []);
  assert.deepEqual(anchors, [3]);
});

test('sync points pair the starts of lines shown side by side', () => {
  const left = 'one\ntwo\nthree';
  const right = 'zero\none\ntwo\nthree';
  const { rows } = compare(left, right);
  assert.deepEqual(syncPoints(rows, left, right), [
    [0, 5],
    [4, 9],
    [8, 13],
  ]);
});

test('texts that differ only in whitespace line up exactly', () => {
  const source = 'Each of the following terms\nhas the meaning given to such term';
  const target = 'Each of the following terms has the\nmeaning given  to such term';
  const aligner = align(source, target);
  assert.equal(aligner.coverage, 1);
  const start = source.indexOf('given');
  // A stretch of several words stays in one piece, spaces and all.
  assert.deepEqual(spans(target, aligner.ranges(start, source.length)), ['given  to such term']);
  assert.equal(target.slice(aligner.point(source.indexOf('has'))), 'has the\nmeaning given  to such term');
});

test('text only the document has, such as a page header, is passed over', () => {
  const source = 'First paragraph here.\nSecond paragraph, changed.\nThird one.';
  const target = 'First paragraph here.\nContract - Page 2\nSecond paragraph, changed.\nThird one.';
  const aligner = align(source, target);
  assert.equal(aligner.coverage, 1);
  const start = source.indexOf('changed');
  assert.deepEqual(spans(target, aligner.ranges(start, start + 'changed'.length)), ['changed']);
  assert.equal(target.slice(aligner.point(source.indexOf('Second'))).split('\n')[0], 'Second paragraph, changed.');
});

test('words split or joined differently still line up', () => {
  // A PDF may cut a word in two; a Word file may hold symbols the text left out.
  const source = 'It was amended\nby both parties.';
  const target = 'It was amend|ed by both par ties.';
  const aligner = align(source, target);
  assert.ok(aligner.coverage > 0.99);
  const start = source.indexOf('amended');
  assert.deepEqual(spans(target, aligner.ranges(start, start + 'amended'.length)), ['amend', 'ed']);
  const both = source.indexOf('both');
  assert.deepEqual(spans(target, aligner.ranges(both, source.length)), ['both par ties.']);
});

test('text missing from the document maps to nothing', () => {
  const aligner = align('alpha\nbeta\ngamma', 'alpha\ngamma');
  const start = 'alpha\n'.length;
  assert.deepEqual(aligner.ranges(start, start + 4), []);
  // A place without a counterpart goes to the next one that has one.
  assert.equal(aligner.point(start), 'alpha\n'.length);
  assert.ok(aligner.coverage < 1);
});

test('a place past everything that has a counterpart goes after the last one', () => {
  const aligner = align('one two', 'one');
  assert.equal(aligner.point('one '.length), 3);
  assert.equal(align('', 'x').point(0), 0);
});

test('pieces cut a stretch at the runs of the document', () => {
  // "Hello " + "wor" + "" + "ld" in one paragraph, then "Next" in another.
  const model = { runStarts: Int32Array.from([0, 6, 9, 9, 12]), runEnds: Int32Array.from([6, 9, 9, 11, 16]) };
  assert.deepEqual(pieces(4, 11, model, [], { block: 2 }), [
    { run: 0, start: 4, end: 6, block: 2 },
    { run: 1, start: 0, end: 3, block: 2 },
    { run: 3, start: 0, end: 2, block: 2 },
  ]);
  // The gap between runs is left out.
  assert.deepEqual(pieces(10, 14, model, []), [
    { run: 3, start: 1, end: 2 },
    { run: 4, start: 0, end: 2 },
  ]);
  assert.equal(runAt(7, model), 1);
  assert.equal(runAt(11, model), 3);
  assert.equal(runAt(0, model), 0);
});

test('a whole document lines up in good time', () => {
  const paragraph = (i) => `Clause ${i}. The parties agree that clause ${i} applies to every Service delivered under this Contract.`;
  const lines = Array.from({ length: 5000 }, (_, i) => paragraph(i));
  const source = lines.join('\n');
  // Laid out with other line breaks and a header on every "page".
  const target = lines.map((line, i) => (i % 40 === 0 ? `Header ${i / 40}\n` : '') + line.replace(/ that /g, '\nthat ')).join(' ');
  const started = Date.now();
  const aligner = align(source, target);
  assert.ok(Date.now() - started < 5000);
  assert.equal(aligner.coverage, 1);
  const start = source.indexOf('clause 4321');
  assert.deepEqual(spans(target, aligner.ranges(start, start + 'clause 4321'.length)), ['clause 4321']);
});

test('blank lines one side has more of are passed over', () => {
  const left = 'One.\n\n\nTwo here.\n\n\nThree.';
  const right = 'One.\n\nTwo there.\n\nThree.';
  const { rows } = compare(left, right);
  assert.deepEqual(texts(left, changes(rows, left, 'left').ranges), ['here']);
  assert.deepEqual(texts(right, changes(rows, right, 'right').ranges), ['there']);
  assert.deepEqual(
    spans(left, syncPoints(rows, left, right).map(([start]) => [start, left.indexOf('\n', start) + 1 || left.length])),
    ['One.\n', '\n', 'Two here.\n', '\n', 'Three.']
  );
});
