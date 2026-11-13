// Updates: asks GitHub now and then whether a newer version is out and, when
// one is, offers it with the button at the bottom of the sidebar. Clicking it
// downloads the new installer or portable exe; clicking it again restarts the
// app on the new version. A downloaded update not applied by then goes in
// when the app is closed. Copies that can't update themselves, like the zip
// build, open the release page instead. See update.js for the details.

const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const update = require('./update');

const FIRST_CHECK = 5 * 1000;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

// Where the installer is downloaded to, emptied at every start.
const downloadFolder = () => path.join(app.getPath('temp'), 'compare-update');

let kind = 'manual';
let release = null;
let asset = null;
// The finished download, and for the portable exe where it goes.
let downloaded = null;
let target = null;

// What the button shows. status is 'none', 'available', 'downloading' (with
// percent), 'ready' or 'restarting'; manual is set when clicking opens the
// release page.
let state = { status: 'none' };
let checking = null;

function setState(changes) {
  state = { ...state, ...changes };
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update-state', state);
}

function clearOldDownloads() {
  try {
    fs.rmSync(downloadFolder(), { recursive: true, force: true });
    if (kind !== 'portable') return;
    const folder = path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
    for (const name of fs.readdirSync(folder)) {
      if (name.endsWith(update.PARTIAL)) fs.rmSync(path.join(folder, name), { force: true });
    }
  } catch {
    // Whatever is left is cleared next time.
  }
}

async function fetchLatest() {
  try {
    const response = await net.fetch(update.LATEST_RELEASE, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Compare/${app.getVersion()}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    const latest = update.readRelease(await response.json());
    if (!latest) throw new Error('GitHub did not return a valid release.');
    // A download may have begun while the check was waiting for GitHub.
    if (['none', 'available'].includes(state.status)) {
      if (update.isNewer(latest.version, app.getVersion())) {
        release = latest;
        asset = update.findAsset(latest, kind);
        setState({ status: 'available', version: latest.version, manual: !asset });
      } else {
        release = null;
        asset = null;
        setState({ status: 'none', version: null, manual: false });
      }
    }
    return { ok: true, state };
  } catch {
    // Background checks stay quiet; manual checks show this in Settings.
    return { ok: false, error: "Couldn't check for updates. Check your internet connection and try again." };
  }
}

function check() {
  // Once a download has begun, the release it came from stays.
  if (!['none', 'available'].includes(state.status)) return Promise.resolve({ ok: true, state });
  // Startup, scheduled and manual checks can share the same request.
  if (!checking) checking = fetchLatest().finally(() => { checking = null; });
  return checking;
}

// Downloads `asset` to `file`, telling `onProgress` the share done so far,
// and checks it arrived whole.
async function fetchTo(file, onProgress) {
  // Opened first, so a folder that can't be written to shows before the
  // download starts.
  const handle = await fs.promises.open(file, 'w');
  try {
    const response = await net.fetch(asset.url, { headers: { 'User-Agent': `Compare/${app.getVersion()}` } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const piece of response.body) {
      hash.update(piece);
      size += piece.length;
      await handle.write(piece);
      onProgress(Math.min(1, size / asset.size));
    }
    if (size !== asset.size || (asset.sha256 && hash.digest('hex') !== asset.sha256)) {
      throw new Error("The download didn't arrive whole.");
    }
  } finally {
    await handle.close();
  }
}

async function download() {
  let file;
  if (kind === 'portable') {
    target = update.portableTarget(process.env.PORTABLE_EXECUTABLE_FILE, app.getVersion(), asset.name);
    file = target + update.PARTIAL;
  } else {
    fs.mkdirSync(downloadFolder(), { recursive: true });
    file = path.join(downloadFolder(), asset.name);
  }
  setState({ status: 'downloading', percent: 0 });
  try {
    await fetchTo(file, (share) => {
      const percent = Math.floor(share * 100);
      if (percent !== state.percent) setState({ percent });
    });
    downloaded = file;
    setState({ status: 'ready' });
    return { ok: true };
  } catch (error) {
    fs.rmSync(file, { force: true });
    setState({ status: 'available' });
    if (kind === 'portable' && ['EPERM', 'EACCES', 'EROFS'].includes(error.code)) {
      shell.openExternal(release.page);
      return {
        ok: false,
        error: "Compare can't save the new version in the folder it's in, so the download page has been opened instead.",
      };
    }
    return { ok: false, error: `The update couldn't be downloaded. ${error.message}` };
  }
}

// The installer runs quietly, on its own: --updated tells it the app is
// closing by itself, and --force-run to start it again afterwards. Done once
// it has started.
function runInstaller(restart) {
  return new Promise((resolve, reject) => {
    const args = ['--updated', '/S', ...(restart ? ['--force-run'] : [])];
    const child = spawn(downloaded, args, { detached: true, stdio: 'ignore', cwd: os.tmpdir() });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

// A portable exe is swapped by a PowerShell script that waits for the app to
// have closed; see swapLaunch in update.js. Done once it is on its way.
function runSwap(restart) {
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { args, env } = update.swapLaunch({
    powershell,
    download: downloaded,
    target,
    old: process.env.PORTABLE_EXECUTABLE_FILE,
    start: restart,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, args, {
      stdio: 'ignore',
      cwd: os.tmpdir(),
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`PowerShell stopped with code ${code}.`))));
  });
}

const applyUpdate = (restart) => (kind === 'installed' ? runInstaller(restart) : runSwap(restart));

async function restart() {
  setState({ status: 'restarting' });
  try {
    await applyUpdate(true);
  } catch (error) {
    setState({ status: 'ready' });
    return { ok: false, error: `The update couldn't be started. ${error.message}` };
  }
  app.quit();
  return { ok: true };
}

function startUpdater() {
  ipcMain.handle('update-state', () => state);
  ipcMain.handle('check-for-updates', check);

  ipcMain.handle('update', async () => {
    if (state.status === 'available' && state.manual) {
      await shell.openExternal(release.page);
      return { ok: true };
    }
    if (state.status === 'available') return download();
    if (state.status === 'ready') return restart();
    return { ok: true };
  });

  // Source builds can check manually and open the release page. Only
  // packaged copies download updates and check automatically.
  if (!app.isPackaged) return;
  kind = update.installKind({ env: process.env, execPath: process.execPath, exists: fs.existsSync });
  clearOldDownloads();

  // An update downloaded but not yet applied goes in now, without starting
  // the app again. Quitting waits the moment it takes to set off.
  app.on('will-quit', (event) => {
    if (state.status !== 'ready') return;
    event.preventDefault();
    state.status = 'restarting';
    applyUpdate(false)
      .catch(() => {})
      .finally(() => app.quit());
  });

  setTimeout(check, FIRST_CHECK);
  setInterval(check, CHECK_EVERY);
}

module.exports = { startUpdater };
