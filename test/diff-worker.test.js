const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker: NodeWorker } = require('node:worker_threads');
const createDiffer = require('../src/renderer/diff-client');
const CodeDiff = require('../src/renderer/code-diff');
const DiffEngine = require('../src/renderer/diff-engine');
const TableDiff = require('../src/renderer/table-diff');
const TableText = require('../src/table-text');

// Run the actual browser worker and its importScripts dependencies on a real
// background thread, with browser globals rather than CommonJS exports.
class BrowserWorker {
  constructor(file) {
    this.thread = new NodeWorker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const fs = require('node:fs');
      const path = require('node:path');
      const vm = require('node:vm');
      const context = vm.createContext({});
      context.self = context;
      context.postMessage = (data) => parentPort.postMessage(data);
      context.importScripts = (...files) => {
        for (const file of files) {
          const location = path.resolve(path.dirname(workerData), file);
          vm.runInContext(fs.readFileSync(location, 'utf8'), context, { filename: location });
        }
      };
      vm.runInContext(fs.readFileSync(workerData, 'utf8'), context, { filename: workerData });
      parentPort.on('message', (data) => context.onmessage({ data }));
    `, { eval: true, workerData: path.join(__dirname, '../src/renderer', file) });
    this.thread.on('message', (data) => this.onmessage?.({ data }));
    this.thread.on('error', (error) => this.onerror?.({ message: error.message, preventDefault() {} }));
    this.thread.on('messageerror', () => this.onmessageerror?.());
  }

  postMessage(data) { this.thread.postMessage(data); }
  terminate() { this.thread.terminate(); }
}

function setup(t) {
  const differ = createDiffer(BrowserWorker);
  t.after(() => differ.cancel());
  return differ;
}

test('code worker preserves word changes, typed indexes, options and missing final newlines', async (t) => {
  const differ = setup(t);
  const left = 'function test() {\n  return OLD;\n}\n';
  const right = 'function test() {\n  return NEW;\n}';
  for (const options of [{}, { ignoreCase: true, ignoreWhitespace: true }]) {
    const result = await differ.compare('code', left, right, options);
    assert.deepEqual(result, CodeDiff.compare(left, right, options));
    assert.ok(result.blockOf instanceof Int32Array);
    assert.equal(CodeDiff.patch(result, { leftName: 'a.js', rightName: 'b.js' }),
      CodeDiff.patch(CodeDiff.compare(left, right, options), { leftName: 'a.js', rightName: 'b.js' }));
  }
});

test('document comparisons still run in the worker', async (t) => {
  const differ = setup(t);
  const options = { ignoreCase: true };
  assert.deepEqual(await differ.compare('docs', 'Hello world\n', 'hello moon\n', options),
    DiffEngine.compare('Hello world\n', 'hello moon\n', options));
});

test('spreadsheet worker parses pasted cells and returns workbook sheet indexes', async (t) => {
  const differ = setup(t);
  const left = [
    { name: 'Kept', rows: [['Item', 'Value'], ['A', 'ONE']] },
    { name: 'Removed', rows: [['old']] },
  ];
  const right = [
    { name: 'Added', rows: [['new']] },
    { name: 'Kept', rows: [['Item', 'Value'], ['A', 'one']] },
    { name: 'Extra', rows: [['extra']] },
  ];
  const options = { ignoreCase: true };
  const result = await differ.compare('sheets', { sheets: left }, { sheets: right }, options);
  const expected = TableDiff.compare(left, right, options);
  assert.deepEqual(result, expected.map((diff) => ({
    ...diff, leftIndex: left.indexOf(diff.left), rightIndex: right.indexOf(diff.right),
  })));
  const pasted = 'Item\tValue\nA\tone\n';
  const parsed = await differ.compare('sheets', { text: pasted }, { sheets: right }, options);
  assert.deepEqual(parsed.map(({ leftIndex, rightIndex, ...diff }) => diff),
    TableDiff.compare(TableText.toSheets(pasted), right, options));
  const empty = await differ.compare('sheets', { text: '' }, { text: '' }, {});
  assert.equal(empty[0].rows.length, 0);
});

test('a 10,000-line comparison lets the calling thread run timers before it finishes', { timeout: 15000 }, async (t) => {
  const differ = setup(t);
  // Warm the worker so the check covers the calculation, not just startup.
  await differ.compare('code', '', '', {});
  const left = Array.from({ length: 10000 }, (_, i) => `const a${i} = 1;`).join('\n');
  const right = Array.from({ length: 10000 }, (_, i) => `const b${i} = 2;`).join('\n');
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  t.after(() => clearInterval(timer));
  const result = await differ.compare('code', left, right, {});
  assert.ok(ticks >= 5, `only ${ticks} timer ticks during the comparison`);
  assert.equal(result.rows.length, 10000);
  assert.deepEqual(result.stats, { additions: 10000, deletions: 10000 });
});

test('workspaces run independently and cancelling one settles its pending job', async (t) => {
  const first = setup(t);
  const second = setup(t);
  const pending = first.compare('code', 'old\n'.repeat(10000), 'new\n'.repeat(10000), {});
  const other = second.compare('sheets', { text: 'a\t1' }, { text: 'a\t2' }, {});
  first.cancel();
  assert.equal(await pending, null);
  assert.equal((await other)[0].stats.changed, 1);
  assert.deepEqual((await first.compare('code', 'a\n', 'b\n', {})).stats, { additions: 1, deletions: 1 });
});

test('replacing a pending job ignores its late messages', async () => {
  const workers = [];
  class ControlledWorker {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const differ = createDiffer(ControlledWorker);
  const old = differ.compare('code', 'old', 'old', {});
  const newer = differ.compare('code', 'new', 'new', {});
  assert.equal(await old, null);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: 'stale' });
  workers[1].onmessage({ data: 'current' });
  assert.equal(await newer, 'current');
  differ.cancel();
});

test('worker startup, messaging and execution failures reject and allow a retry', async () => {
  for (const failure of ['startup', 'post', 'error', 'messageerror']) {
    let broken = true;
    let worker;
    class FailingWorker {
      constructor() {
        if (broken && failure === 'startup') throw new Error('startup failed');
        worker = this;
      }
      postMessage() {
        if (broken && failure === 'post') throw new Error('post failed');
      }
      terminate() { this.terminated = true; }
    }
    const differ = createDiffer(FailingWorker);
    const pending = differ.compare('code', '', '', {});
    if (failure === 'error') worker.onerror({ message: 'execution failed', preventDefault() {} });
    if (failure === 'messageerror') worker.onmessageerror();
    await assert.rejects(pending);
    if (worker) assert.equal(worker.terminated, true);
    broken = false;
    const retry = differ.compare('code', '', '', {});
    worker.onmessage({ data: 'retried' });
    assert.equal(await retry, 'retried');
    differ.cancel();
  }
});
