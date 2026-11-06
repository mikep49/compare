const crypto = require('node:crypto');
const fs = require('node:fs');
const { fileProperties } = require('./parse-file');

// The checksums worked out for every file, by the names they are shown with.
// Websites publish all of these to check a download against.
const ALGORITHMS = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' };

// `file` is { name, filePath, lastModified, bytes }. A file on disk is read
// from there a piece at a time, so its size doesn't matter; `bytes` are only
// needed for a file without a path. `onProgress` is told how many bytes have
// been read so far and how many there are, and aborting `signal` gives up.
// Returns the checksums in hex by algorithm ({ md5, sha1, sha256, sha512 }),
// the SHA-256 one again as `sha256`, the size in bytes and the file's details
// as groups of { label, value } items.
async function hashFile(file, { signal, onProgress } = {}) {
  const stat = file.filePath ? await fs.promises.stat(file.filePath) : null;
  if (stat?.isDirectory()) throw new Error("Folders can't be compared, only files.");
  const total = stat ? stat.size : file.bytes.length;
  const pieces = file.filePath
    ? fs.createReadStream(file.filePath, { signal, highWaterMark: 1024 * 1024 })
    : [file.bytes];
  const hashes = Object.keys(ALGORITHMS).map((algorithm) => [algorithm, crypto.createHash(algorithm)]);
  let size = 0;
  for await (const piece of pieces) {
    for (const [, hash] of hashes) hash.update(piece);
    size += piece.length;
    onProgress?.(size, total);
  }
  const checksums = Object.fromEntries(hashes.map(([algorithm, hash]) => [algorithm, hash.digest('hex')]));
  return { sha256: checksums.sha256, checksums, size, details: [await fileProperties(file, size)] };
}

module.exports = { hashFile, ALGORITHMS };
