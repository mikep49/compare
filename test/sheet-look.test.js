const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const { parseFile } = require('../src/parse-file');
const { tint, columnWidth } = require('../src/sheet-look');

const file = (name, bytes) => ({ name, filePath: '', lastModified: 0, bytes });

// A workbook as Excel writes it, with the formatting the sheet view shows.
async function styledWorkbook() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Q&amp;A" sheetId="1" r:id="rId2"/><sheet name="Plain" sheetId="2" r:id="rId1"/></sheets></workbook>'
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>'
  );
  zip.file(
    'xl/theme/theme1.xml',
    '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>'
  );
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font><font><b/><i val="0"/><u val="double"/><sz val="14"/><color rgb="FFC00000"/><name val="Arial"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor indexed="5"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color indexed="64"/></left><right/><top/><bottom style="double"><color rgb="FF0000FF"/></bottom><diagonal/></border></borders>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment indent="2"/></xf></cellXfs>' +
      '</styleSheet>'
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C3"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
      '<cols><col min="1" max="1" width="20.7109375" customWidth="1"/><col min="3" max="4" width="9.140625" hidden="1" style="2"/></cols>' +
      '<sheetData><row r="1" ht="30" customHeight="1"><c r="A1" s="1" t="inlineStr"><is><t>Title</t></is></c><c r="B1" s="1"/></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Rent</t></is></c><c r="B2"><v>12</v></c><c r="C2" t="b"><v>1</v></c></row>' +
      '<row r="4" hidden="1" s="2" customFormat="1"><c r="E4" s="2"/></row></sheetData>' +
      '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>'
  );
  zip.file(
    'xl/worksheets/sheet2.xml',
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr baseColWidth="10" defaultRowHeight="16"/><sheetData><row><c t="inlineStr"><is><t>x</t></is></c><c s="3"><v>2</v></c></row></sheetData></worksheet>'
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('an Excel workbook comes with how each sheet looks', async () => {
  const { sheets, source } = await parseFile(file('styled.xlsx', await styledWorkbook()));
  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    ['Q&A', 'Plain']
  );
  assert.equal(source.kind, 'workbook');
  assert.equal(source.looks.length, 2);

  const [look, plain] = source.looks;
  // Both sheets share the workbook's styles.
  assert.equal(look.styles, plain.styles);
  const styleOf = (row, column) => look.styles[look.cells[row][column] - 1];

  assert.equal(look.gridlines, false);
  assert.equal(look.defaultHeight, 20);
  const yellow = look.cols[1][4];
  assert.deepEqual(look.cols, [
    [0, 0, 145, false, -1],
    [2, 3, 64, true, yellow],
  ]);
  assert.equal(look.styles[yellow].fill, '#ffff00');
  assert.deepEqual(look.rows, [
    [0, 40, false, -1],
    [3, 0, true, yellow],
  ]);
  assert.deepEqual(look.merges, [[0, 0, 0, 1]]);
  // Fills and borders reach to E4; the values only to C2.
  assert.equal(look.rowCount, 4);
  assert.equal(look.colCount, 5);

  assert.deepEqual(styleOf(0, 0), {
    font: 'Arial',
    size: 18.67,
    bold: true,
    italic: false,
    underline: 'double',
    strike: false,
    color: '#c00000',
    // Accent 1, lightened by 80%.
    fill: '#dae3f3',
    border: { left: ['solid', 1, '#000000'], right: null, top: null, bottom: ['double', 3, '#0000ff'] },
    h: 'center',
    v: 'center',
    wrap: true,
    indent: 0,
    kind: '',
  });
  // Without an alignment of their own, text goes left, numbers right and
  // true or false in the centre.
  assert.equal(styleOf(1, 0).h, 'left');
  assert.equal(styleOf(1, 0).color, '#000000');
  assert.equal(styleOf(1, 0).font, 'Calibri');
  assert.equal(styleOf(1, 1).h, 'right');
  assert.equal(styleOf(1, 2).h, 'center');
  assert.equal(styleOf(1, 0).fill, '');
  assert.equal(styleOf(3, 4).fill, '#ffff00');
  assert.equal(look.cells[2], undefined);

  // Cells and rows without a reference follow on from the last one.
  assert.equal(plain.defaultWidth, 80);
  assert.equal(plain.defaultHeight, 21);
  assert.equal(plain.gridlines, true);
  assert.equal(plain.styles[plain.cells[0][1] - 1].indent, 2);
  assert.equal(plain.styles[plain.cells[0][1] - 1].h, 'right');
});

test('other workbooks bring their column widths, row heights and merged cells', async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Item', 12, true],
    ['Long', 'x'],
  ]);
  sheet['!cols'] = [{ wch: 20 }, null, { wpx: 100, hidden: true }];
  sheet['!merges'] = [{ s: { r: 1, c: 1 }, e: { r: 2, c: 3 } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });

  const { sheets, source } = await parseFile(file('old.xls', bytes));
  assert.deepEqual(sheets[0].rows, [
    ['Item', '12', 'TRUE'],
    ['Long', 'x'],
  ]);
  const [look] = source.looks;
  assert.equal(look.cols.length, 2);
  assert.equal(look.cols[1][3], true);
  assert.deepEqual(look.merges, [[1, 1, 2, 3]]);
  assert.deepEqual(
    Array.from(look.cells[0], (number) => look.styles[number - 1].h),
    ['left', 'right', 'center']
  );
});

test('a workbook whose look can not be read still opens', async () => {
  const bytes = await styledWorkbook();
  const zip = await JSZip.loadAsync(bytes);
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf fontId="9" fillId="9" borderId="9"/></cellXfs></styleSheet>');
  const { sheets, source } = await parseFile(file('odd.xlsx', await zip.generateAsync({ type: 'nodebuffer' })));
  assert.equal(sheets[0].rows[0][0], 'Title');
  assert.equal(source.looks[0].styles[source.looks[0].cells[0][0] - 1].fill, '');
});

test('CSV files have no look of their own', async () => {
  const { source } = await parseFile(file('data.csv', Buffer.from('a,b\n1,2\n')));
  assert.equal(source, undefined);
});

test('tints lighten towards white and darken towards black', () => {
  assert.equal(tint('4472C4', 0), '4472C4');
  assert.equal(tint('000000', 0.5), '808080');
  assert.equal(tint('FFFFFF', -0.5), '808080');
  assert.equal(tint('4472C4', -0.25), '2f5597');
});

test('column widths in characters become pixels as Excel shows them', () => {
  assert.equal(columnWidth(9.140625), 64);
  assert.equal(columnWidth(20.7109375), 145);
  assert.equal(columnWidth(0), 0);
});
