const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the renderer's async comparison lifecycle without a DOM, as in
// app-load.test.js. The real worker and algorithms are covered separately.
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const functions = [
  app.slice(app.indexOf('  function setBusy('), app.indexOf('  // Shows what DiffEngine.compare()')),
  app.slice(app.indexOf('  function compareCode('), app.indexOf('  function showCode(')),
  app.slice(app.indexOf('  const sheetInput ='), app.indexOf('  function showSheets(')),
  app.slice(app.indexOf('  function exportResult('), app.indexOf("  find('.prev-btn')")),
].join('\n');

function setup(kind) {
  const jobs = [];
  const shown = [];
  const messages = [];
  const context = vm.createContext({
    kind, compareJob: 0, comparisonBusy: false, comparing: true, stale: false,
    root: { hidden: false }, busyEl: { hidden: true }, SIDES: ['left', 'right'], LONG_TEXT: 50000,
    panes: { left: { textarea: { value: 'original' }, file: null }, right: { textarea: { value: 'changed' }, file: null } },
    DiffEngine: { compare() { throw new Error('Unexpected comparison on the UI thread'); } },
    differ: {
      compare(...args) { return new Promise((resolve, reject) => jobs.push({ args, resolve, reject })); },
      cancel() {},
    },
    showCode: (result, keep) => shown.push({ result, keep }),
    showTexts: (result, keep) => shown.push({ result, keep }),
    showSheets: (result, keep) => shown.push({ result, keep }),
    setComparing(value) { context.comparing = value; context.cancelCompare(); },
    renderTopbar() {},
    showMessage: (message) => messages.push(message),
  });
  vm.runInContext(functions, context, { filename: 'app.js' });
  return { context, jobs, shown, messages };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const kind of ['code', 'sheets', 'docs']) {
  const compare = (context, keep = false) => {
    if (kind === 'docs') {
      context.panes.left.textarea.value = 'a'.repeat(50000);
      context.compareTexts({ ignoreCase: true }, keep);
    } else if (kind === 'code') context.compareCode({ ignoreCase: true }, keep);
    else context.compareSheets({ ignoreCase: true }, keep);
  };

  test(`${kind}: pending comparisons show busy state and cannot export incomplete results`, async () => {
    const { context, jobs, shown } = setup(kind);
    compare(context, true);
    assert.equal(context.busyEl.hidden, false);
    assert.equal(context.exportResult('html'), null);
    assert.equal(jobs[0].args[0], kind);
    assert.equal(jobs[0].args[3].ignoreCase, true);
    const result = kind === 'sheets' ? [] : { rows: [] };
    jobs[0].resolve(result);
    await flush();
    assert.equal(context.busyEl.hidden, true);
    assert.deepEqual(shown, [{ result, keep: true }]);
  });

  test(`${kind}: cancelled and superseded comparisons cannot replace the current result`, async () => {
    const { context, jobs, shown } = setup(kind);
    compare(context);
    context.cancelCompare();
    jobs[0].resolve(kind === 'sheets' ? [] : 'cancelled');
    await flush();
    assert.equal(shown.length, 0);
    compare(context);
    compare(context, true);
    jobs[1].resolve(kind === 'sheets' ? [] : 'superseded');
    await flush();
    assert.equal(shown.length, 0);
    assert.equal(context.busyEl.hidden, false);
    jobs[2].resolve(kind === 'sheets' ? [] : 'current');
    await flush();
    assert.equal(shown.length, 1);
    assert.equal(shown[0].keep, true);
    assert.equal(context.busyEl.hidden, true);
  });

  test(`${kind}: hidden workspaces defer rendering until they are shown again`, async () => {
    const { context, jobs, shown } = setup(kind);
    compare(context);
    context.root.hidden = true;
    jobs[0].resolve(kind === 'sheets' ? [] : {});
    await flush();
    assert.equal(shown.length, 0);
    assert.equal(context.stale, true);
    assert.equal(context.busyEl.hidden, true);
  });

  test(`${kind}: worker failure returns to editing without running the comparison on the UI thread`, async () => {
    const { context, jobs, messages, shown } = setup(kind);
    compare(context);
    jobs[0].reject(new Error('worker unavailable'));
    await flush();
    assert.equal(context.comparing, false);
    assert.equal(context.busyEl.hidden, true);
    assert.equal(shown.length, 0);
    assert.deepEqual(messages, ["Couldn't compare: worker unavailable"]);
  });
}

test('loaded sheets reconnect to the original workbook objects after structured cloning', async () => {
  const { context, jobs, shown } = setup('sheets');
  const left = [{ name: 'First', rows: [['old']] }, { name: 'Second', rows: [['kept']] }];
  const right = [{ name: 'Second', rows: [['kept']] }];
  context.panes.left.file = { sheets: left };
  context.panes.right.file = { sheets: right };
  context.compareSheets({}, true);
  jobs[0].resolve(structuredClone([
    { left: left[0], right: null, leftIndex: 0, rightIndex: -1 },
    { left: left[1], right: right[0], leftIndex: 1, rightIndex: 0 },
  ]));
  await flush();
  assert.equal(shown[0].result[0].left, left[0]);
  assert.equal(shown[0].result[0].right, null);
  assert.equal(shown[0].result[1].left, left[1]);
  assert.equal(shown[0].result[1].right, right[0]);
});
