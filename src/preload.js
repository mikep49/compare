const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('compareApi', {
  // `table` has plain text read as a spreadsheet.
  parseFile: async (file, { table = false } = {}) =>
    ipcRenderer.invoke('parse-file', {
      name: file.name,
      // Empty for files that don't exist on disk.
      filePath: webUtils.getPathForFile(file),
      lastModified: file.lastModified,
      bytes: new Uint8Array(await file.arrayBuffer()),
      table,
    }),
  // Works out a file's SHA-256 checksum. `id` names the job for cancelHash;
  // `onProgress` is called with the number of bytes read so far.
  hashFile: async (id, file, onProgress) => {
    const filePath = webUtils.getPathForFile(file);
    const listener = (_event, progress) => {
      if (progress.id === id) onProgress(progress.read);
    };
    ipcRenderer.on('hash-progress', listener);
    try {
      return await ipcRenderer.invoke('hash-file', {
        id,
        name: file.name,
        filePath,
        lastModified: file.lastModified,
        // A file on disk is read there, however large it is.
        bytes: filePath ? null : new Uint8Array(await file.arrayBuffer()),
      });
    } finally {
      ipcRenderer.removeListener('hash-progress', listener);
    }
  },
  cancelHash: (id) => ipcRenderer.send('cancel-hash', id),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  // True when the window sits on the Windows backdrop material.
  hasMaterial: process.argv.includes('--compare-material'),
});
