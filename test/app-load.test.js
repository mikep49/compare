const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CodeLanguages = require('../src/code-languages');

// Run the renderer's file-opening code without Electron or a DOM.
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const opening = app.slice(app.indexOf('const loads ='), app.indexOf('function openPaths('));

function setup() {
  const pending = new Map();
  const messages = [];
  const workspaces = Object.fromEntries(
    ['docs', 'sheets', 'code', 'files'].map((kind) => {
      const panes = { left: { text: '', loading: 0 }, right: { text: '', loading: 0 } };
      return [kind, {
        kind,
        panes,
        isEmpty: (side) => !panes[side].text && !panes[side].loading,
        setLoading(side, name, load) {
          if (name !== null || panes[side].loading === load) panes[side].loading = name === null ? 0 : load;
        },
        setText(side, text, file) {
          Object.assign(panes[side], { text, file });
        },
      }];
    })
  );
  const context = vm.createContext({
    workspaces,
    active: workspaces.docs,
    CodeLanguages,
    SHEET_FILE: /\.(xlsx|csv)$/i,
    activate(kind) { context.active = workspaces[kind]; },
    showMessage(message) { messages.push(message); },
    window: {
      compareApi: {
        parseFile(file) {
          return new Promise((resolve, reject) => pending.set(file.name, { resolve, reject }));
        },
      },
    },
  });
  vm.runInContext(opening, context, { filename: 'app.js' });
  return {
    workspaces,
    messages,
    activate: context.activate,
    open: (side, name, options) => context.loadFile(side, { name }, options),
    finish: (name, result) => pending.get(name).resolve({ ok: true, text: name, ...result }),
    fail: (name) => pending.get(name).reject(new Error('read failed')),
  };
}

for (const side of ['left', 'right']) {
  for (const order of [['report.docx', 'script.js'], ['script.js', 'report.docx']]) {
    test(`${side}: document and code loads both finish when ${order[0]} finishes first`, async () => {
      const app = setup();
      const document = app.open(side, 'report.docx');
      app.activate('code');
      const code = app.open(side, 'script.js');
      const loads = { 'report.docx': document, 'script.js': code };
      for (const name of order) {
        app.finish(name);
        await loads[name];
      }
      assert.equal(app.workspaces.docs.panes[side].text, 'report.docx');
      assert.equal(app.workspaces.code.panes[side].text, 'script.js');
      assert.equal(app.workspaces.docs.panes[side].loading, 0);
      assert.equal(app.workspaces.code.panes[side].loading, 0);
    });
  }
}

test('Explorer loads use their own workspace counters, including spreadsheets', async () => {
  const app = setup();
  const document = app.open('left', 'report.docx', { fromExplorer: true });
  const sheet = app.open('left', 'costs.xlsx', { fromExplorer: true });
  const code = app.open('left', 'script.js', { fromExplorer: true });
  app.finish('script.js');
  await code;
  app.finish('costs.xlsx', { sheets: [{ name: 'Costs', rows: [] }] });
  await sheet;
  app.finish('report.docx');
  await document;
  assert.equal(app.workspaces.docs.panes.left.file.name, 'report.docx');
  assert.equal(app.workspaces.sheets.panes.left.file.name, 'costs.xlsx');
  assert.equal(app.workspaces.code.panes.left.file.name, 'script.js');
});

test('left and right loads in one workspace finish independently', async () => {
  const app = setup();
  const left = app.open('left', 'original.txt');
  const right = app.open('right', 'changed.txt');
  app.finish('changed.txt');
  await right;
  app.finish('original.txt');
  await left;
  assert.equal(app.workspaces.docs.panes.left.text, 'original.txt');
  assert.equal(app.workspaces.docs.panes.right.text, 'changed.txt');
});

for (const newerFirst of [false, true]) {
  test(`a replaced load is discarded when the ${newerFirst ? 'newer' : 'older'} load finishes first`, async () => {
    const app = setup();
    const older = app.open('left', 'older.txt');
    const newer = app.open('left', 'newer.txt');
    if (newerFirst) {
      app.finish('newer.txt');
      await newer;
      app.finish('older.txt');
      await older;
    } else {
      app.finish('older.txt');
      await older;
      assert.equal(app.workspaces.docs.panes.left.text, '');
      assert.notEqual(app.workspaces.docs.panes.left.loading, 0);
      app.finish('newer.txt');
      await newer;
    }
    assert.equal(app.workspaces.docs.panes.left.text, 'newer.txt');
    assert.equal(app.workspaces.docs.panes.left.loading, 0);
  });
}

test('a failed load still reports its error after a load in another workspace', async () => {
  const app = setup();
  const document = app.open('left', 'report.docx');
  app.activate('code');
  const code = app.open('left', 'script.js');
  app.finish('script.js');
  await code;
  app.fail('report.docx');
  await document;
  assert.deepEqual(app.messages, ["Couldn't open report.docx: read failed"]);
  assert.equal(app.workspaces.docs.panes.left.loading, 0);
});
