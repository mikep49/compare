const crypto = require('node:crypto');
const fs = require('node:fs');
const { fileProperties } = require('./parse-file');

// `file` is { name, filePath, lastModified, bytes }. A file on disk is read
// from there a piece at a time, so its size doesn't matter; `bytes` are only
// needed for a file without a path. `onProgress` is told how many bytes have
// been read so far, and aborting `signal` gives up. Returns the SHA-256
// checksum in hex, the size in bytes and the file's details as groups of
// { label, value } items.
async function hashFile(file, { signal, onProgress } = {}) {
  if (file.filePath && (await fs.promises.stat(file.filePath)).isDirectory()) {
    throw new Error("Folders can't be compared, only files.");
  }
  const pieces = file.filePath
    ? fs.createReadStream(file.filePath, { signal, highWaterMark: 1024 * 1024 })
    : [file.bytes];
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const piece of pieces) {
    hash.update(piece);
    size += piece.length;
    onProgress?.(size);
  }
  return { sha256: hash.digest('hex'), size, details: [await fileProperties(file, size)] };
}

module.exports = { hashFile };
