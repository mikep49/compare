const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const update = require('../src/update');

// GitHub's answer for a release, trimmed to what the app reads.
const RELEASE = {
  tag_name: 'v1.3.0',
  html_url: 'https://github.com/mikep49/compare/releases/tag/v1.3.0',
  draft: false,
  prerelease: false,
  assets: [
    {
      name: 'Compare-Portable-1.3.0.exe',
      size: 118681919,
      digest: 'sha256:CD5289A78C33A40F4494E1592978926E6761AEDD3ABB193D4EEA744011059CE3',
      browser_download_url: 'https://github.com/mikep49/compare/releases/download/v1.3.0/Compare-Portable-1.3.0.exe',
    },
    {
      name: 'Compare-Setup-1.3.0.exe',
      size: 118852537,
      browser_download_url: 'https://github.com/mikep49/compare/releases/download/v1.3.0/Compare-Setup-1.3.0.exe',
    },
  ],
};

test('versions are compared part by part, as numbers', () => {
  assert.deepEqual(update.parseVersion('v1.2.0'), [1, 2, 0]);
  assert.equal(update.isNewer('1.3.0', '1.2.0'), true);
  assert.equal(update.isNewer('v1.10.0', '1.9.9'), true);
  assert.equal(update.isNewer('2.0.0', '1.99.99'), true);
  assert.equal(update.isNewer('1.2.0', '1.2.0'), false);
  assert.equal(update.isNewer('1.1.9', '1.2.0'), false);
});

test('anything but a plain version is never newer', () => {
  assert.equal(update.parseVersion('1.3.0-beta.1'), null);
  assert.equal(update.isNewer('1.3.0-beta.1', '1.2.0'), false);
  assert.equal(update.isNewer('latest', '1.2.0'), false);
  assert.equal(update.isNewer(undefined, '1.2.0'), false);
});

test('a release is read with its files and their checksums', () => {
  const release = update.readRelease(RELEASE);
  assert.equal(release.version, '1.3.0');
  assert.equal(release.page, RELEASE.html_url);
  assert.equal(release.assets[0].sha256, 'cd5289a78c33a40f4494e1592978926e6761aedd3abb193d4eea744011059ce3');
  // Files uploaded before GitHub kept checksums are checked by size alone.
  assert.equal(release.assets[1].sha256, null);
});

test('drafts, pre-releases and odd tags are no release to update to', () => {
  assert.equal(update.readRelease({ ...RELEASE, draft: true }), null);
  assert.equal(update.readRelease({ ...RELEASE, prerelease: true }), null);
  assert.equal(update.readRelease({ ...RELEASE, tag_name: 'nightly' }), null);
  assert.equal(update.readRelease(null), null);
});

test('a release page elsewhere than GitHub is replaced by the releases page', () => {
  assert.equal(update.readRelease({ ...RELEASE, html_url: 'https://example.com/' }).page, update.RELEASES_PAGE);
});

test('the installer and the portable exe each update from their own file', () => {
  const release = update.readRelease(RELEASE);
  assert.equal(update.findAsset(release, 'installed').name, 'Compare-Setup-1.3.0.exe');
  assert.equal(update.findAsset(release, 'portable').name, 'Compare-Portable-1.3.0.exe');
  assert.equal(update.findAsset(release, 'manual'), null);
});

test('a release without the right file, or with it somewhere else, has nothing to download', () => {
  const noPortable = update.readRelease({ ...RELEASE, assets: [RELEASE.assets[1]] });
  assert.equal(update.findAsset(noPortable, 'portable'), null);
  const elsewhere = update.readRelease({
    ...RELEASE,
    assets: [{ ...RELEASE.assets[1], browser_download_url: 'https://example.com/Compare-Setup-1.3.0.exe' }],
  });
  assert.equal(update.findAsset(elsewhere, 'installed'), null);
});

test('the way the app runs is told by the portable launcher or the uninstaller', () => {
  const execPath = 'C:\\Users\\me\\AppData\\Local\\Programs\\compare\\Compare.exe';
  const uninstaller = 'C:\\Users\\me\\AppData\\Local\\Programs\\compare\\Uninstall Compare.exe';
  const exists = (file) => file === uninstaller;
  assert.equal(update.installKind({ env: {}, execPath, exists }), 'installed');
  assert.equal(
    update.installKind({ env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\Compare-Portable-1.2.0.exe' }, execPath, exists }),
    'portable'
  );
  assert.equal(update.installKind({ env: {}, execPath: 'D:\\Compare\\Compare.exe', exists }), 'manual');
});

test('a portable exe named after its version takes the new name; a renamed one keeps its name', () => {
  assert.equal(
    update.portableTarget('D:\\Tools\\Compare-Portable-1.2.0.exe', '1.2.0', 'Compare-Portable-1.3.0.exe'),
    'D:\\Tools\\Compare-Portable-1.3.0.exe'
  );
  assert.equal(
    update.portableTarget('D:\\Tools\\compare-portable-1.2.0.EXE', '1.2.0', 'Compare-Portable-1.3.0.exe'),
    'D:\\Tools\\Compare-Portable-1.3.0.exe'
  );
  assert.equal(
    update.portableTarget('D:\\Tools\\Compare.exe', '1.2.0', 'Compare-Portable-1.3.0.exe'),
    'D:\\Tools\\Compare.exe'
  );
});

// The swap script, run for real and started the way the app starts it. A
// running exe can't be replaced or deleted, so a copy of ping, kept busy for
// a couple of seconds, stands in for the portable exe that stays locked until
// its launcher has exited. The folder's name has a space and an ampersand,
// which a command line would trip over.
const windows = process.platform === 'win32';
const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const powershell = path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// Sets off the swap as updater.js does, and resolves once the first
// PowerShell has handed over to the one doing the work.
function swap(paths) {
  const { args, env } = update.swapLaunch({ powershell, ...paths, start: false });
  const child = spawn(powershell, args, { stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`PowerShell stopped with code ${code}`))));
  });
}

// Waits up to 30 seconds for `done` to be true.
async function until(done) {
  for (const started = Date.now(); !done(); ) {
    if (Date.now() - started > 30000) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

// Starts `exe` (a copy of ping) for about two seconds and resolves once it
// runs, with a promise for its end.
function busy(exe) {
  const child = spawn(exe, ['-n', '3', '127.0.0.1'], { stdio: 'ignore' });
  const ended = new Promise((resolve) => child.once('exit', resolve));
  return new Promise((resolve, reject) => {
    child.once('spawn', () => resolve({ ended }));
    child.once('error', reject);
  });
}

function folderForTest() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-swap-'));
  const folder = path.join(parent, 'Tools & Apps');
  fs.mkdirSync(folder);
  return { folder, remove: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test('the swap script waits for the old exe to close, then puts the new one in its place', { skip: !windows }, async () => {
  const { folder, remove } = folderForTest();
  try {
    const old = path.join(folder, 'Compare.exe');
    const download = old + update.PARTIAL;
    fs.copyFileSync(path.join(system32, 'PING.EXE'), old);
    fs.writeFileSync(download, 'new version');
    const { ended } = await busy(old);
    assert.throws(() => fs.rmSync(old), 'the running exe should be locked');
    await swap({ download, target: old, old });
    let pingDone = false;
    ended.then(() => (pingDone = true));
    assert.ok(await until(() => !fs.existsSync(download)), 'the download should have been moved');
    assert.ok(pingDone, 'it should have waited for ping to finish');
    assert.equal(fs.readFileSync(old, 'utf8'), 'new version');
  } finally {
    remove();
  }
});

test('with a new name, the swap script removes the old exe once it has closed', { skip: !windows }, async () => {
  const { folder, remove } = folderForTest();
  try {
    const old = path.join(folder, 'Compare-Portable-1.2.0.exe');
    const target = path.join(folder, 'Compare-Portable-1.3.0.exe');
    const download = target + update.PARTIAL;
    fs.copyFileSync(path.join(system32, 'PING.EXE'), old);
    fs.writeFileSync(download, 'new version');
    await busy(old);
    await swap({ download, target, old });
    assert.ok(await until(() => !fs.existsSync(old)), 'the old exe should have been removed');
    assert.equal(fs.readFileSync(target, 'utf8'), 'new version');
    assert.equal(fs.existsSync(download), false);
  } finally {
    remove();
  }
});
