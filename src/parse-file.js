const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const TableText = require('./table-text');

const WORKBOOKS = new Set(['.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.fods']);
// Extensions of delimited text, with their delimiter when it is a given.
const DELIMITED = new Map([
  ['.csv', undefined],
  ['.tsv', '\t'],
  ['.tab', '\t'],
]);
const DELIMITER_NAMES = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' };
const UNSUPPORTED = new Set(['.doc', '.rtf', '.odt', '.pages', '.ppt', '.pptx']);

// For files that can't be read as text at all, as opposed to ones that are
// damaged or locked: their errors have this code.
function unsupported(message) {
  return Object.assign(new Error(message), { code: 'UNSUPPORTED' });
}

// Builds a details group from [label, value] pairs, dropping the ones a file
// doesn't have. Values are strings, numbers or Dates.
function group(title, pairs) {
  const items = pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .filter(([, value]) => !(value instanceof Date && Number.isNaN(value.getTime())))
    .map(([label, value]) => ({ label, value }));
  return { title, items };
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntity(entity, code) {
  if (code[0] !== '#') return XML_ENTITIES[code] ?? entity;
  const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
}

// Reads the text of a simple element from a docProps part, whatever its
// namespace prefix.
function xmlValue(xml, tag) {
  const match = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([^<]*)</`).exec(xml);
  return match ? match[1].replace(/&(#x?[\da-f]+|\w+);/gi, decodeEntity).trim() : undefined;
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

async function docxProperties(buffer) {
  const zip = await require('jszip').loadAsync(buffer);
  const part = async (name) => (await zip.file(name)?.async('string')) ?? '';
  const core = await part('docProps/core.xml');
  const app = await part('docProps/app.xml');
  const date = (tag) => {
    const value = xmlValue(core, tag);
    return value ? new Date(value) : undefined;
  };
  const number = (tag) => {
    const value = Number(xmlValue(app, tag));
    return value > 0 ? value : undefined;
  };
  const editingMinutes = number('TotalTime');
  return group('Document', [
    ['Title', xmlValue(core, 'title')],
    ['Subject', xmlValue(core, 'subject')],
    ['Author', xmlValue(core, 'creator')],
    ['Last saved by', xmlValue(core, 'lastModifiedBy')],
    ['Content created', date('created')],
    ['Last saved', date('modified')],
    ['Revision', xmlValue(core, 'revision')],
    ['Editing time', editingMinutes && formatMinutes(editingMinutes)],
    ['Pages', number('Pages')],
    ['Keywords', xmlValue(core, 'keywords')],
    ['Comments', xmlValue(core, 'description')],
    ['Category', xmlValue(core, 'category')],
    ['Company', xmlValue(app, 'Company')],
    ['Application', xmlValue(app, 'Application')],
  ]);
}

// Office files are zip archives; once a password is set, Office saves them
// inside an older compound file instead, which starts with these bytes.
const COMPOUND_FILE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const isCompoundFile = (buffer) => buffer.subarray(0, 8).equals(COMPOUND_FILE);

function passwordError(app) {
  return new Error(`This file is password-protected. Open it in ${app}, remove the password, save it and try again.`);
}

async function parseDocx(buffer) {
  if (isCompoundFile(buffer)) throw passwordError('Word');
  let value;
  try {
    ({ value } = await require('mammoth').extractRawText({ buffer }));
  } catch (error) {
    if (/central directory|zip/i.test(error.message)) {
      throw new Error("This file is damaged or isn't a Word document.");
    }
    throw error;
  }
  // mammoth separates paragraphs with a blank line; one paragraph per line
  // gives a much more readable comparison.
  const text = value.replace(/\n{2,}/g, '\n').trim();
  return { text, properties: await docxProperties(buffer), source: { kind: 'docx', bytes: buffer } };
}

async function parsePdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // In Electron's utility process pdf.js takes itself to be in a web page.
  // It then has to be told where its worker is, which it runs in-process,
  // and to do without the browser features it would use to draw pages.
  pdfjs.GlobalWorkerOptions.workerSrc ||= pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      if (error.name === 'PasswordException') {
        throw new Error('This PDF is password-protected. Remove the password, save it and try again.');
      }
      if (error.name === 'InvalidPDFException') throw new Error("This file is damaged or isn't a PDF.");
      throw error;
    }
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join('');
      pages.push(text.trim());
    }
    const { info } = await doc.getMetadata();
    const date = (value) => pdfjs.PDFDateString.toDateObject(value) ?? undefined;
    const properties = group('Document', [
      ['Title', info.Title],
      ['Subject', info.Subject],
      ['Author', info.Author],
      ['Content created', date(info.CreationDate)],
      ['Last saved', date(info.ModDate)],
      ['Pages', doc.numPages],
      ['Keywords', info.Keywords],
      ['Application', info.Creator],
      ['PDF producer', info.Producer],
      ['PDF version', info.PDFFormatVersion],
    ]);
    // Scanned pages are pictures of text, with no text to compare.
    const warning =
      doc.numPages > 0 && pages.every((text) => text === '')
        ? "This PDF has no text to compare. It's probably made of scanned pages."
        : undefined;
    return { text: pages.join('\n\n'), properties, warning, source: { kind: 'pdf', bytes: buffer } };
  } finally {
    await task.destroy();
  }
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer), encoding: 'UTF-16 LE' };
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer), encoding: 'UTF-16 BE' };
  }
  if (buffer.subarray(0, 8192).includes(0)) {
    throw unsupported(
      "This doesn't look like a text file. Supported: plain text, .docx, .pdf and spreadsheets (.xlsx, .xls, .ods, .csv)."
    );
  }
  try {
    const hasBom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text, encoding: hasBom ? 'UTF-8 with BOM' : 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'Windows-1252' };
  }
}

function lineEndings(text) {
  const kinds = [
    /\r\n/.test(text) && 'Windows (CRLF)',
    /(?<!\r)\n/.test(text) && 'Unix (LF)',
    /\r(?!\n)/.test(text) && 'Classic Mac (CR)',
  ].filter(Boolean);
  return kinds.length > 1 ? 'Mixed' : kinds[0];
}

function parseText(buffer) {
  const { text, encoding } = decodeText(buffer);
  return {
    text,
    properties: group('Format', [
      ['Encoding', encoding],
      ['Line endings', lineEndings(text)],
    ]),
  };
}

// Dates written in digits only are shown as year-month-day whatever format
// the cell has: that format depends on the program and the regional settings
// a file was saved with, and the default one is ambiguous outside the US.
// Returns the format to use instead, or null to leave a format as it is.
function isoDateFormat(format) {
  // Only the first section applies to dates; quoted text, escaped characters
  // and [conditions] aren't part of the pattern.
  const [section] = String(format).split(';');
  const pattern = section.replace(/"[^"]*"|\\.|\[[^\]]*\]|[_*]./g, '').trim().toLowerCase();
  const match = /^([dmy/.\- ,]+?)(?:\s+h{1,2}:mm(:ss)?(?:\.0+)?(?:\s*am\/pm)?)?$/.exec(pattern);
  if (!match) return null;
  const [whole, date, seconds] = match;
  // Three letters or more spell out a weekday or month name.
  if (!/d/.test(date) || !/m/.test(date) || !/y/.test(date) || /d{3}|m{3}/.test(date)) return null;
  if (whole === date) return 'yyyy-mm-dd';
  return seconds ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd hh:mm';
}

// Cells hold the text a spreadsheet application would show: numbers
// formatted, formulas as their result.
function parseWorkbook(buffer, ext) {
  const XLSX = require('xlsx');
  // Only the old .xls format is a compound file without a password.
  if (ext !== '.xls' && isCompoundFile(buffer)) throw passwordError('Excel');
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', dense: true, cellNF: true, cellFormula: false, cellHTML: false });
  } catch (error) {
    if (/password|encrypt/i.test(error.message)) throw passwordError('Excel');
    throw error;
  }
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const isoFormats = new Map();
  const cellText = (cell) => {
    if (cell?.t === 'n' && cell.z) {
      if (!isoFormats.has(cell.z)) isoFormats.set(cell.z, isoDateFormat(cell.z));
      const format = isoFormats.get(cell.z);
      if (format) return XLSX.SSF.format(format, cell.v, { date1904 }) || XLSX.utils.format_cell(cell);
    }
    return XLSX.utils.format_cell(cell);
  };
  const sheets = workbook.SheetNames.map((name) => {
    const data = workbook.Sheets[name]['!data'] || [];
    const rows = Array.from(data, (row) => Array.from(row || [], cellText));
    return { name, rows: TableText.trim(rows) };
  });
  const props = workbook.Props || {};
  const date = (value) => (value ? new Date(value) : undefined);
  const properties = group('Document', [
    ['Title', props.Title],
    ['Subject', props.Subject],
    ['Author', props.Author],
    ['Last saved by', props.LastAuthor],
    ['Content created', date(props.CreatedDate)],
    ['Last saved', date(props.ModifiedDate)],
    ['Keywords', props.Keywords],
    ['Comments', props.Comments],
    ['Category', props.Category],
    ['Company', props.Company],
    ['Application', props.Application],
  ]);
  return { text: TableText.toText(sheets), sheets, properties };
}

function parseDelimited(buffer, knownDelimiter) {
  const { text: decoded, encoding } = decodeText(buffer);
  // Excel writes and honours a first line that names the delimiter.
  const [declaration, declared] = /^sep=(.)\r?\n/.exec(decoded) || [];
  const content = declaration ? decoded.slice(declaration.length) : decoded;
  const delimiter = declared ?? knownDelimiter ?? TableText.detectDelimiter(content);
  const sheets = [{ name: '', rows: TableText.trim(TableText.split(content, delimiter)) }];
  const properties = group('Format', [
    ['Encoding', encoding],
    ['Line endings', lineEndings(decoded)],
    ['Delimiter', DELIMITER_NAMES[delimiter] ?? delimiter],
  ]);
  return { text: TableText.toText(sheets), sheets, properties };
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]} (${bytes.toLocaleString()} bytes)`;
}

async function fileProperties({ name, filePath, lastModified }, size) {
  // Files that aren't on disk have no path; the browser still knows when
  // they were last modified.
  const stat = filePath ? await fs.stat(filePath).catch(() => null) : null;
  return group('File', [
    ['Name', name],
    ['Location', filePath ? path.dirname(filePath) : undefined],
    ['Size', formatSize(size)],
    ['Created', stat && stat.birthtimeMs > 0 ? stat.birthtime : undefined],
    ['Modified', stat ? stat.mtime : new Date(lastModified)],
  ]);
}

function contentProperties(text) {
  const lines = text === '' ? 0 : text.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(text) ? 1 : 0);
  return group('Content', [
    ['Lines', lines],
    ['Words', (text.match(/\S+/g) || []).length],
    ['Characters', text.length],
  ]);
}

function sheetProperties(sheets) {
  const count = (n, unit) => `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`;
  const size = (sheet) => {
    const columns = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
    return columns === 0 ? 'Empty' : `${count(sheet.rows.length, 'row')} × ${count(columns, 'column')}`;
  };
  // Delimited text is a single sheet without a name.
  if (sheets.length === 1 && sheets[0].name === '') return group('Content', [['Size', size(sheets[0])]]);
  return group(
    'Sheets',
    sheets.map((sheet) => [sheet.name, size(sheet)])
  );
}

// `asTable` reads a file of no particular type as delimited text instead of
// plain text.
function parseContent(name, buffer, asTable) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.docx') return parseDocx(buffer);
  if (ext === '.pdf') return parsePdf(buffer);
  if (WORKBOOKS.has(ext)) return parseWorkbook(buffer, ext);
  if (DELIMITED.has(ext)) return parseDelimited(buffer, DELIMITED.get(ext));
  if (UNSUPPORTED.has(ext)) {
    throw unsupported(`${ext} files aren't supported. Save the document as .docx, .pdf or plain text first.`);
  }
  return asTable ? parseDelimited(buffer) : parseText(buffer);
}

// Reads a whole file from disk, turning down folders.
async function readFromDisk(filePath) {
  if ((await fs.stat(filePath)).isDirectory()) throw new Error("Folders can't be compared, only files.");
  return fs.readFile(filePath);
}

// `file` is { name, filePath, lastModified, bytes, table }; without `bytes`
// the file is read from `filePath`. Returns the file's text and its details
// as groups of { label, value } items; spreadsheets also return their
// `sheets` as [{ name, rows }] with rows of cell texts. With `table` set,
// plain text counts as a spreadsheet too. `warning` says when a file opened
// but likely isn't what was expected. Word files and PDFs come with their
// `source`, { kind, bytes }, for the document view to show them as they
// look.
async function parseFile(file) {
  const buffer = file.bytes ? Buffer.from(file.bytes) : await readFromDisk(file.filePath);
  const { text, properties, sheets, warning, source } = await parseContent(file.name, buffer, file.table);
  const content = sheets ? sheetProperties(sheets) : contentProperties(text);
  const details = [await fileProperties(file, buffer.length), properties, content];
  return { text, sheets, warning, source, details: details.filter((entry) => entry.items.length > 0) };
}

module.exports = { parseFile, fileProperties, isoDateFormat };
