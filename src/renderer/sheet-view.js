// The sheet view: the two spreadsheets of a comparison side by side as a
// spreadsheet program shows them, with their column widths, row heights,
// fonts, fills, borders and merged cells, and the changes the comparison
// found marked on them. It shows one pair of sheets at a time, in a
// .doc-view element like the document view, and has only the rows and
// columns in view in the DOM. Each side scrolls on its own and, with
// "Scroll together" on, the other side keeps the rows that go together in
// view. With "Differences only" on, the rows without a change are faded.
function createSheetView(root) {
  const SIDES = ['left', 'right'];
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const MIN_ZOOM = ZOOM_STEPS[0];
  const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  // Must match the padding of .doc-pages in styles.css.
  const PAGE_GAP = 16;
  // The height of the row of column letters.
  const HEAD = 20;
  // Empty rows and columns shown after the last ones with something in them.
  const MORE_ROWS = 3;
  const MORE_COLUMNS = 2;
  // Formatting alone makes a sheet at most this much longer and wider than
  // its values.
  const FORMAT_ROWS = 200;
  const FORMAT_COLUMNS = 50;
  const ROW_OVERSCAN = 15;
  const COLUMN_OVERSCAN = 4;
  // How many columns away text that spills over empty cells is looked for.
  const SPILL_REACH = 64;
  // How far down the view a change is put when going to it.
  const REVEAL_AT = 0.3;
  // Pairs of rows kept for scrolling together; more only take longer.
  const MAX_SYNC_POINTS = 4000;
  const MAX_MATCHES = 100000;
  // A step of indentation.
  const INDENT = 9;
  // Cells typed, pasted or read from a CSV file have no look of their own:
  // their columns are made as wide as their text, within these limits.
  const NUMERIC = /^[-+]?\d[\d.,'’ ]*%?$/;
  const AUTO_MIN = 64;
  const AUTO_MAX = 340;
  const BASE_STYLE = {
    font: '',
    size: 14.67,
    bold: false,
    italic: false,
    underline: '',
    strike: false,
    color: '',
    fill: '',
    border: null,
    v: 'bottom',
    wrap: false,
    indent: 0,
  };
  const PLAIN_STYLES = [
    { ...BASE_STYLE, h: 'left', kind: '' },
    { ...BASE_STYLE, h: 'right', kind: 'n' },
  ];
  const JUSTIFY = { left: 'flex-start', fill: 'flex-start', justify: 'flex-start', center: 'center', centerContinuous: 'center', distributed: 'center', right: 'flex-end' };
  const TEXT_ALIGN = { justify: 'justify', distributed: 'justify', center: 'center', centerContinuous: 'center', right: 'right' };
  const ALIGN_ITEMS = { top: 'flex-start', center: 'center', justify: 'center', distributed: 'center' };
  const EDGES = ['left', 'right', 'top', 'bottom'];

  const zoomLabel = root.querySelector('.doc-zoom-level');
  const syncButton = root.querySelector('.doc-sync');
  const ruler = document.createElement('canvas').getContext('2d');

  const sides = {};
  for (const name of SIDES) {
    const pane = root.querySelector(`.doc-pane[data-side="${name}"]`);
    sides[name] = {
      name,
      scroller: pane.querySelector('.doc-scroll'),
      pagesEl: pane.querySelector('.doc-pages'),
      statusEl: pane.querySelector('.doc-status'),
      // The sheet on show, as { name, rows } with rows of cell texts, and
      // how it looks (see sheet-look.js), or null for cells without a look.
      sheet: null,
      look: null,
      values: [],
      styles: PLAIN_STYLES,
      // The class names of its styles start with this.
      prefix: '',
      // Where each row and column starts, then where the last one ends.
      tops: new Float64Array(1),
      lefts: new Float64Array(1),
      rowStyles: new Map(),
      colStyles: new Int32Array(0),
      merges: [],
      gutter: 32,
      // The elements of the sheet: cells, tints and outlines over them, row
      // numbers and column letters.
      grid: null,
      marks: null,
      rings: null,
      rowHead: null,
      colHead: null,
      // The rows and columns in the DOM.
      rendered: null,
      // What the comparison marks: rows by their type, the changed cells of
      // each row, and columns only this side has.
      rowMarks: new Map(),
      cellMarks: new Map(),
      colMarks: new Set(),
      // The columns of each row that have what Find looks for.
      found: new Map(),
      // Where this side was scrolled to by the other, so that the scroll
      // isn't passed back.
      expected: null,
    };
  }
  const other = (side) => (side === sides.left ? sides.right : sides.left);

  // One entry of TableDiff.compare().
  let diff = null;
  // Runs of differing rows, as { start, end } indexes into diff.rows.
  let blocks = [];
  let current = -1;
  let query = '';
  // [{ side, row, column }], left side first.
  let matches = [];
  let currentMatch = -1;
  let zoom = 1;
  // Off unless turned on, so that the mouse wheel scrolls only the sheet
  // it's over.
  let syncOn = false;
  try {
    syncOn = localStorage.getItem('sheetScrollTogether') === 'on';
  } catch {
    // Scrolling on their own is the default.
  }
  // Positions that go together, worked out when first needed.
  let syncTable = null;

  // The CSS of the styles of the workbooks on show, by their styles.
  const styleSheets = new Map();
  let styleSheetCount = 0;

  function element(className, text) {
    const el = document.createElement('div');
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  const cssColor = (value) => (/^#[\da-f]{6}$/i.test(value) ? value : '');
  const fontName = (name) => name.replace(/["\\;{}<>\r\n]/g, '');
  const sizeOf = (edges, index) => edges[index + 1] - edges[index];
  const textAt = (side, row, column) => side.values[row]?.[column] ?? '';

  // The last index whose edge is at or above `at`.
  function indexAt(edges, at) {
    let low = 0;
    let high = edges.length - 2;
    if (high < 0) return 0;
    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      if (edges[mid] <= at) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  function setStatus(side, kind, text) {
    side.statusEl.hidden = !kind;
    side.statusEl.dataset.kind = kind || '';
    side.statusEl.querySelector('.doc-status-text').textContent = text || '';
  }

  // The CSS rules for one style: the cell itself, its text and its borders,
  // which overlap the gridlines of the cells before it.
  function rules(name, style) {
    const cell = [`font-size:${style.size}px`];
    if (style.font) cell.push(`font-family:"${fontName(style.font)}",var(--ss-font)`);
    if (style.bold) cell.push('font-weight:700');
    if (style.italic) cell.push('font-style:italic');
    if (cssColor(style.color)) cell.push(`color:${style.color}`);
    // Like Excel, a fill hides the gridlines.
    if (cssColor(style.fill)) cell.push(`background-color:${style.fill}`, 'box-shadow:none');
    const text = [
      `justify-content:${JUSTIFY[style.h] ?? 'flex-start'}`,
      `text-align:${TEXT_ALIGN[style.h] ?? 'left'}`,
      `align-items:${ALIGN_ITEMS[style.v] ?? 'flex-end'}`,
    ];
    if (style.wrap) text.push('white-space:pre-wrap', 'overflow-wrap:anywhere');
    if (style.indent) text.push(`padding-${style.h === 'right' ? 'right' : 'left'}:${3 + style.indent * INDENT}px`);
    const lines = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean);
    if (lines.length > 0) text.push(`text-decoration:${lines.join(' ')}${style.underline === 'double' ? ' double' : ''}`);
    let css = `.${name}{${cell.join(';')}}.${name}>.ss-t{${text.join(';')}}`;
    const borders = EDGES.filter((edge) => style.border?.[edge]).map((edge) => {
      const [kind, width, color] = style.border[edge];
      return `border-${edge}:${Number(width) || 1}px ${kind} ${cssColor(color) || '#000000'}`;
    });
    if (borders.length > 0) css += `.${name}::after{content:'';${borders.join(';')}}`;
    return css;
  }

  // The prefix of the class names of a workbook's styles, adding their CSS
  // when they're new. It goes into a style sheet of its own, as the page's
  // Content-Security-Policy doesn't allow <style> elements.
  function classesFor(styles) {
    let entry = styleSheets.get(styles);
    if (!entry) {
      const prefix = `ss${++styleSheetCount}`;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styles.map((style, i) => rules(`${prefix}-${i}`, style)).join('\n'));
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      entry = { prefix, sheet };
      styleSheets.set(styles, entry);
    }
    return entry.prefix;
  }

  function dropStyleSheets(keep) {
    for (const [styles, { sheet }] of styleSheets) {
      if (keep.includes(styles)) continue;
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((other) => other !== sheet);
      styleSheets.delete(styles);
    }
  }

  // The number of the style of a cell: its own, else its row's, else its
  // column's. Cells without a look are told apart by their text alone.
  function styleAt(side, row, column) {
    const { look } = side;
    if (!look) return NUMERIC.test(textAt(side, row, column)) ? 1 : 0;
    const own = look.cells[row]?.[column];
    if (own) return own - 1;
    const rowStyle = side.rowStyles.get(row);
    if (rowStyle !== undefined) return rowStyle;
    return side.colStyles[column] >= 0 ? side.colStyles[column] : 0;
  }

  // What the comparison marks on a side's sheet.
  function markChanges(side) {
    side.rowMarks = new Map();
    side.cellMarks = new Map();
    side.colMarks = new Set();
    if (!side.sheet) return;
    const name = side.name;
    const otherName = other(side).name;
    for (const row of diff.rows) {
      const index = row[name];
      if (index < 0 || row.type === 'equal') continue;
      side.rowMarks.set(index, row.type);
      if (row.type === 'changed') {
        side.cellMarks.set(
          index,
          row.cells.map((cell) => diff.columns[cell][name]).filter((column) => column >= 0)
        );
      }
    }
    // A sheet without a counterpart is all removed or added rows; its
    // columns aren't marked on top of that.
    if (diff[otherName]) {
      for (const column of diff.columns) {
        if (column[name] >= 0 && column[otherName] < 0) side.colMarks.add(column[name]);
      }
    }
  }

  function measure(side, columns) {
    const style = getComputedStyle(root);
    ruler.font = `${BASE_STYLE.size}px ${style.getPropertyValue('--ss-font') || 'sans-serif'}`;
    const widths = new Float64Array(columns).fill(AUTO_MIN);
    side.values.forEach((row, r) => {
      // Every cell of the first rows, and further down the longest.
      row.forEach((text, c) => {
        if (!text || (r >= 200 && text.length * 9 + 10 < widths[c])) return;
        widths[c] = Math.max(widths[c], Math.min(AUTO_MAX, Math.ceil(ruler.measureText(text.slice(0, 200)).width) + 10));
      });
    });
    return widths;
  }

  function prefixSums(sizes) {
    const edges = new Float64Array(sizes.length + 1);
    for (let i = 0; i < sizes.length; i++) edges[i + 1] = edges[i] + sizes[i];
    return edges;
  }

  // Works out where the rows and columns of a side's sheet go. Hidden rows
  // and columns stay hidden, unless something is marked in them.
  function layOut(side) {
    const { look, values } = side;
    const valueColumns = values.reduce((max, row) => Math.max(max, row.length), 0);
    const rows = Math.max(values.length, Math.min(look?.rowCount ?? 0, values.length + FORMAT_ROWS)) + MORE_ROWS;
    const columns = Math.max(valueColumns, Math.min(look?.colCount ?? 0, valueColumns + FORMAT_COLUMNS)) + MORE_COLUMNS;

    const markedColumns = new Set(side.colMarks);
    for (const cells of side.cellMarks.values()) for (const column of cells) markedColumns.add(column);
    const widths = look ? new Float64Array(columns).fill(look.defaultWidth) : measure(side, columns);
    side.colStyles = new Int32Array(columns).fill(-1);
    for (const [first, last, width, hidden, style] of look?.cols ?? []) {
      for (let c = first; c <= Math.min(last, columns - 1); c++) {
        if (width) widths[c] = width;
        if (hidden && !markedColumns.has(c)) widths[c] = 0;
        side.colStyles[c] = style;
      }
    }
    const heights = new Float64Array(rows).fill(look?.defaultHeight ?? 20);
    const sized = new Set();
    side.rowStyles = new Map();
    for (const [row, height, hidden, style] of look?.rows ?? []) {
      if (row >= rows) continue;
      if (height) {
        heights[row] = height;
        sized.add(row);
      }
      if (hidden && !side.rowMarks.has(row)) heights[row] = 0;
      if (style >= 0) side.rowStyles.set(row, style);
    }
    side.merges = (look?.merges ?? [])
      .filter(([top, left, bottom, right]) => top < rows && left < columns && (bottom > top || right > left))
      .map(([top, left, bottom, right]) => [top, left, Math.min(bottom, rows - 1), Math.min(right, columns - 1)]);
    if (look) fitRows(side, heights, widths, sized);
    side.tops = prefixSums(heights);
    side.lefts = prefixSums(widths);
    side.gutter = Math.max(32, 14 + String(rows).length * 7);
  }

  // How many lines text takes, wrapped to `room` pixels in the ruler's font.
  function lineCount(text, room) {
    let lines = 0;
    for (const paragraph of text.split('\n')) {
      lines++;
      let used = 0;
      for (const word of paragraph.split(/(?<= )/)) {
        const width = ruler.measureText(word.trimEnd()).width;
        if (used > 0 && used + width > room) {
          lines++;
          used = 0;
        }
        // Words longer than a line are broken anywhere.
        if (width > room) {
          lines += Math.floor(width / room);
          used = width % room;
        } else {
          used += ruler.measureText(word).width;
        }
      }
    }
    return lines;
  }

  // Rows the file gives no height grow to fit wrapped text and larger
  // fonts, as spreadsheet programs size them when they open the file.
  function fitRows(side, heights, widths, sized) {
    const family = getComputedStyle(root).getPropertyValue('--ss-font') || 'sans-serif';
    for (let r = 0; r < side.values.length && r < heights.length; r++) {
      if (sized.has(r) || heights[r] <= 0) continue;
      let need = 0;
      side.values[r].forEach((text, c) => {
        if (!text || widths[c] <= 0) return;
        const style = side.styles[styleAt(side, r, c)];
        if (!style || (!style.wrap && style.size <= BASE_STYLE.size) || mergeAt(side.merges, r, c)) return;
        let lines = 1;
        if (style.wrap) {
          const name = style.font ? `"${fontName(style.font)}", ` : '';
          ruler.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${style.size}px ${name}${family}`;
          const indent = style.indent ? 3 + style.indent * INDENT : 0;
          lines = lineCount(text, Math.max(8, widths[c] - 7 - indent));
        }
        // A line of 11 point text takes Excel's default 20 pixels.
        need = Math.max(need, Math.round(lines * (style.size * 1.2 + 2.4)));
      });
      // Excel's rows are at most 409 points high.
      if (need > heights[r]) heights[r] = Math.min(need, 545);
    }
  }

  function build(side) {
    const page = element('ss-page');
    page.classList.toggle('no-grid', side.look?.gridlines === false);
    const width = side.lefts[side.lefts.length - 1];
    const height = side.tops[side.tops.length - 1];
    page.style.gridTemplateColumns = `${side.gutter}px ${width}px`;
    page.style.gridTemplateRows = `${HEAD}px ${height}px`;
    side.grid = element('ss-grid');
    side.marks = element('ss-marks');
    side.rings = element('ss-rings');
    side.rowHead = element('ss-rows');
    side.colHead = element('ss-cols');
    page.append(side.grid, side.marks, side.rings, side.rowHead, side.colHead, element('ss-corner'));
    side.pagesEl.replaceChildren(page);
  }

  // The merged cells a cell is in, among `merges`.
  const mergeAt = (merges, row, column) =>
    merges.find(([top, left, bottom, right]) => row >= top && row <= bottom && column >= left && column <= right);

  const spillsRight = (style) => style.h === 'left' || style.h === 'center' || style.h === 'centerContinuous';
  const spillsLeft = (style) => style.h === 'right' || style.h === 'center' || style.h === 'centerContinuous';
  const canSpill = (style) => style.kind === '' && !style.wrap;

  // Lets text run on over the empty cells beside it, as spreadsheets do;
  // numbers never do.
  function spill(side, row, column, style, span, near) {
    if (!canSpill(style)) return;
    const { lefts } = side;
    const columns = lefts.length - 1;
    const empty = (c) => textAt(side, row, c) === '' && !mergeAt(near, row, c);
    let first = column;
    let last = column;
    if (spillsRight(style)) {
      while (last + 1 < columns && last - column < SPILL_REACH && empty(last + 1)) last++;
    }
    if (spillsLeft(style)) {
      while (first > 0 && column - first < SPILL_REACH && empty(first - 1)) first--;
    }
    let before = lefts[column] - lefts[first];
    let after = lefts[last + 1] - lefts[column + 1];
    if (style.h === 'center' || style.h === 'centerContinuous') before = after = Math.min(before, after);
    if (before > 0) span.style.left = `${-before}px`;
    if (after > 0) span.style.right = `${-after}px`;
  }

  // Whether cells from `row` and `column` to `bottom` and `right` are in a
  // row or column the comparison marks.
  function changedIn(side, row, column, bottom, right) {
    for (let r = row; r <= bottom; r++) if (side.rowMarks.has(r)) return true;
    for (let c = column; c <= right; c++) if (side.colMarks.has(c)) return true;
    return false;
  }

  // A cell, or merged cells from it to `bottom` and `right`.
  function cellElement(side, row, column, near, bottom = row, right = column) {
    const { tops, lefts } = side;
    const number = styleAt(side, row, column);
    const style = side.styles[number] ?? side.styles[0];
    const el = element(`ss-c ${side.prefix}-${number}`);
    if (!changedIn(side, row, column, bottom, right)) el.classList.add('ss-same');
    const top = tops[row];
    const left = lefts[column];
    el.style.cssText = `top:${top}px;left:${left}px;width:${lefts[right + 1] - left}px;height:${tops[bottom + 1] - top}px`;
    const text = textAt(side, row, column);
    if (text !== '') {
      const span = document.createElement('span');
      span.className = 'ss-t';
      span.textContent = text;
      if (bottom === row && right === column) spill(side, row, column, style, span, near);
      el.append(span);
    }
    if (bottom !== row || right !== column) {
      // Merged cells take their right and bottom borders from the cells
      // along those edges.
      el.classList.add('ss-merged');
      const edges = {
        left: style.border?.left,
        top: style.border?.top,
        right: side.styles[styleAt(side, row, right)]?.border?.right,
        bottom: side.styles[styleAt(side, bottom, column)]?.border?.bottom,
      };
      const borders = EDGES.filter((edge) => edges[edge]);
      if (borders.length > 0) {
        const frame = document.createElement('i');
        frame.className = 'ss-frame';
        for (const edge of borders) {
          const [kind, width, color] = edges[edge];
          frame.style.setProperty(`border-${edge}`, `${Number(width) || 1}px ${kind} ${cssColor(color) || '#000000'}`);
        }
        el.append(frame);
      }
    }
    return el;
  }

  function renderCells(side, view) {
    const { tops, lefts } = side;
    const cells = [];
    // Merged cells in the rows on show, and near enough to stop text that
    // spills.
    const near = side.merges.filter(
      ([top, left, bottom, right]) =>
        top < view.lastRow && bottom >= view.firstRow && left < view.lastColumn + SPILL_REACH && right >= view.firstColumn - SPILL_REACH
    );
    const covered = new Set();
    for (const [top, left, bottom, right] of near) {
      if (left >= view.lastColumn || right < view.firstColumn) continue;
      for (let r = Math.max(top, view.firstRow); r <= Math.min(bottom, view.lastRow - 1); r++) {
        for (let c = Math.max(left, view.firstColumn); c <= Math.min(right, view.lastColumn - 1); c++) covered.add(`${r}:${c}`);
      }
      if (tops[bottom + 1] > tops[top] && lefts[right + 1] > lefts[left]) cells.push(cellElement(side, top, left, near, bottom, right));
    }
    for (let r = view.firstRow; r < view.lastRow; r++) {
      if (sizeOf(tops, r) <= 0) continue;
      for (let c = view.firstColumn; c < view.lastColumn; c++) {
        if (sizeOf(lefts, c) <= 0 || covered.has(`${r}:${c}`)) continue;
        cells.push(cellElement(side, r, c, near));
      }
      // Text from beyond the columns on show that spills into them.
      for (let c = view.firstColumn - 1; c >= Math.max(0, view.firstColumn - SPILL_REACH); c--) {
        if (textAt(side, r, c) === '') continue;
        const style = side.styles[styleAt(side, r, c)];
        if (style && canSpill(style) && spillsRight(style) && !mergeAt(near, r, c) && sizeOf(lefts, c) > 0) cells.push(cellElement(side, r, c, near));
        break;
      }
      for (let c = view.lastColumn; c < Math.min(lefts.length - 1, view.lastColumn + SPILL_REACH); c++) {
        if (textAt(side, r, c) === '') continue;
        const style = side.styles[styleAt(side, r, c)];
        if (style && canSpill(style) && spillsLeft(style) && !mergeAt(near, r, c) && sizeOf(lefts, c) > 0) cells.push(cellElement(side, r, c, near));
        break;
      }
    }
    side.grid.replaceChildren(...cells);
  }

  function renderHeads(side, view) {
    const { tops, lefts } = side;
    const numbers = [];
    for (let r = view.firstRow; r < view.lastRow; r++) {
      const height = sizeOf(tops, r);
      if (height <= 0) continue;
      const el = element('ss-h', String(r + 1));
      el.style.cssText = `top:${tops[r]}px;height:${height}px`;
      if (side.rowMarks.has(r)) el.classList.add('marked');
      numbers.push(el);
    }
    side.rowHead.replaceChildren(...numbers);
    const letters = [];
    for (let c = view.firstColumn; c < view.lastColumn; c++) {
      const width = sizeOf(lefts, c);
      if (width <= 0) continue;
      const el = element('ss-h', TableText.columnName(c));
      el.style.cssText = `left:${lefts[c]}px;width:${width}px`;
      if (side.colMarks.has(c)) el.classList.add('marked');
      letters.push(el);
    }
    side.colHead.replaceChildren(...letters);
  }

  // Where a cell is on its sheet, merged cells and all.
  function cellBox(side, row, column) {
    const { tops, lefts } = side;
    const [top, left, bottom, right] = mergeAt(side.merges, row, column) ?? [row, column, row, column];
    return { top: tops[top], left: lefts[left], width: lefts[right + 1] - lefts[left], height: tops[bottom + 1] - tops[top] };
  }

  function mark(className, { top, left, width, height }) {
    const el = element(`ss-mk ${className}`);
    el.style.cssText = `top:${top}px;left:${left}px;width:${width}px;height:${height}px`;
    return el;
  }

  // The rows of a run of differences on a side: { first, last }, or, when
  // the side has none of them, { anchor }, the row they'd go before.
  function blockOn(side, block) {
    const { start, end } = blocks[block];
    let first = -1;
    let last = -1;
    for (let i = start; i < end; i++) {
      const index = diff.rows[i][side.name];
      if (index < 0) continue;
      if (first < 0) first = index;
      last = index;
    }
    if (first >= 0) return { first, last };
    for (let i = end; i < diff.rows.length; i++) {
      if (diff.rows[i][side.name] >= 0) return { anchor: diff.rows[i][side.name] };
    }
    for (let i = start - 1; i >= 0; i--) {
      if (diff.rows[i][side.name] >= 0) return { anchor: diff.rows[i][side.name] + 1 };
    }
    return { anchor: 0 };
  }

  // Tints the rows, columns and cells that differ and those Find found,
  // blended into the cells beneath; outlines the changed cells, the match
  // gone to and the run of differences gone to last on top, where they
  // show on any fill.
  function renderMarks(side, view) {
    if (!view) return;
    const { tops, lefts } = side;
    const width = lefts[lefts.length - 1];
    const tints = [];
    const rings = [];
    for (let r = view.firstRow; r < view.lastRow; r++) {
      const type = side.rowMarks.get(r);
      const height = sizeOf(tops, r);
      if (!type || height <= 0) continue;
      tints.push(mark(`row ${type}`, { top: tops[r], left: 0, width, height }));
      for (const column of side.cellMarks.get(r) ?? []) {
        if (column < view.firstColumn - 1 || column > view.lastColumn) continue;
        const box = cellBox(side, r, column);
        tints.push(mark('cell', box));
        rings.push(mark('cell', box));
      }
    }
    for (const column of side.colMarks) {
      if (column < view.firstColumn || column >= view.lastColumn || sizeOf(lefts, column) <= 0) continue;
      const top = tops[view.firstRow];
      tints.push(mark('col', { top, left: lefts[column], width: sizeOf(lefts, column), height: tops[view.lastRow] - top }));
    }
    const match = matches[currentMatch];
    for (let r = view.firstRow; r < view.lastRow; r++) {
      for (const column of side.found.get(r) ?? []) {
        if (column < view.firstColumn - 1 || column > view.lastColumn) continue;
        const box = cellBox(side, r, column);
        const isCurrent = match && match.side === side.name && match.row === r && match.column === column;
        tints.push(mark(isCurrent ? 'found current' : 'found', box));
        if (isCurrent) rings.push(mark('found', box));
      }
    }
    if (current >= 0) {
      const { first, last, anchor } = blockOn(side, current);
      if (first !== undefined) {
        rings.push(mark('block', { top: tops[first], left: 0, width, height: tops[last + 1] - tops[first] }));
      } else {
        const at = tops[Math.min(anchor, tops.length - 1)];
        rings.push(mark('block caret', { top: at - 1, left: 0, width, height: 2 }));
      }
    }
    side.marks.replaceChildren(...tints);
    side.rings.replaceChildren(...rings);
  }

  // Brings the DOM of a side in line with its scroll position: a no-op
  // while the rows and columns in view are already there, unless `force`
  // is set.
  function render(side, force = false) {
    if (!side.sheet || !side.grid || root.hidden) return;
    const { scroller, tops, lefts } = side;
    const rows = tops.length - 1;
    const columns = lefts.length - 1;
    const y = scroller.scrollTop / zoom - PAGE_GAP - HEAD;
    const x = scroller.scrollLeft / zoom - PAGE_GAP - side.gutter;
    const firstRow = indexAt(tops, y);
    const lastRow = Math.min(rows, indexAt(tops, y + scroller.clientHeight / zoom) + 1);
    const firstColumn = indexAt(lefts, x);
    const lastColumn = Math.min(columns, indexAt(lefts, x + scroller.clientWidth / zoom) + 1);
    const was = side.rendered;
    const inView =
      was && firstRow >= was.firstRow && lastRow <= was.lastRow && firstColumn >= was.firstColumn && lastColumn <= was.lastColumn;
    if (inView && !force) return;
    const view = {
      firstRow: Math.max(0, firstRow - ROW_OVERSCAN),
      lastRow: Math.min(rows, lastRow + ROW_OVERSCAN),
      firstColumn: Math.max(0, firstColumn - COLUMN_OVERSCAN),
      lastColumn: Math.min(columns, lastColumn + COLUMN_OVERSCAN),
    };
    side.rendered = view;
    renderCells(side, view);
    renderHeads(side, view);
    renderMarks(side, view);
  }

  const renderAll = (force) => SIDES.forEach((name) => render(sides[name], force));

  function scrollSide(side, top, left = side.scroller.scrollLeft) {
    const { scroller } = side;
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
    side.expected = { top: scroller.scrollTop, left: scroller.scrollLeft };
  }

  // Positions on the two sheets that go together, as unzoomed distances
  // from the top or left of the content: rows that are in both, and
  // columns. Each side's list only ever goes down.
  function buildSyncTable() {
    const { left, right } = sides;
    const table = (pairs, leftEnd, rightEnd) => {
      const out = { left: [0], right: [0] };
      const stride = Math.max(1, Math.ceil(pairs.length / MAX_SYNC_POINTS));
      for (let i = 0; i < pairs.length; i += stride) {
        const [a, b] = pairs[i];
        if (a < out.left[out.left.length - 1] || b < out.right[out.right.length - 1]) continue;
        out.left.push(a);
        out.right.push(b);
      }
      out.left.push(Math.max(out.left[out.left.length - 1], leftEnd));
      out.right.push(Math.max(out.right[out.right.length - 1], rightEnd));
      return out;
    };
    const rowPairs = [];
    const columnPairs = [];
    if (left.sheet && right.sheet) {
      for (const row of diff.rows) {
        if (row.left >= 0 && row.right >= 0) rowPairs.push([PAGE_GAP + HEAD + left.tops[row.left], PAGE_GAP + HEAD + right.tops[row.right]]);
      }
      for (const column of diff.columns) {
        if (column.left >= 0 && column.right >= 0) {
          columnPairs.push([PAGE_GAP + left.gutter + left.lefts[column.left], PAGE_GAP + right.gutter + right.lefts[column.right]]);
        }
      }
    }
    const end = (side, edges, head) => 2 * PAGE_GAP + head + edges[edges.length - 1];
    return {
      y: table(rowPairs, end(left, left.tops, HEAD), end(right, right.tops, HEAD)),
      x: table(columnPairs, end(left, left.lefts, left.gutter), end(right, right.lefts, right.gutter)),
    };
  }

  // The position on side `to` that goes with `at` on side `from`.
  function map(table, from, to, at) {
    const a = table[from.name];
    const b = table[to.name];
    let low = 0;
    let high = a.length - 1;
    while (low < high - 1) {
      const mid = (low + high) >>> 1;
      if (a[mid] <= at) low = mid;
      else high = mid;
    }
    const span = a[high] - a[low];
    const t = span > 0 ? Math.min(1, Math.max(0, (at - a[low]) / span)) : 0;
    return b[low] + t * (b[high] - b[low]);
  }

  // Brings the other side to the rows that go with those in the middle of
  // this one, and to the columns that go with those at its left.
  function follow(side) {
    const to = other(side);
    if (!syncOn || !side.sheet || !to.sheet) return;
    syncTable ??= buildSyncTable();
    const { scroller } = side;
    const middle = (scroller.scrollTop + scroller.clientHeight / 2) / zoom;
    const top = map(syncTable.y, side, to, middle) * zoom - to.scroller.clientHeight / 2;
    const left = scroller.scrollLeft > 0 ? map(syncTable.x, side, to, scroller.scrollLeft / zoom) * zoom : 0;
    scrollSide(to, top, left);
  }

  function onScroll(side) {
    render(side);
    const { scroller, expected } = side;
    side.expected = null;
    if (expected && Math.abs(scroller.scrollTop - expected.top) < 2 && Math.abs(scroller.scrollLeft - expected.left) < 2) {
      return;
    }
    follow(side);
  }

  // Scrolls a side so that a cell is in view, clear of the row numbers and
  // column letters: `at` of the way down when it isn't.
  function revealCell(side, row, column, at) {
    const { scroller } = side;
    const box = cellBox(side, row, Math.max(0, column ?? 0));
    const top = (PAGE_GAP + HEAD + box.top) * zoom;
    const bottom = top + box.height * zoom;
    let y = scroller.scrollTop;
    if (top < y + HEAD * zoom + 8 || bottom > y + scroller.clientHeight - 88) y = top - scroller.clientHeight * at;
    let x = scroller.scrollLeft;
    if (column !== undefined) {
      const left = (PAGE_GAP + side.gutter + box.left) * zoom;
      const right = left + box.width * zoom;
      if (left < x + side.gutter * zoom || right > x + scroller.clientWidth) {
        x = Math.min(left - side.gutter * zoom - 24, right - scroller.clientWidth + 24);
        if (left - x < side.gutter * zoom) x = left - side.gutter * zoom - 24;
      }
    }
    scrollSide(side, y, x);
  }

  function renderZoom() {
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    zoomLabel.setAttribute('aria-pressed', String(zoom === 1));
    zoomLabel.title = 'Back to 100%';
    syncButton.title = 'Scroll both sheets together';
    syncButton.setAttribute('aria-pressed', String(syncOn));
  }

  function setZoom(value) {
    value = clampZoom(value);
    if (Math.abs(value - zoom) < 0.001) {
      renderZoom();
      return;
    }
    // What's in the middle of each side stays there.
    const ratio = value / zoom;
    const middles = SIDES.map((name) => {
      const { scroller } = sides[name];
      return [scroller.scrollTop + scroller.clientHeight / 2, scroller.scrollLeft + scroller.clientWidth / 2];
    });
    zoom = value;
    root.style.setProperty('--doc-zoom', String(zoom));
    SIDES.forEach((name, i) => {
      const { scroller } = sides[name];
      scrollSide(sides[name], middles[i][0] * ratio - scroller.clientHeight / 2, middles[i][1] * ratio - scroller.clientWidth / 2);
    });
    renderZoom();
    renderAll(true);
  }

  function stepZoom(direction) {
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? MAX_ZOOM)
        : (ZOOM_STEPS.findLast((step) => step < zoom - 0.001) ?? MIN_ZOOM);
    setZoom(next);
  }

  // Shows a pair of sheets: `inputs` has, per side, the `sheet` and its
  // `look`, either of which may be null. `nextDiff` is the entry of
  // TableDiff.compare() for them. With `keep` a sheet that was on show
  // already stays where it is scrolled to.
  function show(inputs, nextDiff, keep = false) {
    diff = nextDiff;
    current = -1;
    matches = [];
    currentMatch = -1;
    syncTable = null;
    blocks = [];
    let previousType = 'equal';
    diff.rows.forEach((row, index) => {
      if (row.type !== 'equal') {
        if (previousType === 'equal') blocks.push({ start: index, end: index + 1 });
        else blocks[blocks.length - 1].end = index + 1;
      }
      previousType = row.type;
    });
    for (const name of SIDES) {
      const side = sides[name];
      const { sheet, look } = inputs[name];
      const stays = keep && sheet && side.sheet === sheet;
      const at = stays ? [side.scroller.scrollTop, side.scroller.scrollLeft] : [0, 0];
      Object.assign(side, { sheet, look: sheet ? look : null, values: sheet?.rows ?? [], found: new Map(), rendered: null });
      side.styles = side.look?.styles ?? PLAIN_STYLES;
      side.prefix = classesFor(side.styles);
      markChanges(side);
      if (!sheet) {
        side.grid = null;
        side.pagesEl.replaceChildren();
        setStatus(side, 'note', name === 'left' ? 'Not in the original' : 'Not in the changed spreadsheet');
        continue;
      }
      setStatus(side, null);
      layOut(side);
      build(side);
      scrollSide(side, ...at);
    }
    dropStyleSheets(SIDES.map((name) => sides[name].styles));
    renderAll(true);
  }

  function goTo(block) {
    current = block;
    for (const name of SIDES) {
      const side = sides[name];
      if (!side.sheet) continue;
      const { first, anchor } = blockOn(side, block);
      const row = first ?? Math.min(anchor, side.tops.length - 2);
      // Sideways to the first cell that differs, if it's out of sight.
      const column = first !== undefined ? side.cellMarks.get(first)?.[0] : undefined;
      revealCell(side, Math.max(0, row), column, REVEAL_AT);
      // The whole run in view, as far as it fits.
      render(side, true);
    }
  }

  // Looks for `text`, whatever its case, in the cells of both sheets and
  // returns how many cells have it.
  function search(text) {
    query = text ? text.toLowerCase() : '';
    matches = [];
    currentMatch = -1;
    for (const name of SIDES) {
      const side = sides[name];
      side.found = new Map();
      if (!query || !side.sheet) continue;
      for (let r = 0; r < side.values.length && matches.length < MAX_MATCHES; r++) {
        side.values[r].forEach((cell, c) => {
          if (!cell || !cell.toLowerCase().includes(query) || matches.length >= MAX_MATCHES) return;
          matches.push({ side: name, row: r, column: c });
          if (!side.found.has(r)) side.found.set(r, []);
          side.found.get(r).push(c);
        });
      }
    }
    for (const name of SIDES) renderMarks(sides[name], sides[name].rendered);
    return matches.length;
  }

  function goToMatch(index) {
    currentMatch = index;
    const match = matches[index];
    if (match) {
      const side = sides[match.side];
      revealCell(side, match.row, match.column, 0.4);
      follow(side);
      render(side);
    }
    for (const name of SIDES) renderMarks(sides[name], sides[name].rendered);
  }

  const searchState = () => ({ index: currentMatch, count: matches.length });

  // Fades the rows without a change, or brings them back.
  const setFade = (on) => root.classList.toggle('fade-same', on);

  function clear() {
    diff = null;
    blocks = [];
    current = -1;
    query = '';
    matches = [];
    currentMatch = -1;
    syncTable = null;
    for (const name of SIDES) {
      const side = sides[name];
      Object.assign(side, { sheet: null, look: null, values: [], grid: null, rendered: null, found: new Map() });
      side.rowMarks = new Map();
      side.cellMarks = new Map();
      side.colMarks = new Set();
      side.pagesEl.replaceChildren();
      setStatus(side, null);
    }
    dropStyleSheets([]);
  }

  for (const name of SIDES) {
    const side = sides[name];
    side.scroller.addEventListener('scroll', () => onScroll(side), { passive: true });
  }

  root.querySelector('.doc-zoom-in').addEventListener('click', () => stepZoom(1));
  root.querySelector('.doc-zoom-out').addEventListener('click', () => stepZoom(-1));
  zoomLabel.addEventListener('click', () => setZoom(1));
  syncButton.addEventListener('click', () => {
    syncOn = !syncOn;
    try {
      localStorage.setItem('sheetScrollTogether', syncOn ? 'on' : 'off');
    } catch {
      // Remembering it is a convenience only.
    }
    renderZoom();
    // Lines the right side up with the left straight away.
    if (syncOn) follow(sides.left);
  });

  new ResizeObserver(() => {
    if (root.hidden || root.clientWidth === 0) return;
    renderAll(true);
  }).observe(root);

  renderZoom();

  return {
    show,
    clear,
    goTo,
    search,
    goToMatch,
    searchState,
    setFade,
    // Zooms a step in (1) or out (-1), as Ctrl and the mouse wheel do.
    zoomStep: stepZoom,
  };
}
