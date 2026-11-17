// Plain words for the errors Windows gives when a file can't be read or
// saved, in place of Node's own, which name the system call and the whole
// path: "EBUSY: resource busy or locked, open 'C:\…\report.docx'".

const UNREADABLE = {
  // Held open by a program that doesn't share it, as Word and Excel do.
  EBUSY: 'Another program has the file open and locked. Close it there and try again.',
  // What Windows' "access denied" becomes.
  EPERM: "Windows didn't allow the file to be read. You may not have permission to open it.",
  EACCES: "You don't have permission to open this file.",
  ENOENT: "The file isn't there anymore. It may have been moved, renamed or deleted.",
  ENOTDIR: "The file isn't there anymore. It may have been moved, renamed or deleted.",
  EISDIR: "Folders can't be compared, only files.",
  EMFILE: 'Too many files are open. Close some programs and try again.',
  ENFILE: 'Too many files are open. Close some programs and try again.',
  EIO: "The disk couldn't be read. If the file is on a network or removable drive, check that it's connected.",
  ENAMETOOLONG: "The file's path is too long. Move it to a folder with a shorter path and try again.",
};

const UNSAVABLE = {
  EBUSY: 'Another program has the file open. Close it there, or save under another name.',
  EPERM: "You can't save there, or the file is read-only. Save it somewhere else.",
  EACCES: "You don't have permission to save there. Save it somewhere else.",
  ENOENT: "The folder isn't there anymore. Save it somewhere else.",
  ENOTDIR: "The folder isn't there anymore. Save it somewhere else.",
  EISDIR: "There's a folder with that name. Pick another name.",
  ENOSPC: 'The disk is full. Free some space, or save it somewhere else.',
  EROFS: "The drive can't be written to. Save it somewhere else.",
  EMFILE: 'Too many files are open. Close some programs and try again.',
  ENFILE: 'Too many files are open. Close some programs and try again.',
  EIO: "The disk couldn't be written to. If it's a network or removable drive, check that it's connected.",
  ENAMETOOLONG: 'The path is too long. Pick a shorter name or another folder.',
};

// What to tell the user about `error`, met while reading a file or, with
// `action` 'save', saving one. Errors that aren't the system's, such as the
// app's own "This PDF is password-protected…", keep their message.
function fileErrorMessage(error, action = 'read') {
  const code = typeof error?.code === 'string' ? error.code : '';
  const known = action === 'save' ? UNSAVABLE : UNREADABLE;
  if (Object.hasOwn(known, code)) return known[code];
  // Some other system error: its code, without the path.
  if (error?.syscall || /^E[A-Z]+$/.test(code)) {
    const what = action === 'save' ? "The file couldn't be saved" : "The file couldn't be read";
    return code && code !== 'UNKNOWN' ? `${what} (${code}).` : `${what}.`;
  }
  return error?.message || String(error);
}

module.exports = { fileErrorMessage };
