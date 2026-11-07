// Reads files in a utility process of its own, so that a large workbook or
// PDF doesn't hold up the window while it is being read, and colors code
// for the same reason. Gets { id, file } messages to read a file and
// { id, code } ones to color code, and answers each with { id, result }, as
// the parse-file and highlight-code handlers in main.js return it.
const { parseFile } = require('./parse-file');
const { highlightCode } = require('./highlight-code');

process.parentPort.on('message', async ({ data: { id, file, code } }) => {
  let result;
  try {
    result = { ok: true, ...(code ? highlightCode(code) : await parseFile(file)) };
  } catch (error) {
    result = { ok: false, error: error.message, code: error.code };
  }
  process.parentPort.postMessage({ id, result });
});
