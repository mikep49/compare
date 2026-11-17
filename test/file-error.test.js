const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileErrorMessage } = require('../src/file-error');
const { parseFile } = require('../src/parse-file');
const { hashFile } = require('../src/hash-file');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-error-'));
test.after(() => fs.rmSync(dir, { recursive: true }));

// An error as Node gives it when a file can't be opened or read.
function systemError(code, syscall = 'open') {
  const filePath = path.join(dir, 'Quarterly report.docx');
  return Object.assign(new Error(`${code}: something went wrong, ${syscall} '${filePath}'`), { code, syscall, path: filePath });
}

test('a locked file is explained without the system call or the path', () => {
  const message = fileErrorMessage(systemError('EBUSY'));
  assert.match(message, /Another program has the file open/);
  assert.doesNotMatch(message, /EBUSY|open '|Quarterly report/);
});

test('the common reasons for not reading a file each get plain words', () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EMFILE', 'ENFILE', 'EIO', 'ENAMETOOLONG']) {
    const message = fileErrorMessage(systemError(code));
    assert.doesNotMatch(message, new RegExp(`${code}|Quarterly report|\\\\`), code);
    assert.match(message, /^[A-Z].*\.$/, code);
  }
  assert.equal(fileErrorMessage(systemError('EISDIR', 'read')), "Folders can't be compared, only files.");
  assert.match(fileErrorMessage(systemError('EACCES')), /permission/);
});

test('saving gets its own words', () => {
  assert.match(fileErrorMessage(systemError('EBUSY'), 'save'), /save under another name/);
  assert.match(fileErrorMessage(systemError('ENOSPC'), 'save'), /disk is full/);
  assert.match(fileErrorMessage(systemError('EPERM'), 'save'), /read-only/);
  assert.notEqual(fileErrorMessage(systemError('ENOENT'), 'save'), fileErrorMessage(systemError('ENOENT')));
});

test('other system errors keep only their code', () => {
  assert.equal(fileErrorMessage(systemError('ECANCELED', 'read')), "The file couldn't be read (ECANCELED).");
  assert.equal(fileErrorMessage(systemError('EXDEV', 'rename'), 'save'), "The file couldn't be saved (EXDEV).");
  assert.equal(fileErrorMessage(systemError('UNKNOWN')), "The file couldn't be read.");
});

test("the app's own messages are kept as they are", () => {
  for (const message of [
    'This PDF is password-protected. Remove the password, save it and try again.',
    "Folders can't be compared, only files.",
    ".doc files aren't supported. Save the document as .docx, .pdf or plain text first.",
  ]) {
    assert.equal(fileErrorMessage(new Error(message)), message);
  }
  // Not a system error, though it has a code: it says what's wrong itself.
  const unsupported = Object.assign(new Error(".rtf files aren't supported."), { code: 'UNSUPPORTED' });
  assert.equal(fileErrorMessage(unsupported), ".rtf files aren't supported.");
  const aborted = Object.assign(new Error('The operation was aborted'), { code: 'ABORT_ERR' });
  assert.equal(fileErrorMessage(aborted), 'The operation was aborted');
});

test('real errors from reading and hashing a file that is gone', async () => {
  const gone = { name: 'gone.txt', filePath: path.join(dir, 'gone.txt'), lastModified: 0, bytes: null };
  const parseError = await parseFile(gone).catch((error) => error);
  assert.equal(parseError.code, 'ENOENT');
  assert.match(fileErrorMessage(parseError), /isn't there anymore/);
  const hashError = await hashFile(gone).catch((error) => error);
  assert.equal(hashError.code, 'ENOENT');
  assert.match(fileErrorMessage(hashError), /isn't there anymore/);
});
