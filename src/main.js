const { app, BrowserWindow, Menu, ipcMain, nativeTheme } = require('electron');
const os = require('node:os');
const path = require('node:path');
const { parseFile } = require('./parse-file');
const { hashFile } = require('./hash-file');

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

function createWindow() {
  const theme = nativeTheme.shouldUseDarkColors ? THEMES.dark : THEMES.light;
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
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
  win.once('ready-to-show', () => win.show());
  // Dropping a file outside a drop target must not replace the app page.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('parse-file', async (_event, file) => {
  try {
    return { ok: true, ...(await parseFile(file)) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Checksums being worked out, by the id the renderer gave them.
const hashJobs = new Map();

ipcMain.handle('hash-file', async (event, { id, ...file }) => {
  const job = new AbortController();
  hashJobs.set(id, job);
  let reported = 0;
  const onProgress = (read) => {
    // Often enough to count along, without flooding the renderer.
    if (Date.now() - reported < 100 || event.sender.isDestroyed()) return;
    reported = Date.now();
    event.sender.send('hash-progress', { id, read });
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

ipcMain.on('set-theme', (event, name) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !Object.hasOwn(THEMES, name)) return;
  const theme = THEMES[name];
  // Also switches the backdrop material between its light and dark variant.
  nativeTheme.themeSource = theme.source;
  win.setTitleBarOverlay({ color: '#00000000', symbolColor: theme.symbols });
  if (hasMaterial) win.setBackgroundMaterial(theme.material);
  else win.setBackgroundColor(theme.chrome);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
