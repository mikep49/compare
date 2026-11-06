// How the sheets of a workbook look: column widths, row heights, merged
// cells, gridlines and the formatting of each cell, for the sheet view to
// show them as a spreadsheet program does. Excel workbooks (.xlsx, .xlsm)
// are read in full from their XML; of the other formats SheetJS knows the
// column widths, row heights and merged cells.
//
// readLooks() returns one look per sheet of the workbook:
//   styles         [style] shared by the sheets of a workbook, the first one
//                  that of empty cells
//   cells          per row, null or a Uint16Array with, per column, 1 + the
//                  style of the cell there, or 0 where there's no cell
//   rows           [[row, height, hidden, style]] for the rows that have a
//                  height (0: the default), visibility or style of their own
//                  (-1: none)
//   cols           [[first, last, width, hidden, style]], alike for columns
//   defaultWidth   of a column, and defaultHeight of a row, in CSS pixels
//   merges         [[top, left, bottom, right]] cells merged into one
//   gridlines      whether the sheet shows gridlines
//   rowCount, colCount
//                  how far formatting that can be seen (fills, borders and
//                  merged cells) reaches; values can reach further
//
// A style is { font, size, bold, italic, underline, strike, color, fill,
// border, h, v, wrap, indent, kind }:
//   font, size     the font's name ('' for the default) and size
//   underline      '', 'single' or 'double'
//   border         null or { left, right, top, bottom }, each null or
//                  [CSS border style, width, color]
//   h, v           the horizontal and vertical alignment, as Excel names
//                  them; text that isn't aligned is already put where its
//                  kind of value goes
//   wrap           whether text wraps onto more lines
//   indent         in steps of about three spaces
//   kind           of the value: 'n' numbers and dates, 'c' true, false and
//                  errors, '' text. Only text spills into empty cells next
//                  to it.
//
// Sizes are CSS pixels, colors '#rrggbb' or ''.

// The width of a digit in Calibri 11, which Excel measures columns in.
const DIGIT = 7;
const PT = 96 / 72;
const DEFAULT_HEIGHT = 20;
const DEFAULT_WIDTH = 64;

// Excel's colors by number, for files that name them so.
const PALETTE = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];
// Theme colors are numbered with the first two pairs swapped.
const THEME_COLORS = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
// How much of the pattern color a patterned fill shows, roughly.
const PATTERNS = { gray0625: 0.0625, gray125: 0.125, lightGray: 0.25, mediumGray: 0.5, darkGray: 0.75 };
// Border styles as [CSS style, width].
const BORDERS = {
  thin: ['solid', 1],
  hair: ['dotted', 1],
  dotted: ['dotted', 1],
  dashed: ['dashed', 1],
  dashDot: ['dashed', 1],
  dashDotDot: ['dashed', 1],
  medium: ['solid', 2],
  mediumDashed: ['dashed', 2],
  mediumDashDot: ['dashed', 2],
  mediumDashDotDot: ['dashed', 2],
  slantDashDot: ['dashed', 2],
  thick: ['solid', 3],
  double: ['double', 3],
};
const ALIGNMENTS = new Set(['left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed']);
const VERTICAL = new Set(['top', 'center', 'bottom', 'justify', 'distributed']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (text) =>
  text.replace(/&(#x?[\da-f]+|\w+);/gi, (entity, code) => {
    if (code[0] !== '#') return ENTITIES[code] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });

function attributes(text) {
  const values = {};
  for (const [, name, double, single] of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    values[name] = decode(double ?? single);
  }
  return values;
}

// The `tag` elements in `xml`, whatever their namespace prefix, as
// { attrs, body }. They must not hold elements of their own name.
function elements(xml, tag) {
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
  return Array.from(xml.matchAll(pattern), (match) => ({ attrs: attributes(match[1]), body: match[2] ?? '' }));
}

const element = (xml, tag) => elements(xml, tag)[0] ?? null;
const isOn = (value) => value !== undefined && value !== '0' && value !== 'false';
const hex = (rgb) => `#${rgb.slice(-6).toLowerCase()}`;

// Excel's tint: lightens a color towards white (above 0) or darkens it
// towards black (below 0), in HSL.
function tint(rgb, amount) {
  if (!amount) return rgb;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta > 0) {
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / delta + 2) / 6;
    else hue = ((r - g) / delta + 4) / 6;
  }
  lightness = amount < 0 ? lightness * (1 + amount) : lightness * (1 - amount) + amount;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  [r, g, b] = saturation === 0 ? [lightness, lightness, lightness] : [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
  return [r, g, b].map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')).join('');
}

// The theme's colors in the order cells number them.
function readTheme(xml) {
  const scheme = xml && element(xml, 'clrScheme');
  return THEME_COLORS.map((name, i) => {
    const color = scheme && element(scheme.body, name);
    const rgb = color && /(?:srgbClr\s+val|lastClr)="([\da-f]{6})"/i.exec(color.body);
    return rgb ? rgb[1].toUpperCase() : DEFAULT_THEME[i];
  });
}

// Column widths are stored in characters, padding included.
const columnWidth = (characters) => Math.max(0, Math.trunc(((256 * characters + Math.trunc(128 / DIGIT)) / 256) * DIGIT));
const rowHeight = (points) => Math.max(0, Math.round(points * PT));
// Font sizes are in points.
const px = (points) => Math.round(points * PT * 100) / 100;

// Reads the shared styles of an Excel workbook. Returns style(xf, kind),
// which gives the number of the style for cells with that formatting and
// that kind of value, adding it to `styles` when it's new.
function readStyles(xml, themeXml) {
  const theme = readTheme(themeXml);
  const custom = element(xml, 'indexedColors');
  const palette = custom ? elements(custom.body, 'rgbColor').map(({ attrs }) => (attrs.rgb ?? '000000').slice(-6)) : PALETTE;

  // `fallback` stands in for automatic colors.
  const color = (el, fallback = '') => {
    if (!el) return fallback;
    const { rgb, theme: index, indexed, tint: amount } = el.attrs;
    let value = null;
    if (rgb && /^[\da-f]{6,8}$/i.test(rgb)) value = rgb.slice(-6);
    else if (index !== undefined) value = theme[Number(index)] ?? null;
    else if (indexed !== undefined) value = palette[Number(indexed)] ?? null;
    if (!value) return fallback;
    return hex(tint(value, Number(amount) || 0));
  };

  const fonts = elements(element(xml, 'fonts')?.body ?? '', 'font').map(({ body }) => {
    const value = (tag) => element(body, tag)?.attrs.val;
    const flag = (tag) => {
      const el = element(body, tag);
      return Boolean(el) && (el.attrs.val === undefined || isOn(el.attrs.val));
    };
    const underline = element(body, 'u');
    return {
      font: value('name') ?? value('rFont') ?? '',
      size: px(Number(value('sz')) || 11),
      bold: flag('b'),
      italic: flag('i'),
      underline: underline && underline.attrs.val !== 'none' ? (/double/.test(underline.attrs.val ?? '') ? 'double' : 'single') : '',
      strike: flag('strike'),
      color: color(element(body, 'color')),
    };
  });

  const fills = elements(element(xml, 'fills')?.body ?? '', 'fill').map(({ body }) => {
    const pattern = element(body, 'patternFill');
    if (pattern) {
      const type = pattern.attrs.patternType ?? (element(pattern.body, 'fgColor') ? 'solid' : 'none');
      if (type === 'none') return '';
      const fg = color(element(pattern.body, 'fgColor'), '#000000');
      if (type === 'solid') return fg;
      const bg = color(element(pattern.body, 'bgColor'), '#ffffff');
      return mix(fg, bg, PATTERNS[type] ?? 0.5);
    }
    const gradient = element(body, 'gradientFill');
    return gradient ? color(element(gradient.body, 'color')) : '';
  });

  const borders = elements(element(xml, 'borders')?.body ?? '', 'border').map(({ body }) => {
    const side = (...tags) => {
      for (const tag of tags) {
        const edge = element(body, tag);
        const kind = edge && BORDERS[edge.attrs.style];
        if (kind) return [...kind, color(element(edge.body, 'color'), '#000000')];
      }
      return null;
    };
    const border = { left: side('left', 'start'), right: side('right', 'end'), top: side('top'), bottom: side('bottom') };
    return Object.values(border).some(Boolean) ? border : null;
  });

  const xfs = elements(element(xml, 'cellXfs')?.body ?? '', 'xf').map(({ attrs, body }) => ({
    font: Number(attrs.fontId) || 0,
    fill: Number(attrs.fillId) || 0,
    border: Number(attrs.borderId) || 0,
    alignment: element(body, 'alignment')?.attrs ?? {},
  }));

  const defaults = { font: '', size: px(11), bold: false, italic: false, underline: '', strike: false, color: '' };
  const styles = [];
  const known = new Map();
  // `kind` is that of the cell's value, which aligns it when the format
  // doesn't: 'n' numbers to the right, 'c' true, false and errors to the
  // centre, text to the left.
  const style = (index, kind) => {
    const key = `${index}|${kind}`;
    let number = known.get(key);
    if (number !== undefined) return number;
    const xf = xfs[index] ?? xfs[0] ?? { font: 0, fill: 0, border: 0, alignment: {} };
    const { alignment } = xf;
    let h = ALIGNMENTS.has(alignment.horizontal) ? alignment.horizontal : '';
    if (!h) h = kind === 'n' ? 'right' : kind === 'c' ? 'center' : 'left';
    number = styles.length;
    styles.push({
      ...defaults,
      ...(fonts[xf.font] ?? fonts[0]),
      fill: fills[xf.fill] ?? '',
      border: borders[xf.border] ?? null,
      h,
      v: VERTICAL.has(alignment.vertical) ? alignment.vertical : 'bottom',
      wrap: isOn(alignment.wrapText) || h === 'justify' || h === 'distributed',
      indent: Number(alignment.indent) || 0,
      kind,
    });
    known.set(key, number);
    return number;
  };
  // The style of empty cells, and of the workbook as a whole.
  style(0, '');
  return { styles, style };
}

function mix(a, b, share) {
  const channel = (color, i) => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(a, i) * share + channel(b, i) * (1 - share)).toString(16).padStart(2, '0'))
    .join('')}`;
}

// What a cell's value is, by its type in the file or in SheetJS.
function kindOf(type) {
  if (type === 'b' || type === 'e') return 'c';
  if (type === 's' || type === 'str' || type === 'inlineStr' || type === 'z') return '';
  return 'n';
}

// The value of a double-quoted attribute in the text of a tag.
const attributePatterns = new Map();
function attribute(text, name) {
  if (!attributePatterns.has(name)) attributePatterns.set(name, new RegExp(`\\s${name}="`));
  const at = text.search(attributePatterns.get(name));
  if (at < 0) return undefined;
  const start = at + name.length + 3;
  return text.slice(start, text.indexOf('"', start));
}

// The column of a cell reference such as AB12, or -1.
function columnOf(ref) {
  let column = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i) & ~32;
    if (code < 65 || code > 90) break;
    column = column * 26 + code - 64;
  }
  return column - 1;
}

function cellAddress(ref) {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return [Number(match[2]) - 1, column - 1];
}

function rangeOf(ref) {
  const [from, to = from] = ref.split(':');
  const start = cellAddress(from);
  const end = cellAddress(to);
  return start && end ? [start[0], start[1], end[0], end[1]] : null;
}

function emptyLook(styles) {
  return {
    styles,
    cells: [],
    rows: [],
    cols: [],
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    merges: [],
    gridlines: true,
    rowCount: 0,
    colCount: 0,
  };
}

// Goes through the XML of a worksheet once.
function readWorksheet(xml, styles, style) {
  const look = emptyLook(styles);
  const shows = (number) => Boolean(styles[number].fill || styles[number].border);
  let row = -1;
  let column = -1;
  let current = null;
  let sawView = false;
  const flush = () => {
    if (current && current.length > 0) look.cells[row] = Uint16Array.from(current);
    current = null;
  };
  const tags = /<(?:\w+:)?(row|c|col|mergeCell|sheetView|sheetFormatPr)\b([^>]*)>/g;
  for (const [, tag, rest] of xml.matchAll(tags)) {
    if (tag === 'c') {
      // Cells are by far the most, and have only these attributes that
      // matter; Excel writes them in double quotes.
      const quick = !rest.includes("'");
      const ref = quick ? attribute(rest, 'r') : attributes(rest).r;
      if (ref) column = columnOf(ref);
      else column++;
      if (row < 0 || column < 0 || column > 16383) continue;
      const s = quick ? attribute(rest, 's') : attributes(rest).s;
      const t = quick ? attribute(rest, 't') : attributes(rest).t;
      const number = style(Number(s) || 0, kindOf(t));
      current ??= [];
      current[column] = number + 1;
      if (shows(number)) {
        look.rowCount = Math.max(look.rowCount, row + 1);
        look.colCount = Math.max(look.colCount, column + 1);
      }
      continue;
    }
    const attrs = attributes(rest);
    if (tag === 'row') {
      flush();
      row = attrs.r ? Number(attrs.r) - 1 : row + 1;
      column = -1;
      const height = attrs.ht !== undefined ? rowHeight(Number(attrs.ht)) : 0;
      const hidden = isOn(attrs.hidden);
      const own = isOn(attrs.customFormat) && attrs.s !== undefined ? style(Number(attrs.s) || 0, '') : -1;
      if (height || hidden || own >= 0) look.rows.push([row, height, hidden, own]);
    } else if (tag === 'col') {
      const first = Number(attrs.min) - 1;
      const last = Math.min(16383, Number(attrs.max) - 1);
      if (!(first >= 0 && last >= first)) continue;
      const width = attrs.width !== undefined ? columnWidth(Number(attrs.width)) : 0;
      const own = attrs.style !== undefined ? style(Number(attrs.style) || 0, '') : -1;
      look.cols.push([first, last, width, isOn(attrs.hidden), own]);
    } else if (tag === 'mergeCell') {
      const range = attrs.ref && rangeOf(attrs.ref);
      if (!range) continue;
      look.merges.push(range);
      look.rowCount = Math.max(look.rowCount, range[2] + 1);
      look.colCount = Math.max(look.colCount, range[3] + 1);
    } else if (tag === 'sheetView' && !sawView) {
      sawView = true;
      look.gridlines = attrs.showGridLines === undefined || isOn(attrs.showGridLines);
    } else if (tag === 'sheetFormatPr') {
      if (attrs.defaultRowHeight !== undefined) look.defaultHeight = rowHeight(Number(attrs.defaultRowHeight)) || DEFAULT_HEIGHT;
      if (attrs.defaultColWidth !== undefined) {
        look.defaultWidth = columnWidth(Number(attrs.defaultColWidth)) || DEFAULT_WIDTH;
      } else if (attrs.baseColWidth !== undefined) {
        // Excel rounds the default width up to a multiple of 8 pixels.
        look.defaultWidth = Math.ceil((Number(attrs.baseColWidth) * DIGIT + 5) / 8) * 8 || DEFAULT_WIDTH;
      }
    }
  }
  flush();
  return look;
}

// Where the parts of an Excel workbook are, as its relationships say.
function relationships(files, part) {
  const folder = part.slice(0, part.lastIndexOf('/') + 1);
  const rels = files.text(`${folder}_rels/${part.slice(folder.length)}.rels`);
  const targets = new Map();
  for (const { attrs } of elements(rels, 'Relationship')) {
    if (!attrs.Id || !attrs.Target) continue;
    const target = attrs.Target.startsWith('/') ? attrs.Target.slice(1) : normalize(folder + attrs.Target);
    targets.set(attrs.Id, { target, type: attrs.Type ?? '' });
  }
  return targets;
}

function normalize(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function readExcel(workbook) {
  const raw = workbook.files ?? {};
  const files = {
    text(name) {
      const file = raw[name] ?? raw[Object.keys(raw).find((key) => key.toLowerCase() === name.toLowerCase())];
      return file?.content ? Buffer.from(file.content).toString('utf8') : '';
    },
  };
  const book = [...relationships(files, '').values()].find(({ type }) => /\/officeDocument$/.test(type))?.target ?? 'xl/workbook.xml';
  const parts = relationships(files, book);
  const partOf = (kind) => [...parts.values()].find(({ type }) => type.endsWith(`/${kind}`))?.target;
  const { styles, style } = readStyles(files.text(partOf('styles') ?? 'xl/styles.xml'), files.text(partOf('theme') ?? ''));
  const paths = new Map();
  for (const { attrs } of elements(files.text(book), 'sheet')) {
    const id = Object.entries(attrs).find(([name]) => /(^|:)id$/.test(name) && name !== 'sheetId')?.[1];
    const part = id && parts.get(id);
    if (part) paths.set(attrs.name, part.target);
  }
  return workbook.SheetNames.map((name) => {
    const path = paths.get(name);
    return path ? readWorksheet(files.text(path), styles, style) : emptyLook(styles);
  });
}

// For formats other than Excel's own: what SheetJS read with cellStyles on.
function readOther(workbook) {
  const styles = [];
  const known = new Map();
  const style = (kind) => {
    if (!known.has(kind)) {
      known.set(kind, styles.length);
      styles.push({
        font: '',
        size: px(11),
        bold: false,
        italic: false,
        underline: '',
        strike: false,
        color: '',
        fill: '',
        border: null,
        h: kind === 'n' ? 'right' : kind === 'c' ? 'center' : 'left',
        v: 'bottom',
        wrap: false,
        indent: 0,
        kind,
      });
    }
    return known.get(kind);
  };
  style('');
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name] ?? {};
    const look = emptyLook(styles);
    const data = sheet['!data'] ?? [];
    for (let row = 0; row < data.length; row++) {
      if (!data[row]) continue;
      const numbers = Array.from(data[row], (cell) => (cell && cell.t !== 'z' ? style(kindOf(cell.t)) + 1 : 0));
      if (numbers.some(Boolean)) look.cells[row] = Uint16Array.from(numbers);
    }
    (sheet['!cols'] ?? []).forEach((col, i) => {
      if (!col) return;
      const width = col.width !== undefined ? columnWidth(col.width) : (col.wpx ?? 0);
      if (width || col.hidden) look.cols.push([i, i, width, Boolean(col.hidden), -1]);
    });
    (sheet['!rows'] ?? []).forEach((row, i) => {
      if (!row) return;
      const height = row.hpt !== undefined ? rowHeight(row.hpt) : (row.hpx ?? 0);
      if (height || row.hidden) look.rows.push([i, height, Boolean(row.hidden), -1]);
    });
    for (const { s, e } of sheet['!merges'] ?? []) {
      look.merges.push([s.r, s.c, e.r, e.c]);
      look.rowCount = Math.max(look.rowCount, e.r + 1);
      look.colCount = Math.max(look.colCount, e.c + 1);
    }
    return look;
  });
}

// `workbook` is as SheetJS read it: Excel workbooks with bookFiles on, the
// other formats with cellStyles on.
function readLooks(workbook, excel) {
  return excel ? readExcel(workbook) : readOther(workbook);
}

module.exports = { readLooks, tint, columnWidth };
