const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashFile } = require('../src/hash-file');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-hash-'));
test.after(() => fs.rmSync(dir, { recursive: true }));

function onDisk(name, bytes) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, bytes);
  return { name, filePath, lastModified: Date.UTC(2024, 0, 2), bytes: null };
}

const items = (details, title) =>
  Object.fromEntries(details.find((group) => group.title === title).items.map((item) => [item.label, item.value]));

test('a file on disk gets its SHA-256 checksum, size and details', async () => {
  const { sha256, size, details } = await hashFile(onDisk('abc.txt', 'abc'));
  assert.equal(sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(size, 3);
  assert.deepEqual(
    details.map((group) => group.title),
    ['File']
  );
  assert.equal(items(details, 'File').Name, 'abc.txt');
  assert.equal(items(details, 'File').Location, dir);
  assert.equal(items(details, 'File').Size, '3 bytes');
});

test('an empty file has the checksum of nothing', async () => {
  const { sha256, size } = await hashFile(onDisk('empty.bin', ''));
  assert.equal(sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(size, 0);
});

test('a large file is read in pieces, reporting how far it is', async () => {
  const bytes = crypto.randomBytes(5 * 1024 * 1024 + 123);
  const progress = [];
  const { sha256, size } = await hashFile(onDisk('large.bin', bytes), { onProgress: (read) => progress.push(read) });
  assert.equal(sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(size, bytes.length);
  assert.ok(progress.length > 1);
  assert.deepEqual(
    progress,
    progress.toSorted((a, b) => a - b)
  );
  assert.equal(progress.at(-1), bytes.length);
});

test('copies have the same checksum, a single changed byte a different one', async () => {
  const bytes = crypto.randomBytes(4096);
  const changed = Buffer.from(bytes);
  changed[2048] ^= 1;
  const [original, copy, other] = await Promise.all(
    [onDisk('a.jpg', bytes), onDisk('renamed copy.png', bytes), onDisk('b.jpg', changed)].map((file) => hashFile(file))
  );
  assert.equal(copy.sha256, original.sha256);
  assert.notEqual(other.sha256, original.sha256);
  assert.equal(other.size, original.size);
});

test('a file that is not on disk is hashed from its bytes', async () => {
  const file = { name: 'pasted.bin', filePath: '', lastModified: Date.UTC(2024, 0, 2), bytes: new Uint8Array([97, 98, 99]) };
  const { sha256, size, details } = await hashFile(file);
  assert.equal(sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(size, 3);
  assert.deepEqual(items(details, 'File'), {
    Name: 'pasted.bin',
    Size: '3 bytes',
    Modified: new Date(Date.UTC(2024, 0, 2)),
  });
});

test('a folder is turned down', async () => {
  await assert.rejects(hashFile({ name: 'folder', filePath: dir, bytes: null }), /Folders can't be compared/);
});

test('a missing file is an error', async () => {
  await assert.rejects(hashFile({ name: 'gone', filePath: path.join(dir, 'gone'), bytes: null }), /ENOENT/);
});

test('aborting gives up on a file', async () => {
  const job = new AbortController();
  const file = onDisk('aborted.bin', crypto.randomBytes(4 * 1024 * 1024));
  const pending = hashFile(file, { signal: job.signal, onProgress: () => job.abort() });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('every common checksum is worked out, and progress knows the total', async () => {
  const progress = [];
  const { checksums } = await hashFile(onDisk('abc2.txt', 'abc'), { onProgress: (read, total) => progress.push([read, total]) });
  assert.deepEqual(checksums, {
    md5: '900150983cd24fb0d6963f7d28e17f72',
    sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    sha512:
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  });
  assert.deepEqual(progress, [[3, 3]]);
});
