const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  utilityProcess,
} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashFile } = require('./hash-file');
const { startUpdater } = require('./updater');

// Must match --topbar-height in styles.css.
const TITLE_BAR_HEIGHT = 48;

// The Mica backdrop needs Windows 11 22H2 (build 22621) or newer; everywhere
// else the window gets a solid background instead.
const hasMaterial = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;

// `chrome` must match the --chrome values in styles.css. `material` is the
// backdrop: light Mica is close to white and shows little of the wallpaper,
// so the light theme takes Mica Alt ('tabbed'), which is tinted more strongly.
const THEMES = {
  light: { source: 'light', chrome: '#f3f3f3', symbols: '#18181b', material: 'tabbed' },
  dark: { source: 'dark', chrome: '#202020', symbols: '#ededed', material: 'mica' },
  oled: { source: 'dark', chrome: '#000000', symbols: '#e8e8e8', material: 'mica' },
};

// The zoom steps Ctrl+Plus and Ctrl+Minus go through, as in Chrome.
const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

// Settings that outlive the window: its size and place, and the zoom.

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(values) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(values, null, 2));
  } catch {
    // Not being able to remember the window is no reason to stop.
  }
}

let settings = {};
let saveTimer;

// Notes the window's size, place and zoom, and saves them a moment later:
// after it stops being moved or resized, or right away when `now` is set.
function rememberWindow(now = false) {
  if (win && !win.isDestroyed()) {
    settings.bounds = win.getNormalBounds();
    settings.maximized = win.isMaximized();
  }
  clearTimeout(saveTimer);
  if (now) saveSettings(settings);
  else saveTimer = setTimeout(() => saveSettings(settings), 500);
}

// True when a good part of `bounds` is on one of the screens, which may have
// changed since the window was last closed.
function onScreen(bounds) {
  return screen.getAllDisplays().some(({ workArea: area }) => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return width >= 200 && height >= 100 && bounds.y >= area.y - 8;
  });
}

// Files to open: the ones the app was started with, and the ones another
// start passes on. Explorer's Send to, dropping files on the app's icon and
// `Compare.exe a.docx b.docx` all come in this way.

function pathsFrom(argv, cwd) {
  // Chromium may move its switches ahead of the other arguments, so they are
  // left out first. Run with `electron .`, the next one is the app itself.
  const args = argv.slice(1).filter((arg) => !arg.startsWith('-'));
  if (process.defaultApp) args.shift();
  return args
    .map((arg) => path.resolve(cwd, arg))
    .filter((filePath) => fs.existsSync(filePath))
    .slice(0, 2);
}

// Waiting for the page to ask for them.
let launchPaths = [];
let win = null;

function setZoom(factor) {
  settings.zoom = factor;
  win.webContents.setZoomFactor(factor);
  // The caption buttons grow with the top bar.
  win.setTitleBarOverlay({ height: Math.round(TITLE_BAR_HEIGHT * factor) });
  rememberWindow();
}

function zoom(direction) {
  const current = win.webContents.getZoomFactor();
  const nearest = ZOOM_STEPS.reduce(
    (best, step, i) => (Math.abs(step - current) < Math.abs(ZOOM_STEPS[best] - current) ? i : best),
    0
  );
  let index = ZOOM_STEPS.indexOf(1);
  if (direction === 'in') index = Math.min(ZOOM_STEPS.length - 1, nearest + 1);
  if (direction === 'out') index = Math.max(0, nearest - 1);
  setZoom(ZOOM_STEPS[index]);
  win.webContents.send('zoom-changed', ZOOM_STEPS[index]);
}

function createWindow() {
  const theme = nativeTheme.shouldUseDarkColors ? THEMES.dark : THEMES.light;
  const bounds = settings.bounds && onScreen(settings.bounds) ? settings.bounds : { width: 1400, height: 900 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 520,
    title: 'Compare',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: theme.symbols, height: TITLE_BAR_HEIGHT },
    // With a material set and no backgroundColor, Electron makes the page
    // background transparent so the material shows through.
    ...(hasMaterial ? { backgroundMaterial: theme.material } : { backgroundColor: theme.chrome }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: hasMaterial ? ['--compare-material'] : [],
    },
  });
  if (settings.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    if (settings.zoom && settings.zoom !== 1) setZoom(settings.zoom);
  });
  for (const change of ['resize', 'move', 'maximize', 'unmaximize']) win.on(change, () => rememberWindow());
  win.on('close', () => rememberWindow(true));
  win.on('closed', () => {
    win = null;
    // A save still waiting goes out now.
    rememberWindow(true);
  });

  // Zooming with Ctrl and the mouse wheel is up to the page, as over
  // documents shown as they look it zooms them instead: like the keyboard
  // shortcuts it comes as 'zoom' messages. The 'zoom-changed' event can't
  // tell where the wheel was, and comes before the page has seen it.

  // Dropping a file outside a drop target must not replace the app page.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Files are read in a utility process, started when the first one is opened
// and again should it ever stop (say, out of memory on a huge file).

let reader = null;
const readerJobs = new Map();
let lastReaderJob = 0;

function startReader() {
  const child = utilityProcess.fork(path.join(__dirname, 'parse-worker.js'), [], { serviceName: 'Compare file reader' });
  child.on('message', ({ id, result }) => {
    readerJobs.get(id)?.(result);
    readerJobs.delete(id);
  });
  child.once('exit', () => {
    if (reader === child) reader = null;
    for (const resolve of readerJobs.values()) {
      resolve({ ok: false, error: "The file couldn't be read. It may be too large." });
    }
    readerJobs.clear();
  });
  return child;
}

function readInBackground(file) {
  reader ??= startReader();
  const id = ++lastReaderJob;
  return new Promise((resolve) => {
    readerJobs.set(id, resolve);
    reader.postMessage({ id, file });
  });
}

ipcMain.handle('parse-file', (_event, file) => readInBackground(file));

// Checksums being worked out, by the id the renderer gave them.
const hashJobs = new Map();

ipcMain.handle('hash-file', async (event, { id, ...file }) => {
  const job = new AbortController();
  hashJobs.set(id, job);
  let reported = 0;
  const onProgress = (read, total) => {
    // Often enough to count along, without flooding the renderer.
    if (Date.now() - reported < 100 || event.sender.isDestroyed()) return;
    reported = Date.now();
    event.sender.send('hash-progress', { id, read, total });
  };
  try {
    return { ok: true, ...(await hashFile(file, { signal: job.signal, onProgress })) };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    hashJobs.delete(id);
  }
});

ipcMain.on('cancel-hash', (_event, id) => hashJobs.get(id)?.abort());

ipcMain.handle('take-launch-paths', () => launchPaths.splice(0));

// Saves an export where the user picks. `name` is the suggested file name,
// `filters` the file types offered. Returns { ok, filePath } or, when the
// user thought better of it, { ok: false }.
ipcMain.handle('save-file', async (event, { name, filters, content }) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const safeName = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 180);
  const folder = settings.exportFolder && fs.existsSync(settings.exportFolder) ? settings.exportFolder : app.getPath('documents');
  const { canceled, filePath } = await dialog.showSaveDialog(owner, { defaultPath: path.join(folder, safeName), filters });
  if (canceled || !filePath) return { ok: false };
  try {
    await fs.promises.writeFile(filePath, content);
    settings.exportFolder = path.dirname(filePath);
    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.on('copy-text', (_event, text) => clipboard.writeText(String(text)));

// 'in', 'out' or 'reset'.
ipcMain.on('zoom', (_event, direction) => {
  if (win && ['in', 'out', 'reset'].includes(direction)) zoom(direction);
});

ipcMain.on('set-theme', (event, name) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || !Object.hasOwn(THEMES, name)) return;
  const theme = THEMES[name];
  // Also switches the backdrop material between its light and dark variant.
  nativeTheme.themeSource = theme.source;
  owner.setTitleBarOverlay({ color: '#00000000', symbolColor: theme.symbols });
  if (hasMaterial) owner.setBackgroundMaterial(theme.material);
  else owner.setBackgroundColor(theme.chrome);
});

// One window does: starting the app again hands its files to the one that's
// already open.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  launchPaths = pathsFrom(process.argv, process.cwd());

  app.on('second-instance', (_event, argv, cwd) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const paths = pathsFrom(argv, cwd);
    if (paths.length > 0) win.webContents.send('open-paths', paths);
  });

  app.whenReady().then(() => {
    settings = loadSettings();
    Menu.setApplicationMenu(null);
    createWindow();
    startUpdater();
  });

  app.on('window-all-closed', () => app.quit());
}
