const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const update = require('../src/update');

const source = fs.readFileSync(path.join(__dirname, '../src/updater.js'), 'utf8');
const response = (version) => ({ ok: true, json: async () => ({ tag_name: `v${version}`, assets: [] }) });

function setup(fetch, packaged = false) {
  const handlers = new Map();
  const scheduled = [];
  const opened = [];
  const sent = [];
  const context = vm.createContext({
    module: { exports: {} },
    AbortSignal,
    process: { env: {}, execPath: 'C:\\Compare\\Compare.exe' },
    setTimeout: (callback) => scheduled.push(callback),
    setInterval: (callback) => scheduled.push(callback),
    require(name) {
      if (name === 'electron') return {
        app: { isPackaged: packaged, getVersion: () => '1.4.0', getPath: () => 'C:\\Temp', on() {} },
        ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
        net: { fetch },
        BrowserWindow: { getAllWindows: () => [{ webContents: { send: (_channel, state) => sent.push(state) } }] },
        shell: { openExternal: async (url) => opened.push(url) },
      };
      // Keep startup cleanup away from the real filesystem.
      if (name === 'node:fs') return { existsSync: () => false, rmSync() {} };
      if (name === './update') return update;
      return require(name);
    },
  });
  vm.runInContext(source, context, { filename: 'updater.js' });
  context.module.exports.startUpdater();
  return {
    check: () => handlers.get('check-for-updates')(),
    state: () => handlers.get('update-state')(),
    run: () => handlers.get('update')(),
    scheduled, opened, sent,
  };
}

test('manual checks report an up-to-date copy and a newer release', async () => {
  for (const version of ['1.3.0', '1.4.0', '1.5.0']) {
    const app = setup(async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return response(version);
    });
    const result = await app.check();
    assert.equal(result.ok, true);
    assert.equal(result.state.status, version === '1.5.0' ? 'available' : 'none');
    if (version === '1.5.0') assert.equal(result.state.version, version);
  }
});

test('offline, failed and invalid checks report an error and allow retry', async () => {
  for (const fail of [
    () => { throw new Error('Offline'); },
    () => ({ ok: false, status: 503 }),
    () => ({ ok: true, json: async () => ({ tag_name: 'invalid' }) }),
    () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } }),
  ]) {
    let attempt = 0;
    const app = setup(async () => ++attempt === 1 ? fail() : response('1.5.0'));
    const failure = await app.check();
    assert.equal(failure.ok, false);
    assert.match(failure.error, /Couldn't check for updates/);
    assert.equal(app.state().status, 'none');
    assert.equal((await app.check()).state.version, '1.5.0');
  }
});

test('overlapping startup and manual checks share one request', async () => {
  let finish;
  let requests = 0;
  const app = setup(() => {
    requests++;
    return new Promise((resolve) => { finish = resolve; });
  }, true);
  assert.equal(app.scheduled.length, 2);
  const background = app.scheduled[0]();
  const manual = app.check();
  assert.equal(background, manual);
  assert.equal(requests, 1);
  finish(response('1.5.0'));
  assert.equal((await manual).state.version, '1.5.0');
});

test('failed checks preserve an available update, and a withdrawn release clears it', async () => {
  let latest = response('1.5.0');
  const app = setup(async () => {
    if (latest instanceof Error) throw latest;
    return latest;
  });
  await app.check();
  latest = new Error('Offline');
  assert.equal((await app.check()).ok, false);
  assert.equal(app.state().version, '1.5.0');
  latest = response('1.4.0');
  assert.equal((await app.check()).state.status, 'none');
});

test('source builds check manually and open the release page without scheduling updates', async () => {
  const app = setup(async () => response('1.5.0'));
  assert.equal(app.scheduled.length, 0);
  assert.equal((await app.check()).state.manual, true);
  assert.equal((await app.run()).ok, true);
  assert.deepEqual(app.opened, [update.RELEASES_PAGE]);
});
