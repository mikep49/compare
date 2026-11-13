const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Files come either from the page, as File objects, or from Explorer as
// plain { path, name } objects. Those on disk are read there by the main process, however
// large they are; `bytes` are only sent for files that aren't on disk.
async function describe(file) {
  // File objects have had no `path` since Electron 32.
  if (typeof file.path === 'string') return { name: file.name, filePath: file.path, lastModified: 0, bytes: null };
  // Empty for files that don't exist on disk.
  const filePath = webUtils.getPathForFile(file);
  return {
    name: file.name,
    filePath,
    lastModified: file.lastModified,
    bytes: filePath ? null : new Uint8Array(await file.arrayBuffer()),
  };
}

contextBridge.exposeInMainWorld('compareApi', {
  // `table` has plain text read as a spreadsheet, `code` any file but
  // documents and workbooks read as plain text.
  parseFile: async (file, { table = false, code = false } = {}) =>
    ipcRenderer.invoke('parse-file', { ...(await describe(file)), table, code }),
  // Colors code; see highlight-code.js. `fileName` tells its language, and
  // `language` sets it. Returns { ok, language, name, html }.
  highlightCode: (text, { fileName = '', language = null } = {}) =>
    ipcRenderer.invoke('highlight-code', { text, fileName, language }),
  // Works out a file's checksums. `id` names the job for cancelHash;
  // `onProgress` is called with the number of bytes read so far and the
  // total.
  hashFile: async (id, file, onProgress) => {
    const listener = (_event, progress) => {
      if (progress.id === id) onProgress(progress.read, progress.total);
    };
    ipcRenderer.on('hash-progress', listener);
    try {
      return await ipcRenderer.invoke('hash-file', { id, ...(await describe(file)) });
    } finally {
      ipcRenderer.removeListener('hash-progress', listener);
    }
  },
  cancelHash: (id) => ipcRenderer.send('cancel-hash', id),
  // The files the app was started with, once.
  takeLaunchPaths: () => ipcRenderer.invoke('take-launch-paths'),
  // Calls back with the paths of files passed on by a later start of the app.
  onOpenPaths: (callback) => ipcRenderer.on('open-paths', (_event, paths) => callback(paths)),
  // `direction` is 'in', 'out' or 'reset'.
  zoom: (direction) => ipcRenderer.send('zoom', direction),
  // Calls back with the zoom factor after it changed.
  onZoom: (callback) => ipcRenderer.on('zoom-changed', (_event, factor) => callback(factor)),
  // Asks where to save `content` and saves it there; see main.js.
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  copyText: (text) => ipcRenderer.send('copy-text', text),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  getVersion: () => ipcRenderer.invoke('app-version'),
  // The update on offer, as { status, version, percent, manual }; see
  // updater.js. onUpdateState calls back whenever it changes.
  getUpdateState: () => ipcRenderer.invoke('update-state'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateState: (callback) => ipcRenderer.on('update-state', (_event, state) => callback(state)),
  // Downloads the update, or restarts on it once downloaded. Returns
  // { ok, error }.
  update: () => ipcRenderer.invoke('update'),
  // True when the window sits on the Windows backdrop material.
  hasMaterial: process.argv.includes('--compare-material'),
});
