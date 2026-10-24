// Spreadsheets as text and back: one row per line, cells separated by a
// delimiter. Sheets are [{ name, rows }] with rows of cell texts. Loaded as a
// plain script in the renderer and via require() in the main process and in
// tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TableText = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Picks the candidate that separates the most cells in the first lines.
  function detectDelimiter(text) {
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    let quoted = false;
    let lines = 0;
    for (let i = 0; i < text.length && lines < 20; i++) {
      const char = text[i];
      if (char === '"') quoted = !quoted;
      else if (quoted) continue;
      else if (char === '\n') lines++;
      else if (char in counts) counts[char]++;
    }
    return Object.keys(counts).reduce((best, char) => (counts[char] > counts[best] ? char : best));
  }

  // Splits delimited text into rows of cells. Quoted cells may contain the
  // delimiter, line breaks and doubled quotes.
  function split(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char !== '"') {
          cell += char;
        } else if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else if (char === '"' && cell === '') {
        quoted = true;
      } else if (char === delimiter) {
        row.push(cell);
        cell = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    if (cell !== '' || row.length > 0) rows.push([...row, cell]);
    return rows;
  }

  // Drops the empty cells at the end of each row and the empty rows at the
  // end of the sheet; gaps before them stay, so cells keep their position.
  function trim(rows) {
    const trimmed = rows.map((row) => {
      let end = row.length;
      while (end > 0 && row[end - 1] === '') end--;
      return row.slice(0, end);
    });
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0) trimmed.pop();
    return trimmed;
  }

  // Sheets as the text shown in the editor: cells separated by tabs, and each
  // sheet of a workbook under its [name].
  function toText(sheets) {
    const flat = (cell) => cell.replace(/\s*[\t\r\n]\s*/g, ' ');
    return sheets
      .map((sheet) => {
        const lines = sheet.rows.map((row) => row.map(flat).join('\t'));
        return (sheets.length > 1 ? [`[${sheet.name}]`, ...lines] : lines).join('\n');
      })
      .join('\n\n');
  }

  // Reads text that was typed, pasted or edited as sheets. Cells copied from
  // a spreadsheet are separated by tabs; other text is split on whichever
  // delimiter it uses. Text that starts with a [name] is a workbook as
  // written by toText().
  function toSheets(text) {
    const workbook = /^\[[^\]\r\n]+\]\r?(\n|$)/.test(text);
    const rows = split(text, workbook || text.includes('\t') ? '\t' : detectDelimiter(text));
    if (!workbook) return [{ name: '', rows: trim(rows) }];

    const isEmpty = (row) => row.every((cell) => cell === '');
    const sheets = [];
    rows.forEach((row, index) => {
      const heading = row.length === 1 && /^\[.+\]$/.test(row[0]) && (index === 0 || isEmpty(rows[index - 1]));
      if (!heading) {
        sheets[sheets.length - 1].rows.push(row);
        return;
      }
      // The empty line above a name only separates the sheets.
      if (sheets.length > 0) sheets[sheets.length - 1].rows.pop();
      sheets.push({ name: row[0].slice(1, -1), rows: [] });
    });
    return sheets.map((sheet) => ({ name: sheet.name, rows: trim(sheet.rows) }));
  }

  return { detectDelimiter, split, trim, toText, toSheets };
});
