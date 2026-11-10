// The side-by-side grid for two spreadsheets, built in a .table-view element.
// Only the rows and columns in view are in the DOM, so large sheets stay
// fast. Both sides share one vertical scroller and one horizontal offset,
// which keeps them in step.
function createTableView(root) {
  // Must match --grid-row in styles.css.
  const ROW_HEIGHT = 28;
  // Space below the last row, so the navigator never covers it.
  const TAIL = 84;
  const ROW_OVERSCAN = 20;
  const COLUMN_OVERSCAN = 3;
  const MIN_COLUMN = 56;
  const MAX_COLUMN = 340;
  // Horizontal padding and border of a cell.
  const CELL_CHROME = 22;
  // Column widths come from every cell of the first rows and, further down,
  // from the longest text of each column only.
  const MEASURED_ROWS = 200;
  // Cells with more text than this are likely cut off and get a tooltip.
  const TOOLTIP_LENGTH = 24;
  const NUMERIC = /^[-+]?\d[\d.,'’ ]*%?$/;
  const SIDES = ['left', 'right'];

  const scroller = root.querySelector('.grid-scroll');
  const rowsEl = root.querySelector('.grid-rows');
  const windowEl = root.querySelector('.grid-window');
  const barsEl = root.querySelector('.grid-bars');
  const bars = [...barsEl.children];
  const headStrips = [...root.querySelectorAll('.grid-head .grid-strip')];
  // Both sides show the same width of cells; this is the left one.
  const viewport = root.querySelector('.grid-head .grid-cells');
  const ruler = document.createElement('canvas').getContext('2d');

  // One entry of TableDiff.compare().
  let diff = null;
  let onlyDifferences = false;
  // Indexes into diff.rows of the rows on show.
  let display = [];
  // Per run of differing rows: its first row, and that row's place among the
  // differing rows alone.
  let blocks = [];
  let currentBlock = -1;
  let widths = [];
  // Left edge of every column, then the total width.
  let offsets = [0];
  let scrollX = 0;
  // The rows and columns in the DOM.
  let rendered = null;
  // Find: what is looked for, the cells on show that have it as
  // [{ position, row, column, side }], those cells again by key, and the
  // match gone to last.
  let query = null;
  let matches = [];
  let found = new Set();
  let currentMatch = -1;
  // More matches than this aren't worth counting one by one.
  const MAX_MATCHES = 100000;

  function element(className, text) {
    const el = document.createElement('div');
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function measureColumns() {
    const style = getComputedStyle(root);
    ruler.font = `${style.fontSize} ${style.fontFamily}`;
    const measure = (text) => ruler.measureText(text.slice(0, 200)).width;
    widths = diff.columns.map((column) => {
      let widest = 0;
      for (const side of SIDES) {
        if (column[side] < 0) continue;
        const { rows } = diff[side];
        let longest = '';
        for (let r = 0; r < rows.length; r++) {
          const text = rows[r][column[side]] ?? '';
          if (r < MEASURED_ROWS) widest = Math.max(widest, measure(text));
          else if (text.length > longest.length) longest = text;
        }
        widest = Math.max(widest, measure(longest));
      }
      return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, Math.ceil(widest) + CELL_CHROME));
    });
    offsets = [0];
    for (const width of widths) offsets.push(offsets[offsets.length - 1] + width);
  }

  function headCells(side) {
    const other = side === 'left' ? 'right' : 'left';
    const cells = [];
    for (let c = rendered.firstColumn; c < rendered.lastColumn; c++) {
      const column = diff.columns[c];
      if (column[side] < 0) {
        cells.push(element('grid-cell filler'));
      } else {
        const cell = element('grid-cell', TableText.columnName(column[side]));
        if (column[other] < 0) cell.classList.add('only');
        cells.push(cell);
      }
    }
    return cells;
  }

  function buildSide(row, side) {
    const half = element(`grid-half ${side === 'left' ? 'l' : 'r'}`);
    if (row[side] < 0) {
      half.classList.add('filler');
      return half;
    }
    const values = diff[side].rows[row[side]];
    const other = side === 'left' ? 'right' : 'left';
    const strip = element('grid-strip');
    for (let c = rendered.firstColumn; c < rendered.lastColumn; c++) {
      const column = diff.columns[c][side];
      if (column < 0) {
        strip.append(element('grid-cell filler'));
        continue;
      }
      const text = values[column] ?? '';
      const cell = element('grid-cell', text);
      if (NUMERIC.test(text)) cell.classList.add('numeric');
      if (row.cells.includes(c)) cell.classList.add('hl');
      const key = `${row.index}:${c}:${side}`;
      if (found.has(key)) {
        const match = matches[currentMatch];
        const current = match && match.row === row.index && match.column === c && match.side === side;
        cell.classList.add(current ? 'found-current' : 'found');
      }
      // A row without a counterpart is tinted as a whole already.
      if (diff.columns[c][other] < 0 && row[other] >= 0) cell.classList.add('only');
      if (text.length > TOOLTIP_LENGTH) cell.title = text;
      strip.append(cell);
    }
    const cells = element('grid-cells');
    cells.append(strip);
    half.append(element('grid-num', row[side] + 1), cells);
    return half;
  }

  function buildRow(index) {
    const row = { ...diff.rows[index], index };
    const rowEl = element(`grid-row ${row.type}`);
    if (currentBlock >= 0 && blocks[currentBlock].row === index) rowEl.classList.add('current');
    rowEl.append(buildSide(row, 'left'), buildSide(row, 'right'));
    return rowEl;
  }

  // Brings the DOM in line with the scroll position; a no-op while the rows
  // and columns in view are already there, unless `force` is set.
  function render(force) {
    if (!diff) return;
    const top = scroller.scrollTop;
    const firstRow = Math.min(display.length, Math.floor(top / ROW_HEIGHT));
    const lastRow = Math.min(display.length, Math.ceil((top + scroller.clientHeight) / ROW_HEIGHT));
    const right = scrollX + viewport.clientWidth;
    let firstColumn = 0;
    while (firstColumn < widths.length && offsets[firstColumn + 1] <= scrollX) firstColumn++;
    let lastColumn = firstColumn;
    while (lastColumn < widths.length && offsets[lastColumn] < right) lastColumn++;

    const inView =
      rendered &&
      firstRow >= rendered.firstRow &&
      lastRow <= rendered.lastRow &&
      firstColumn >= rendered.firstColumn &&
      lastColumn <= rendered.lastColumn;
    if (inView && !force) return;

    rendered = {
      firstRow: Math.max(0, firstRow - ROW_OVERSCAN),
      lastRow: Math.min(display.length, lastRow + ROW_OVERSCAN),
      firstColumn: Math.max(0, firstColumn - COLUMN_OVERSCAN),
      lastColumn: Math.min(widths.length, lastColumn + COLUMN_OVERSCAN),
    };
    const columns = widths.slice(rendered.firstColumn, rendered.lastColumn).map((width) => `${width}px`);
    root.style.setProperty('--columns', columns.join(' ') || 'none');
    root.style.setProperty('--strip-start', `${offsets[rendered.firstColumn]}px`);
    SIDES.forEach((side, i) => headStrips[i].replaceChildren(...headCells(side)));

    const rows = [];
    for (let i = rendered.firstRow; i < rendered.lastRow; i++) rows.push(buildRow(display[i]));
    windowEl.style.top = `${rendered.firstRow * ROW_HEIGHT}px`;
    windowEl.replaceChildren(...rows);
  }

  function setScrollX(value) {
    const max = Math.max(0, offsets[offsets.length - 1] - viewport.clientWidth);
    scrollX = Math.max(0, Math.min(value, max));
    root.style.setProperty('--x', `${scrollX}px`);
    for (const bar of bars) {
      if (Math.abs(bar.scrollLeft - scrollX) >= 1) bar.scrollLeft = scrollX;
    }
    render(false);
  }

  // Adapts to the space available: shows the horizontal scrollbars only when
  // the columns don't fit.
  function fit() {
    barsEl.hidden = offsets[offsets.length - 1] <= viewport.clientWidth;
    setScrollX(scrollX);
  }

  // Looks for the query in the cells of the rows on show, both sides of a
  // row in turn.
  function findMatches() {
    matches = [];
    found = new Set();
    currentMatch = -1;
    if (!diff || !query) return;
    for (let position = 0; position < display.length && matches.length < MAX_MATCHES; position++) {
      const index = display[position];
      const row = diff.rows[index];
      for (const side of SIDES) {
        if (row[side] < 0) continue;
        const values = diff[side].rows[row[side]];
        diff.columns.forEach((column, c) => {
          const text = column[side] < 0 ? '' : values[column[side]];
          if (!text || !text.toLowerCase().includes(query)) return;
          matches.push({ position, row: index, column: c, side });
          found.add(`${index}:${c}:${side}`);
        });
      }
    }
  }

  // The row at the top of the view, by its place in diff.rows, and how far
  // it is scrolled past. Null when no rows are on show.
  function topRow() {
    if (!diff || display.length === 0) return null;
    const position = Math.min(display.length - 1, Math.floor(scroller.scrollTop / ROW_HEIGHT));
    return { row: display[position], offset: scroller.scrollTop - position * ROW_HEIGHT };
  }

  // Lists the rows to show and starts over at the top or, with `top` (as
  // topRow() gives it), at that row or the next one on show.
  function list(top) {
    display = [];
    diff.rows.forEach((row, index) => {
      if (!onlyDifferences || row.type !== 'equal') display.push(index);
    });
    findMatches();
    rowsEl.style.height = `${display.length * ROW_HEIGHT + TAIL}px`;
    let position = top ? display.findIndex((index) => index >= top.row) : 0;
    if (position < 0) position = display.length;
    scroller.scrollTop = top ? position * ROW_HEIGHT + top.offset : 0;
    rendered = null;
    fit();
  }

  // Scrolls the row at `position` among those on show to the middle, and
  // sideways to `column` when there is one.
  function revealCell(position, column) {
    scroller.scrollTop = position * ROW_HEIGHT - (scroller.clientHeight - ROW_HEIGHT) / 2;
    if (column === undefined) return;
    const width = viewport.clientWidth;
    if (offsets[column] < scrollX || offsets[column + 1] > scrollX + width) {
      setScrollX(Math.min(offsets[column], Math.max(0, offsets[column + 1] - width + 48)));
    }
  }

  // Scrolls to the first row of a run of differences, and sideways to the
  // first cell that differs in it.
  function reveal(block) {
    revealCell(onlyDifferences ? block.position : block.row, diff.rows[block.row].cells[0]);
  }

  // Shows one entry of TableDiff.compare() and returns its number of runs of
  // differing rows. The view has to be visible. With `keep` it is the sheets
  // on show compared again, with other options: the row at the top stays
  // there, and the difference gone to stays the current one.
  function show(nextDiff, only, keep = false) {
    const top = keep ? topRow() : null;
    const wasAt = keep && currentBlock >= 0 ? diff.rows[blocks[currentBlock].row] : null;
    if (top) top.row = DiffEngine.sameRow(nextDiff.rows, diff.rows[top.row]);
    diff = nextDiff;
    onlyDifferences = only;
    blocks = [];
    let differing = 0;
    let previousType = 'equal';
    diff.rows.forEach((row, index) => {
      if (row.type !== 'equal') {
        if (previousType === 'equal') blocks.push({ row: index, position: differing });
        differing++;
      }
      previousType = row.type;
    });
    // Seven-digit row numbers need more room than the usual gutter.
    const lastRow = Math.max(diff.left?.rows.length ?? 0, diff.right?.rows.length ?? 0);
    root.style.setProperty('--grid-gutter', `${Math.max(52, 22 + String(lastRow).length * 8)}px`);
    measureColumns();
    for (const bar of bars) bar.firstElementChild.style.width = `${offsets[offsets.length - 1]}px`;
    currentBlock = DiffEngine.runAt(
      blocks.map((block) => block.row),
      DiffEngine.sameRow(diff.rows, wasAt)
    );
    if (!top) scrollX = 0;
    list(top && top.row >= 0 ? top : null);
    return blocks.length;
  }

  // The difference gone to stays in view; without one, the row at the top
  // stays there.
  function setOnlyDifferences(only) {
    if (only === onlyDifferences) return;
    const top = topRow();
    onlyDifferences = only;
    if (!diff) return;
    if (currentBlock >= 0) {
      list();
      reveal(blocks[currentBlock]);
    } else {
      list(top);
    }
  }

  function goTo(block) {
    currentBlock = block;
    reveal(blocks[block]);
    render(true);
  }

  // Takes note of the run gone to while the view is out of sight.
  function mark(block) {
    currentBlock = block;
  }

  // Marks the cells that contain `text`, whatever its case, and returns how
  // many there are. Empty text marks none.
  function search(text) {
    query = text ? text.toLowerCase() : null;
    findMatches();
    render(true);
    return matches.length;
  }

  // Goes to the match with this index.
  function goToMatch(index) {
    currentMatch = index;
    const match = matches[index];
    revealCell(match.position, match.column);
    render(true);
  }

  const searchState = () => ({ index: currentMatch, count: matches.length });

  function clear() {
    diff = null;
    matches = [];
    found = new Set();
    currentMatch = -1;
    windowEl.replaceChildren();
    for (const strip of headStrips) strip.replaceChildren();
  }

  scroller.addEventListener('scroll', () => render(false));
  new ResizeObserver(() => {
    // Without a width the view is out of sight and there is nothing to fit.
    if (diff && scroller.clientWidth > 0) fit();
  }).observe(scroller);

  for (const bar of bars) {
    bar.addEventListener('scroll', () => {
      if (Math.abs(bar.scrollLeft - scrollX) >= 1) setScrollX(bar.scrollLeft);
    });
  }

  // Sideways wheel and trackpad movement, or the wheel with Shift held.
  root.addEventListener(
    'wheel',
    (event) => {
      let { deltaX, deltaY } = event;
      if (event.shiftKey && deltaX === 0) [deltaX, deltaY] = [deltaY, 0];
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
      event.preventDefault();
      setScrollX(scrollX + deltaX);
    },
    { passive: false }
  );

  return {
    show,
    setOnlyDifferences,
    goTo,
    mark,
    clear,
    search,
    goToMatch,
    searchState,
    // The run of differing rows gone to last, or -1.
    get currentBlock() {
      return currentBlock;
    },
  };
}
