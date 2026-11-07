const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const { parseFile, isoDateFormat } = require('../src/parse-file');

const file = (name, bytes) => ({ name, filePath: '', lastModified: Date.UTC(2024, 0, 2), bytes });
const items = (details, title) =>
  Object.fromEntries(details.find((group) => group.title === title).items.map((item) => [item.label, item.value]));

test('text file details cover the file, its format and its content', async () => {
  const bytes = Buffer.from('﻿Hello world\r\nsecond line\r\n', 'utf8');
  const { text, details } = await parseFile(file('notes.txt', bytes));
  assert.equal(text, 'Hello world\r\nsecond line\r\n');
  assert.deepEqual(
    details.map((group) => group.title),
    ['File', 'Format', 'Content']
  );
  assert.deepEqual(items(details, 'File'), {
    Name: 'notes.txt',
    Size: '29 bytes',
    Modified: new Date(Date.UTC(2024, 0, 2)),
  });
  assert.deepEqual(items(details, 'Format'), { Encoding: 'UTF-8 with BOM', 'Line endings': 'Windows (CRLF)' });
  assert.deepEqual(items(details, 'Content'), { Lines: 2, Words: 4, Characters: 26 });
});

test('a file on disk reports its location', async () => {
  const { details } = await parseFile({ ...file('x.txt', Buffer.from('x')), filePath: __filename });
  assert.equal(items(details, 'File').Location, __dirname);
  assert.ok(items(details, 'File').Modified instanceof Date);
});

test('docx details include the document properties', async () => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>'
  );
  zip.file(
    'docProps/core.xml',
    '<cp:coreProperties xmlns:cp="c" xmlns:dc="d" xmlns:dcterms="t" xmlns:xsi="x"><dc:title>Terms &amp; Conditions</dc:title><dc:creator>Ada</dc:creator><cp:lastModifiedBy>Grace</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2024-03-01T09:00:00Z</dcterms:created><dc:subject></dc:subject></cp:coreProperties>'
  );
  zip.file(
    'docProps/app.xml',
    '<Properties><TotalTime>85</TotalTime><Pages>3</Pages><Application>Microsoft Office Word</Application><TitlesOfParts>x</TitlesOfParts></Properties>'
  );
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });

  const { text, details, source } = await parseFile(file('terms.docx', bytes));
  assert.equal(text, 'First paragraph\nSecond');
  // The file itself comes along, for the document view to show it.
  assert.equal(source.kind, 'docx');
  assert.ok(Buffer.from(source.bytes).equals(bytes));
  assert.deepEqual(items(details, 'Document'), {
    Title: 'Terms & Conditions',
    Author: 'Ada',
    'Last saved by': 'Grace',
    'Content created': new Date('2024-03-01T09:00:00Z'),
    Revision: '7',
    'Editing time': '1 h 25 min',
    Pages: 3,
    Application: 'Microsoft Office Word',
  });
  assert.equal(items(details, 'Content').Words, 3);
});

test('a workbook is read as sheets of displayed cell texts', async () => {
  const data = XLSX.utils.aoa_to_sheet([
    ['Item', 'Amount', 'Due', 'Share'],
    ['Rent', 1234.5, null, 0.125],
    [],
    ['Tax', 0.1 + 0.2, null, null],
  ]);
  data.B2.z = '#,##0.00';
  data.D2.z = '0.0%';
  // 1 March 2019 in the default date format, and with a time in a German one.
  data.C2 = { t: 'n', v: 43525, z: 'm/d/yy' };
  data.C4 = { t: 'n', v: 43525.75, z: 'DD.MM.YYYY HH:MM' };
  data.B5 = { t: 'n', v: 1234.8, f: 'SUM(B2:B4)' };
  data['!ref'] = 'A1:D5';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, data, 'Costs');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[null], [null, 'offset']]), 'Second');
  workbook.Props = { Title: 'Costs 2024', Author: 'Ada', Company: 'Example AG' };
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const { text, sheets, details } = await parseFile(file('costs.xlsx', bytes));
  assert.deepEqual(sheets, [
    {
      name: 'Costs',
      rows: [
        ['Item', 'Amount', 'Due', 'Share'],
        ['Rent', '1,234.50', '2019-03-01', '12.5%'],
        [],
        ['Tax', '0.3', '2019-03-01 18:00'],
        ['', '1234.8'],
      ],
    },
    { name: 'Second', rows: [[], ['', 'offset']] },
  ]);
  assert.equal(
    text,
    '[Costs]\nItem\tAmount\tDue\tShare\nRent\t1,234.50\t2019-03-01\t12.5%\n\nTax\t0.3\t2019-03-01 18:00\n\t1234.8\n\n[Second]\n\n\toffset'
  );
  assert.deepEqual(
    details.map((group) => group.title),
    ['File', 'Document', 'Sheets']
  );
  assert.equal(items(details, 'Document').Title, 'Costs 2024');
  assert.equal(items(details, 'Document').Company, 'Example AG');
  assert.deepEqual(items(details, 'Sheets'), { Costs: '5 rows × 4 columns', Second: '2 rows × 2 columns' });
});

test('only dates written in digits are shown as year-month-day', () => {
  for (const format of ['m/d/yy', 'DD.MM.YYYY', 'dd/mm/yyyy;@', '[$-409]m/d/yyyy', 'yyyy\\-mm\\-dd']) {
    assert.equal(isoDateFormat(format), 'yyyy-mm-dd', format);
  }
  assert.equal(isoDateFormat('m/d/yy h:mm'), 'yyyy-mm-dd hh:mm');
  assert.equal(isoDateFormat('dd.mm.yyyy hh:mm:ss'), 'yyyy-mm-dd hh:mm:ss');
  for (const format of ['d-mmm-yy', 'mmmm yyyy', 'dddd, mmmm dd, yyyy', 'mm/yyyy', 'h:mm', '[h]:mm:ss', '0.00', 'General']) {
    assert.equal(isoDateFormat(format), null, format);
  }
});

test('delimited text is split into cells', async () => {
  const csv = 'Name;City;Note\r\n"Müller; Anna";Bern;"said ""hi"""\r\nBob;Basel;\r\nCid;Chur;"two\nlines"\r\n';
  const { text, sheets, details } = await parseFile(file('people.csv', Buffer.from(csv, 'utf8')));
  assert.deepEqual(sheets, [
    {
      name: '',
      rows: [
        ['Name', 'City', 'Note'],
        ['Müller; Anna', 'Bern', 'said "hi"'],
        ['Bob', 'Basel'],
        ['Cid', 'Chur', 'two\nlines'],
      ],
    },
  ]);
  assert.equal(text, 'Name\tCity\tNote\nMüller; Anna\tBern\tsaid "hi"\nBob\tBasel\nCid\tChur\ttwo lines');
  assert.deepEqual(items(details, 'Format'), { Encoding: 'UTF-8', 'Line endings': 'Mixed', Delimiter: 'Semicolon' });
  assert.deepEqual(items(details, 'Content'), { Size: '4 rows × 3 columns' });
});

test('the delimiter follows the file type or a sep= line', async () => {
  const rows = async (name, content) => (await parseFile(file(name, Buffer.from(content)))).sheets[0].rows;
  assert.deepEqual(await rows('a.csv', 'a,b;c\n1,2;3\n'), [
    ['a', 'b;c'],
    ['1', '2;3'],
  ]);
  assert.deepEqual(await rows('a.tsv', 'a,b\tc\n'), [['a,b', 'c']]);
  assert.deepEqual(await rows('a.csv', 'sep=|\na,b|c\n'), [['a,b', 'c']]);
  assert.deepEqual(await rows('empty.csv', ''), []);
});

test('plain text is read as a table only when asked to', async () => {
  const bytes = Buffer.from('Name\tCity\r\nBob\tBasel\r\n');
  const asText = await parseFile(file('export.txt', bytes));
  assert.equal(asText.sheets, undefined);
  assert.equal(asText.text, 'Name\tCity\r\nBob\tBasel\r\n');

  const asTable = await parseFile({ ...file('export.txt', bytes), table: true });
  assert.deepEqual(asTable.sheets, [
    {
      name: '',
      rows: [
        ['Name', 'City'],
        ['Bob', 'Basel'],
      ],
    },
  ]);
  assert.equal(items(asTable.details, 'Format').Delimiter, 'Tab');
  // What a file is doesn't depend on where it is opened.
  assert.equal((await parseFile({ ...file('terms.pdf.txt', Buffer.from('a b')), table: false })).sheets, undefined);
  await assert.rejects(parseFile({ ...file('old.doc', Buffer.from('x')), table: true }), /aren't supported/);
});

test('as code, CSV files are plain text, and binary files are still rejected', async () => {
  const csv = await parseFile({ ...file('data.csv', Buffer.from('a,b\n1,2\n')), code: true });
  assert.equal(csv.sheets, undefined);
  assert.equal(csv.text, 'a,b\n1,2\n');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['x']]), 'Data');
  const xlsx = await parseFile({ ...file('book.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })), code: true });
  assert.equal(xlsx.sheets[0].name, 'Data');
  await assert.rejects(parseFile({ ...file('image.bin', Buffer.from([0, 1, 2])), code: true }), /doesn't look like a text file/);
});

test('unsupported and binary files are rejected', async () => {
  await assert.rejects(parseFile(file('old.doc', Buffer.from('x'))), /aren't supported/);
  await assert.rejects(parseFile(file('image.bin', Buffer.from([0, 1, 2]))), /doesn't look like a text file/);
});

test('a file without bytes is read from disk', async () => {
  const { text } = await parseFile({ name: 'self.js', filePath: __filename, lastModified: 0, bytes: null });
  assert.match(text, /a file without bytes is read from disk/);
  await assert.rejects(parseFile({ name: 'test', filePath: __dirname, bytes: null }), /Folders can't be compared/);
});

test('password-protected and damaged Office files get a clear message', async () => {
  const compound = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  await assert.rejects(parseFile(file('secret.docx', compound)), /password-protected\. Open it in Word/);
  await assert.rejects(parseFile(file('secret.xlsx', compound)), /password-protected\. Open it in Excel/);
  await assert.rejects(parseFile(file('broken.docx', Buffer.from('not a zip at all'))), /damaged or isn't a Word document/);
});

test('a PDF without any text says so', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const { text, warning, source } = await parseFile(file('scan.pdf', Buffer.from(pdf)));
  assert.equal(text, '');
  assert.match(warning, /no text to compare/);
  assert.equal(source.kind, 'pdf');
  assert.equal(source.bytes.length, pdf.length);
  await assert.rejects(parseFile(file('fake.pdf', Buffer.from('hello'))), /damaged or isn't a PDF/);
});
