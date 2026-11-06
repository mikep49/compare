// Reads files in a utility process of its own, so that a large workbook or
// PDF doesn't hold up the window while it is being read. Gets { id, file }
// messages and answers each with { id, result }, as the parse-file handler
// in main.js returns it.
const { parseFile } = require('./parse-file');

process.parentPort.on('message', async ({ data: { id, file } }) => {
  let result;
  try {
    result = { ok: true, ...(await parseFile(file)) };
  } catch (error) {
    result = { ok: false, error: error.message, code: error.code };
  }
  process.parentPort.postMessage({ id, result });
});
