const $ = (selector) => document.querySelector(selector);

const compareBtn = $('#compare-btn');
const compareLabel = $('#compare-label');
const compareIcon = $('#compare-icon');
const findBtn = $('#find-btn');
const exportBtn = $('#export-btn');
const exportMenu = $('#export-menu');
const findBar = $('#find-bar');
const findInput = $('#find-input');
const findCount = $('#find-count');
const messageEl = $('#message');
const optCase = $('#opt-case');
const optSpace = $('#opt-space');
const optOnly = $('#opt-only');
const optOnlySwitch = $('#opt-only-switch');
const viewSwitch = $('#view-switch');
const viewButtons = [...viewSwitch.querySelectorAll('button')];
const themeButtons = [...document.querySelectorAll('#theme-switch button')];
const sidebarItems = [...document.querySelectorAll('.sidebar-item')];
const sidebarToggle = $('#sidebar-toggle');
// The controls for comparing texts and tables; files have no use for them.
const compareControls = [compareBtn, $('#swap-btn'), $('.switches')];

const SIDES = ['left', 'right'];
// Unchanged lines kept around each change when only the differences are on
// show.
const CONTEXT = 3;
// The checksums of the files workspace, by the names they are shown with.
const CHECKSUMS = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' };
// Which checksum a number of hex digits is.
const CHECKSUM_LENGTHS = { 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' };
// Files Explorer hands over that belong with the spreadsheets.
const SHEET_FILE = /\.(xlsx|xlsm|xlsb|xls|ods|fods|csv|tsv|tab)$/i;

// What sets the workspaces apart. Documents are compared as text, line by
// line; spreadsheets as tables, cell by cell; files of any kind by their
// checksums.
const KINDS = {
  docs: {
    label: 'Documents',
    icon: '#i-file',
    paste: { left: 'Paste the original text', right: 'Paste the changed text' },
    drop: 'or drop a file here — text, Word or PDF',
    edit: 'Edit texts',
    // The two ways to show compared documents, and the value each is
    // remembered by under `key`.
    views: {
      key: 'view',
      plain: { value: 'text', label: 'Text', icon: '#i-lines', title: 'Text: the lines of both, side by side' },
      look: {
        value: 'document',
        label: 'Document',
        icon: '#i-page',
        title: 'Document: the files as they look, pages and all',
        missing: 'Document: open a Word file or PDF to see it as it looks',
        whole: 'Differences only: the Document view always shows the whole documents',
      },
    },
  },
  sheets: {
    label: 'Spreadsheets',
    icon: '#i-table',
    paste: { left: 'Paste the original cells', right: 'Paste the changed cells' },
    drop: 'or drop a file here — Excel, OpenDocument or CSV',
    edit: 'Edit tables',
    views: {
      key: 'sheetView',
      plain: { value: 'table', label: 'Table', icon: '#i-rows', title: 'Table: the rows of both lined up, side by side' },
      look: {
        value: 'sheet',
        label: 'Sheet',
        icon: '#i-table',
        title: 'Sheet: the spreadsheets as they look, formatting and all',
        missing: 'Sheet: open an Excel or OpenDocument spreadsheet to see it as it looks',
        whole: 'Differences only: the Sheet view always shows the whole sheets',
      },
    },
  },
  files: {
    label: 'Files',
    titles: { left: 'File A', right: 'File B' },
    hint: { left: 'Drop the first file here', right: 'Drop the second file here' },
    drop: 'or use Open file — any kind of file. One is enough to check it against a published checksum.',
  },
};

const MESSAGE_ICONS = { error: '#i-alert', info: '#i-info', success: '#i-check' };
let messageTimer;

// How compared documents and spreadsheets are shown: as lines of text or a
// table ('plain'), or as they look ('look') when there's a Word file, PDF or
// workbook to show. Remembered from one start to the next.
const preferredView = { docs: 'plain', sheets: 'plain' };
for (const kind of Object.keys(preferredView)) {
  try {
    const { key, look } = KINDS[kind].views;
    if (localStorage.getItem(key) === look.value) preferredView[kind] = 'look';
  } catch {
    // No storage: start with the text or the table.
  }
}

// `kind` is error, info or success.
function showMessage(text, kind = 'error', duration = 6000) {
  messageEl.querySelector('span').textContent = text;
  messageEl.querySelector('use').setAttribute('href', MESSAGE_ICONS[kind]);
  messageEl.dataset.kind = kind;
  messageEl.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  messageEl.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    messageEl.hidden = true;
  }, duration);
}

const fileName = (filePath) => filePath.split(/[\\/]/).pop();
const stem = (name) => name.replace(/\.[^.]+$/, '');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function formatValue(value) {
  if (value instanceof Date) return value.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

function copyButton(text, what) {
  const button = document.createElement('button');
  button.className = 'btn ghost icon-btn copy-btn';
  button.title = `Copy ${what}`;
  button.setAttribute('aria-label', `Copy ${what}`);
  button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-copy" /></svg>';
  button.addEventListener('click', () => {
    window.compareApi.copyText(text);
    showMessage(`${what} copied`, 'success', 2000);
  });
  return button;
}

// Items with `copy` set get a button that copies their value.
function renderDetails(container, details) {
  container.replaceChildren(
    ...details.map((group) => {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      const list = document.createElement('dl');
      for (const { label, value, copy } of group.items) {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        if (copy) {
          const text = document.createElement('span');
          text.textContent = formatValue(value);
          description.classList.add('copyable');
          description.append(text, copyButton(value, label));
        } else {
          description.textContent = formatValue(value);
        }
        list.append(term, description);
      }
      section.append(heading, list);
      return section;
    })
  );
}

// Tab stops this many characters apart line up the columns of cells written
// as text, apart from the odd long cell.
function tabStop(text) {
  const lengths = text
    .split('\n', 200)
    .flatMap((line) => line.split('\t').map((cell) => cell.length))
    .sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length * 0.9)] ?? 0;
  return Math.min(Math.max(typical + 2, 8), 28);
}

// A side of a row of the text comparison. A side without a line is hatched
// where the other side's line is missing from it, and left empty where it
// only has fewer blank lines (`spacing`).
function buildCell(side, sideClass, spacing) {
  const num = document.createElement('div');
  const cell = document.createElement('div');
  num.className = `num ${sideClass}`;
  cell.className = `cell ${sideClass}`;
  if (!side) {
    if (!spacing) {
      num.classList.add('filler');
      cell.classList.add('filler');
    }
    return [num, cell];
  }
  num.textContent = side.num;
  for (const segment of side.segments) {
    if (segment.changed) {
      const span = document.createElement('span');
      span.className = 'hl';
      span.textContent = segment.text;
      cell.append(span);
    } else {
      cell.append(segment.text);
    }
  }
  return [num, cell];
}

// An empty row above the first or below the last line; the centre divider
// carries on through it.
function spacerRow(className) {
  const row = document.createElement('div');
  row.className = `row ${className}`;
  for (const cellClass of ['num l', 'cell l', 'num r', 'cell r']) {
    const cell = document.createElement('div');
    cell.className = cellClass;
    row.append(cell);
  }
  return row;
}

const plural = (count, unit) => `${count.toLocaleString()} ${count === 1 ? unit : `${unit}s`}`;

const differingRows = (diff) => diff.stats.changed + diff.stats.removed + diff.stats.added;
const differingColumns = (diff) => diff.columnStats.removed + diff.columnStats.added;
// A sheet without a counterpart differs even when it is empty.
const differs = (diff) => !diff.left || !diff.right || differingRows(diff) + differingColumns(diff) > 0;

function columnSummary({ removed, added }) {
  const parts = [removed > 0 && `${plural(removed, 'column')} removed`, added > 0 && `${plural(added, 'column')} added`];
  return parts.filter(Boolean).join(', ');
}

// Every workspace starts out as a copy of the template.
function mountWorkspace(kind) {
  const root = $('#workspace').content.firstElementChild.cloneNode(true);
  root.dataset.kind = kind;
  root.setAttribute('aria-label', KINDS[kind].label);
  messageEl.before(root);
  return root;
}

// Open file and Clear in the head of one side.
function wireHead(head, side, clear) {
  const fileInput = head.querySelector('input[type="file"]');
  head.querySelector('.open-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (file) loadFile(side, file);
  });
  head.querySelector('.clear-btn').addEventListener('click', clear);
}

// A workspace holds one comparison: its two sides, their files and, while
// comparing, the result. Every kind of comparison has its own, so switching
// between them loses nothing.
function createWorkspace(kind) {
  const config = KINDS[kind];
  const root = mountWorkspace(kind);

  const find = (selector) => root.querySelector(selector);
  const editView = find('.edit-view');
  const diffView = find('.diff-view');
  const tableEl = find('.table-view');
  const sheetTabs = find('.sheet-tabs');
  const diffNote = find('.diff-note');
  const navigatorEl = find('.navigator');
  const positionEl = find('.position');
  const statsEl = find('.stats');
  const docEl = find('.doc-view');
  // Spreadsheets are shown as tables, everything else as lines of text.
  const tableView = kind === 'sheets' ? createTableView(tableEl) : null;
  // Both can also be shown as they look: documents pages and all,
  // spreadsheets formatting and all.
  let lookView = null;
  if (kind === 'docs') lookView = createDocView(docEl, { onFindChange: () => renderFindCount() });
  else if (kind === 'sheets') lookView = createSheetView(docEl);

  let comparing = false;
  // Whether the files are on show as they look, and the comparison (texts
  // or pair of sheets) they were last shown for.
  let showingLook = false;
  let lookShownFor = null;
  // The option switches the comparison on show was made with.
  let comparedWith = '';
  let comparedOptions = {};
  // Set when the texts changed while the workspace was out of sight.
  let stale = false;
  // Runs of differing rows, for previous/next navigation: how many there are
  // and which one is current.
  let blockCount = 0;
  let currentBlock = -1;
  // First row of each run in the text diff.
  let blocks = [];
  // The text comparison on show, as DiffEngine.compare() returned it.
  let textResult = null;
  // One comparison per pair of sheets.
  let sheetDiffs = [];
  let activeSheet = 0;
  // Find in the text diff: what is looked for, the text ranges that have it
  // and the one gone to last.
  let findQuery = '';
  let findRanges = [];
  let findIndex = -1;

  const panes = {};
  for (const side of SIDES) {
    const head = find(`.pane-head[data-side="${side}"]`);
    const body = find(`.pane-body[data-side="${side}"]`);
    const pane = {
      textarea: body.querySelector('textarea'),
      loadingEl: body.querySelector('.pane-loading'),
      nameEl: head.querySelector('.pane-name'),
      infoBtn: head.querySelector('.info-btn'),
      detailsEl: head.querySelector('.details'),
      // { name, details, sheets, source } while the text is an unedited
      // loaded file; only spreadsheets have sheets, and only Word files and
      // PDFs a source.
      file: null,
      // The file being opened, by the number loadFile() gave it.
      loading: 0,
    };
    panes[side] = pane;

    pane.textarea.setAttribute('aria-label', config.paste[side]);
    pane.textarea.classList.toggle('table-text', kind === 'sheets');
    body.querySelector('.empty-hint use').setAttribute('href', config.icon);
    body.querySelector('.empty-hint strong').textContent = config.paste[side];
    body.querySelector('.empty-hint span').textContent = config.drop;

    // The details open under their own info button.
    const anchor = `--info-${kind}-${side}`;
    pane.infoBtn.style.anchorName = anchor;
    pane.detailsEl.style.positionAnchor = anchor;
    pane.infoBtn.popoverTargetElement = pane.detailsEl;

    wireHead(head, side, () => setText(side, '', null));
    // Text typed or pasted over a loaded file is no longer that file.
    pane.textarea.addEventListener('input', () => {
      if (pane.file) setFile(side, null);
      alignColumns(side);
    });
  }

  function setFile(side, file) {
    const pane = panes[side];
    pane.file = file;
    pane.nameEl.textContent = file ? file.name : '';
    pane.nameEl.title = file ? file.name : '';
    pane.infoBtn.hidden = !file;
    pane.detailsEl.hidePopover();
    renderDetails(pane.detailsEl, file ? file.details : []);
  }

  // Shows that file number `load` is being opened on one side, or with
  // `name` null that it's done. A later file takes over from an earlier one.
  function setLoading(side, name, load) {
    const pane = panes[side];
    if (name === null && pane.loading !== load) return;
    pane.loading = name === null ? 0 : load;
    pane.loadingEl.hidden = name === null;
    pane.loadingEl.querySelector('.loading-text').textContent = name === null ? '' : `Opening ${name}…`;
  }

  // Lines up the columns of the cells in a spreadsheet's editor.
  function alignColumns(side) {
    const { textarea } = panes[side];
    if (tableView) textarea.style.tabSize = tabStop(textarea.value);
  }

  // Redoes the comparison after its texts changed. Out of sight that has to
  // wait: the views can only lay themselves out while they are on show.
  function refresh() {
    if (!comparing) return;
    if (root.hidden) stale = true;
    else runCompare();
  }

  function setText(side, text, file) {
    panes[side].textarea.value = text;
    setFile(side, file);
    alignColumns(side);
    refresh();
    // A Word file or PDF may have come or gone, and with it the document view.
    renderTopbar();
  }

  // Whether either side holds a Word file, PDF or workbook, which can be
  // shown as it looks.
  const hasDocument = () => SIDES.some((side) => Boolean(panes[side].file?.source));

  // What the document view shows on each side: the Word file or PDF opened
  // there, or else the text, on a page of its own.
  function docInputs() {
    const inputs = {};
    for (const side of SIDES) {
      const { file, textarea } = panes[side];
      const text = textarea.value;
      inputs[side] = file?.source
        ? { key: file, name: file.name, kind: file.source.kind, bytes: file.source.bytes, text }
        : { key: text, name: file?.name ?? '', text };
    }
    return inputs;
  }

  // What the sheet view shows on each side of a pair of sheets: the sheet,
  // and how it looks when it comes from a workbook.
  function sheetInputs(diff) {
    const inputs = {};
    for (const side of SIDES) {
      const sheet = diff[side];
      const { file } = panes[side];
      const index = sheet && file?.sheets ? file.sheets.indexOf(sheet) : -1;
      inputs[side] = { sheet, look: index >= 0 ? (file.source?.looks?.[index] ?? null) : null };
    }
    return inputs;
  }

  // Shows the comparison as lines of text or a table or, when that's the
  // view asked for and there's a file to show, as the files look. Returns
  // whether that changed.
  function renderView() {
    const look = Boolean(lookView) && comparing && preferredView[kind] === 'look' && hasDocument();
    const changed = look !== showingLook;
    showingLook = look;
    root.classList.toggle('doc-mode', look);
    diffView.hidden = !comparing || Boolean(tableView) || look;
    tableEl.hidden = !comparing || !tableView || look;
    docEl.hidden = !look;
    // The comparison on show: the texts, or the pair of sheets.
    const shown = tableView ? sheetDiffs[activeSheet] : textResult;
    if (look && shown && lookShownFor !== shown) {
      lookShownFor = shown;
      if (tableView) lookView.show(sheetInputs(shown), shown);
      else lookView.show(docInputs(), shown.rows);
    }
    return changed;
  }

  // Scrolls the run of differences gone to last into view.
  function revealBlock() {
    if (currentBlock < 0) return;
    if (showingLook) lookView.goTo(currentBlock);
    else if (tableView) tableView.goTo(currentBlock);
    else blocks[currentBlock].scrollIntoView({ block: 'center' });
  }

  // `stats` counts the changed, removed and added lines or rows (`unit`);
  // `columnStats` the removed and added columns of a table.
  function renderStats(stats, unit, columnStats = {}) {
    const stat = (type, text, title) => {
      const el = document.createElement('span');
      el.className = `stat ${type}`;
      el.textContent = text;
      if (title) el.title = title;
      return el;
    };
    const types = ['changed', 'removed', 'added'];
    statsEl.replaceChildren(
      ...types
        .filter((type) => stats[type] > 0)
        .map((type) => stat(type, `${stats[type].toLocaleString()} ${type}`, `${plural(stats[type], unit)} ${type}`)),
      ...types
        .filter((type) => columnStats[type] > 0)
        .map((type) => stat(type, `${plural(columnStats[type], 'column')} ${type}`))
    );
  }

  function renderPosition() {
    positionEl.textContent =
      currentBlock < 0
        ? `${blockCount} ${blockCount === 1 ? 'difference' : 'differences'}`
        : `${currentBlock + 1} of ${blockCount}`;
  }

  // Fills the navigator for a comparison with `count` runs of differing rows.
  function showSummary(count, stats, unit, columnStats) {
    blockCount = count;
    currentBlock = -1;
    renderStats(stats, unit, columnStats);
    renderPosition();
    navigatorEl.hidden = count === 0;
  }

  function showNote(text, neutral) {
    diffNote.hidden = !text;
    diffNote.classList.toggle('neutral', neutral);
    diffNote.querySelector('span').textContent = text;
  }

  // Stands in for a run of unchanged lines that "Differences only" leaves
  // out; clicking it brings them back.
  function gapRow(run) {
    const row = document.createElement('div');
    row.className = 'row gap';
    const button = document.createElement('button');
    button.className = 'gap-btn';
    button.title = 'Show these lines';
    button.addEventListener('click', () => {
      for (const rowEl of run) rowEl.classList.remove('far');
      row.remove();
      refreshFind();
    });
    row.append(button);
    return { row, label: () => (button.textContent = `⋯ ${plural(run.length, 'unchanged line')}`) };
  }

  function compareTexts(options) {
    textResult = DiffEngine.compare(panes.left.textarea.value, panes.right.textarea.value, options);
    const { rows, stats } = textResult;
    const hidden = DiffEngine.hiddenRows(rows, CONTEXT);

    const fragment = document.createDocumentFragment();
    const gaps = [];
    let run = null;
    blocks = [];
    let previousType = 'equal';
    rows.forEach((row, index) => {
      const rowEl = document.createElement('div');
      rowEl.className = `row ${row.type}`;
      const spacing = row.type === 'equal';
      rowEl.append(...buildCell(row.left, 'l', spacing), ...buildCell(row.right, 'r', spacing));
      if (hidden[index]) {
        rowEl.classList.add('far');
        if (!run) {
          run = [];
          const gap = gapRow(run);
          gaps.push(gap);
          fragment.append(gap.row);
        }
        run.push(rowEl);
      } else {
        run = null;
      }
      if (row.type !== 'equal' && previousType === 'equal') blocks.push(rowEl);
      previousType = row.type;
      fragment.append(rowEl);
    });
    for (const gap of gaps) gap.label();

    diffView.replaceChildren(spacerRow('lead'), fragment, spacerRow('tail'));
    diffView.scrollTop = 0;
    if (rows.length === 0) showNote('Nothing to compare yet — both sides are empty.', true);
    else if (blocks.length === 0) showNote('The two texts are identical.', false);
    else showNote('', false);
    showSummary(blocks.length, stats, 'line');
  }

  function renderTabs() {
    sheetTabs.hidden = sheetDiffs.length < 2;
    sheetTabs.replaceChildren(
      ...sheetDiffs.map((diff, index) => {
        const tab = document.createElement('button');
        tab.className = 'sheet-tab';
        tab.setAttribute('role', 'tab');
        tab.append(diff.name || `Sheet ${index + 1}`);
        if (differs(diff)) {
          const badge = document.createElement('span');
          if (!diff.right) {
            badge.className = 'sheet-count removed';
            badge.textContent = 'removed';
          } else if (!diff.left) {
            badge.className = 'sheet-count added';
            badge.textContent = 'added';
          } else {
            const rows = differingRows(diff);
            badge.className = 'sheet-count changed';
            badge.textContent = (rows + differingColumns(diff)).toLocaleString();
            badge.title = [rows > 0 && `${plural(rows, 'row')} ${rows === 1 ? 'differs' : 'differ'}`, columnSummary(diff.columnStats)]
              .filter(Boolean)
              .join(', ');
          }
          tab.append(badge);
        }
        tab.addEventListener('click', () => showSheet(index));
        return tab;
      })
    );
  }

  function showSheet(index) {
    activeSheet = index;
    [...sheetTabs.children].forEach((tab, i) => tab.setAttribute('aria-selected', String(i === index)));
    if (!sheetTabs.hidden) sheetTabs.children[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });

    const diff = sheetDiffs[index];
    // A sheet without a counterpart is all removed or added rows; its columns
    // aren't counted on top of that.
    const columnStats = diff.left && diff.right ? diff.columnStats : {};
    const count = tableView.show(diff, optOnly.checked);
    if (!sheetDiffs.some(differs)) {
      if (sheetDiffs.every((other) => other.rows.length === 0)) showNote('Nothing to compare yet — both sides are empty.', true);
      else showNote('No differences — both spreadsheets show the same values.', false);
    } else if (!diff.right) {
      showNote('This sheet is only in the original.', true);
    } else if (!diff.left) {
      showNote('This sheet is only in the changed spreadsheet.', true);
    } else if (!differs(diff)) {
      showNote('No differences in this sheet.', false);
    } else if (count === 0) {
      showNote(`The rows are the same, but the columns differ: ${columnSummary(diff.columnStats)}.`, true);
    } else {
      showNote('', false);
    }
    showSummary(count, diff.stats, 'row', columnStats);
    renderView();
    refreshFind();
  }

  // A loaded file brings its sheets; cells typed or pasted are read from the
  // text.
  const sheetsOf = (pane) => pane.file?.sheets ?? TableText.toSheets(pane.textarea.value);

  function compareSheets(options, keepSheet) {
    sheetDiffs = TableDiff.compare(sheetsOf(panes.left), sheetsOf(panes.right), options);
    // Opens on the first sheet that has something to show.
    const firstDifferent = sheetDiffs.findIndex(differs);
    const kept = keepSheet && activeSheet < sheetDiffs.length;
    renderTabs();
    showSheet(kept ? activeSheet : Math.max(0, firstDifferent));
  }

  const optionsKey = () => `${optCase.checked}|${optSpace.checked}`;

  // `keepSheet` stays on the sheet being looked at, for when only the options
  // changed.
  function runCompare(keepSheet = false) {
    const options = { ignoreCase: optCase.checked, ignoreWhitespace: optSpace.checked };
    comparedWith = optionsKey();
    comparedOptions = options;
    stale = false;
    if (tableView) {
      compareSheets(options, keepSheet);
    } else {
      compareTexts(options);
      renderView();
      refreshFind();
    }
  }

  function setComparing(value) {
    comparing = value;
    root.classList.toggle('comparing', comparing);
    editView.hidden = comparing;
    tableEl.hidden = !comparing || !tableView;
    if (comparing) {
      runCompare();
      return;
    }
    clearFind();
    renderView();
    diffView.replaceChildren();
    if (lookView) lookView.clear();
    lookShownFor = null;
    if (tableView) tableView.clear();
    sheetTabs.hidden = true;
    showNote('', false);
    navigatorEl.hidden = true;
    blocks = [];
    blockCount = 0;
    textResult = null;
    sheetDiffs = [];
  }

  // Brings the comparison up to date with its texts and the option switches;
  // either may have changed while another workspace was on show.
  function sync() {
    diffView.classList.toggle('only-diff', optOnly.checked);
    if (comparing && stale) runCompare();
    else if (comparing && comparedWith !== optionsKey()) runCompare(true);
    // The view asked for may have changed: what was gone to stays in view.
    else if (renderView()) revealBlock();
    if (tableView) tableView.setOnlyDifferences(optOnly.checked);
    refreshFind();
  }

  function goToBlock(step) {
    if (blockCount === 0) return;
    const previous = currentBlock;
    if (currentBlock < 0) currentBlock = step > 0 ? 0 : blockCount - 1;
    else currentBlock = (currentBlock + step + blockCount) % blockCount;
    if (!tableView) {
      // The lines keep up even while the documents are on show.
      if (previous >= 0) blocks[previous].classList.remove('current');
      blocks[currentBlock].classList.add('current');
    }
    revealBlock();
    renderPosition();
  }

  function swap() {
    const { left, right } = panes;
    [left.textarea.value, right.textarea.value] = [right.textarea.value, left.textarea.value];
    const leftFile = left.file;
    setFile('left', right.file);
    setFile('right', leftFile);
    SIDES.forEach(alignColumns);
    refresh();
  }

  // Find. Spreadsheets are searched by their table or sheet view, which only
  // have the rows in sight in the DOM, and documents shown as they look by
  // the document view; the text diff is searched on the page and its
  // matches painted with the CSS Custom Highlight API.

  // The view that does its own finding, if that's the one on show.
  const finder = () => (showingLook ? lookView : tableView);

  // The text of each line on show, both sides in turn, searched for `query`.
  function textMatches(query) {
    const pattern = new RegExp(escapeRegExp(query), 'giu');
    const hideFar = diffView.classList.contains('only-diff');
    const ranges = [];
    for (const rowEl of diffView.children) {
      if (hideFar && rowEl.classList.contains('far')) continue;
      for (const cell of rowEl.querySelectorAll('.cell')) {
        const nodes = [];
        let text = '';
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          nodes.push({ node: walker.currentNode, start: text.length });
          text += walker.currentNode.data;
        }
        if (text === '') continue;
        // Where in the cell's text nodes a place in its text is.
        const locate = (offset, isEnd) => {
          let i = nodes.length - 1;
          while (i > 0 && (nodes[i].start > offset || (isEnd && nodes[i].start === offset))) i--;
          return [nodes[i].node, offset - nodes[i].start];
        };
        for (const match of text.matchAll(pattern)) {
          const range = new Range();
          range.setStart(...locate(match.index, false));
          range.setEnd(...locate(match.index + match[0].length, true));
          ranges.push(range);
          if (ranges.length >= 100000) return ranges;
        }
      }
    }
    return ranges;
  }

  function paintFind() {
    const all = new Highlight();
    for (const range of findRanges) all.add(range);
    CSS.highlights.set('find', all);
    if (findIndex >= 0) CSS.highlights.set('find-current', new Highlight(findRanges[findIndex]));
    else CSS.highlights.delete('find-current');
  }

  // Looks for `query`, whatever its case. With `go`, goes to the first match.
  function search(query, go = true) {
    findQuery = query;
    const view = finder();
    if (view) {
      const count = view.search(query);
      if (go && count > 0) view.goToMatch(0);
      return;
    }
    findRanges = query ? textMatches(query) : [];
    findIndex = -1;
    if (go && findRanges.length > 0) findStep(1);
    else paintFind();
  }

  function findStep(step) {
    const view = finder();
    if (view) {
      const { index, count } = view.searchState();
      if (count === 0) return;
      view.goToMatch(index < 0 ? (step > 0 ? 0 : count - 1) : (index + step + count) % count);
      return;
    }
    const count = findRanges.length;
    if (count === 0) return;
    findIndex = findIndex < 0 ? (step > 0 ? 0 : count - 1) : (findIndex + step + count) % count;
    paintFind();
    findRanges[findIndex].startContainer.parentElement.closest('.row').scrollIntoView({ block: 'center' });
  }

  const findState = () => finder()?.searchState() ?? { index: findIndex, count: findRanges.length };

  // Finds again after the view changed, without moving.
  function refreshFind() {
    if (!findQuery || !comparing) return;
    search(findQuery, false);
    renderFindCount();
  }

  function clearFind() {
    search('', false);
    // The document view, out of sight, would otherwise find it again once
    // its documents open.
    if (lookView && !showingLook) lookView.search('');
  }

  // The comparison on show as a file to save, in `format` (html, patch or
  // csv): { name, filters, content }. `empty` instead when there is nothing
  // to put in it.
  function exportResult(format) {
    if (!comparing) return null;
    const leftName = panes.left.file?.name ?? 'Original';
    const rightName = panes.right.file?.name ?? 'Changed';
    const base = panes.left.file || panes.right.file ? `${stem(leftName)} vs ${stem(rightName)}` : 'Comparison';
    const created = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
    const names = { leftName, rightName, options: comparedOptions, created };
    if (format === 'patch' && textResult) {
      const content = Report.textPatch({ rows: textResult.rows, leftName, rightName });
      if (!content) return { empty: true };
      return { name: `${base}.patch`, filters: [{ name: 'Patch file', extensions: ['patch', 'diff'] }], content };
    }
    if (format === 'csv' && tableView) {
      return { name: `${base}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }], content: Report.sheetCsv({ diffs: sheetDiffs }) };
    }
    const content = tableView
      ? Report.sheetReport({ diffs: sheetDiffs, ...names })
      : Report.textReport({ ...textResult, ...names, onlyDifferences: optOnly.checked });
    return { name: `${base}.html`, filters: [{ name: 'Web page', extensions: ['html'] }], content };
  }

  find('.prev-btn').addEventListener('click', () => goToBlock(-1));
  find('.next-btn').addEventListener('click', () => goToBlock(1));

  return {
    kind,
    root,
    panes,
    get comparing() {
      return comparing;
    },
    get showingLook() {
      return showingLook;
    },
    hasDocument,
    // A step in (1) or out (-1).
    zoomDocuments: (step) => lookView?.zoomStep(step),
    isEmpty: (side) => panes[side].textarea.value === '' && !panes[side].loading,
    setComparing,
    setText,
    setLoading,
    sync,
    goToBlock,
    swap,
    search,
    findStep,
    findState,
    clearFind,
    exportResult,
  };
}

// The workspace for files of any kind. Two files are identical when their
// SHA-256 checksums are, so there is no text to edit and nothing to set off:
// the verdict is there as soon as both checksums are. A single file can be
// checked against a checksum pasted in.
function createFilesWorkspace() {
  const kind = 'files';
  const config = KINDS[kind];
  const root = mountWorkspace(kind);

  const find = (selector) => root.querySelector(selector);
  const note = find('.diff-note');
  find('.edit-view').hidden = true;
  find('.files-view').hidden = false;

  // Numbers the checksums asked for, so that one can be called off.
  let lastJob = 0;

  const panes = {};
  for (const side of SIDES) {
    const head = find(`.pane-head[data-side="${side}"]`);
    const body = find(`.file-pane[data-side="${side}"]`);
    const verifyEl = body.querySelector('.verify');
    panes[side] = {
      card: body.querySelector('.file-card'),
      hint: body.querySelector('.empty-hint'),
      verifyEl,
      verifyInput: verifyEl.querySelector('input'),
      verifyResult: verifyEl.querySelector('.verify-result'),
      // The checksum being worked out, if any.
      job: 0,
      // { checksums, size, details } once it is there.
      file: null,
    };
    head.querySelector('.pane-title').textContent = config.titles[side];
    wireHead(head, side, () => clear(side));
    panes[side].verifyInput.addEventListener('input', () => verify(side));
    showHint(side, config.hint[side], config.drop);
  }

  // Stands in for the details of a side that has none yet.
  function showHint(side, title, text) {
    const { card, hint, verifyEl } = panes[side];
    card.hidden = true;
    verifyEl.hidden = true;
    hint.hidden = false;
    hint.querySelector('strong').textContent = title;
    hint.querySelector('span').textContent = text;
  }

  function renderVerdict() {
    const { left, right } = panes;
    const both = Boolean(left.file && right.file);
    const identical = both && left.file.checksums.sha256 === right.file.checksums.sha256;
    root.dataset.verdict = both ? (identical ? 'identical' : 'different') : '';
    note.hidden = !both;
    if (!both) return;
    let text = 'The files are identical — same size, same SHA-256 checksum.';
    if (!identical) {
      text =
        left.file.size === right.file.size
          ? "The files are different — same size, but the SHA-256 checksums don't match."
          : 'The files are different — neither the sizes nor the SHA-256 checksums match.';
    }
    note.classList.toggle('different', !identical);
    note.querySelector('use').setAttribute('href', identical ? '#i-check' : '#i-cross');
    note.querySelector('span').textContent = text;
  }

  // Compares the checksum pasted on one side with the file's own. It may
  // come with more, such as a line of a .sha256 file ("<checksum>  name");
  // its length tells which kind it is.
  function verify(side) {
    const pane = panes[side];
    const result = pane.verifyResult;
    const input = pane.verifyInput.value.trim();
    result.hidden = input === '' || !pane.file;
    if (result.hidden) return;
    const tokens = input.match(/\b[0-9a-f]+\b/gi) || [];
    const expected = tokens.find((token) => CHECKSUM_LENGTHS[token.length])?.toLowerCase();
    let state = 'neutral';
    let text = "That isn't a checksum: they're 32, 40, 64 or 128 characters of 0–9 and a–f.";
    if (expected) {
      const algorithm = CHECKSUM_LENGTHS[expected.length];
      const matches = pane.file.checksums[algorithm] === expected;
      state = matches ? 'match' : 'mismatch';
      text = matches
        ? `Matches — the file's ${CHECKSUMS[algorithm]} checksum is the same.`
        : `Doesn't match the file's ${CHECKSUMS[algorithm]} checksum. The file isn't the one the checksum is for, or it's damaged.`;
    }
    result.dataset.state = state;
    result.querySelector('use').setAttribute('href', { match: '#i-check', mismatch: '#i-cross', neutral: '#i-info' }[state]);
    result.querySelector('span').textContent = text;
  }

  function clear(side) {
    const pane = panes[side];
    if (pane.job) window.compareApi.cancelHash(pane.job);
    pane.job = 0;
    pane.file = null;
    showHint(side, config.hint[side], config.drop);
    renderVerdict();
  }

  async function load(side, file) {
    const pane = panes[side];
    clear(side);
    const job = ++lastJob;
    pane.job = job;
    const working = 'Working out the checksums…';
    showHint(side, file.name, working);
    const result = await window.compareApi.hashFile(job, file, (read, total) => {
      if (pane.job === job && total > 0) showHint(side, file.name, `${working} ${Math.floor((read / total) * 100)}%`);
    });
    // Cleared or replaced in the meantime.
    if (pane.job !== job) return;
    pane.job = 0;
    if (!result.ok) {
      clear(side);
      showMessage(`Couldn't read ${file.name}: ${result.error}`);
      return;
    }
    pane.file = result;
    const checksums = Object.entries(CHECKSUMS).map(([algorithm, label]) => ({
      label,
      value: result.checksums[algorithm],
      copy: true,
    }));
    renderDetails(pane.card, [...result.details, { title: 'Checksums', items: checksums }]);
    pane.hint.hidden = true;
    pane.card.hidden = false;
    pane.verifyEl.hidden = false;
    verify(side);
    renderVerdict();
  }

  // The rest is what the top bar and the keyboard ask of the workspace on
  // show; none of it applies here.
  return {
    kind,
    root,
    load,
    comparing: false,
    isEmpty: (side) => !panes[side].file && !panes[side].job,
    setComparing() {},
    sync() {},
    goToBlock() {},
    swap() {},
  };
}

const workspaces = { docs: createWorkspace('docs'), sheets: createWorkspace('sheets'), files: createFilesWorkspace() };
// The workspace on show.
let active = workspaces.docs;

// Pages and sheets shown as they look are white paper or, with Dark pages
// on, dark. theme.js puts the choice back when the app starts.
const paperButtons = [...document.querySelectorAll('.doc-paper')];

function renderPaper() {
  const dark = document.documentElement.dataset.paper === 'dark';
  for (const button of paperButtons) button.setAttribute('aria-pressed', String(dark));
}

function togglePaper() {
  const dark = document.documentElement.dataset.paper !== 'dark';
  document.documentElement.dataset.paper = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('paper', dark ? 'dark' : 'light');
  } catch {
    // Remembering it is a convenience only.
  }
  renderPaper();
}

for (const button of paperButtons) button.addEventListener('click', togglePaper);
renderPaper();

// The buttons of the top bar that depend on the workspace and on whether it
// is comparing.
function renderTopbar() {
  compareLabel.textContent = active.comparing ? KINDS[active.kind].edit : 'Compare';
  compareIcon.setAttribute('href', active.comparing ? '#i-edit' : '#i-compare');
  findBtn.hidden = !active.comparing;
  exportBtn.hidden = !active.comparing;
  for (const item of exportMenu.querySelectorAll('button')) {
    item.hidden = !item.dataset.kinds.split(' ').includes(active.kind);
  }

  // Text or document, table or sheet, for documents or spreadsheets being
  // compared. Plain text and CSV look the same either way, so it takes a
  // Word file, PDF or workbook to show one as it looks.
  const { views } = KINDS[active.kind];
  const choosing = Boolean(views) && active.comparing;
  viewSwitch.hidden = !choosing;
  if (choosing) {
    const canShowLook = active.hasDocument();
    const view = canShowLook ? preferredView[active.kind] : 'plain';
    for (const button of viewButtons) {
      const option = views[button.dataset.view];
      button.setAttribute('aria-checked', String(button.dataset.view === view));
      button.querySelector('span').textContent = option.label;
      button.querySelector('use').setAttribute('href', option.icon);
      button.title = option.title;
    }
    const lookButton = viewSwitch.querySelector('[data-view="look"]');
    lookButton.disabled = !canShowLook;
    if (!canShowLook) lookButton.title = views.look.missing;
  }

  // The files shown as they look are always shown whole.
  const showingLook = Boolean(active.showingLook);
  optOnly.disabled = showingLook;
  optOnlySwitch.classList.toggle('disabled', showingLook);
  optOnlySwitch.title = showingLook ? views.look.whole : 'Differences only';
}

function selectView(view) {
  const { views } = KINDS[active.kind];
  if (!views) return;
  preferredView[active.kind] = view;
  try {
    localStorage.setItem(views.key, views[view].value);
  } catch {
    // Remembering the view is a convenience only.
  }
  active.sync();
  renderTopbar();
}

for (const button of viewButtons) {
  button.addEventListener('click', () => selectView(button.dataset.view));
}

function activate(kind) {
  closeFind();
  active = workspaces[kind];
  for (const workspace of Object.values(workspaces)) workspace.root.hidden = workspace !== active;
  for (const item of sidebarItems) item.setAttribute('aria-current', String(item.dataset.kind === kind));
  for (const control of compareControls) control.hidden = kind === 'files';
  try {
    localStorage.setItem('workspace', kind);
  } catch {
    // Remembering the workspace is a convenience only.
  }
  active.sync();
  renderTopbar();
}

function toggleComparing() {
  if (active.comparing) closeFind();
  active.setComparing(!active.comparing);
  renderTopbar();
}

// Opens a file on one side of the workspace it belongs in, which need not be
// the one on show: spreadsheets go to theirs, Word documents and PDFs to the
// documents. Plain text stays where it was opened and is read accordingly.
// Among the files everything stays, to be compared as it is.
//
// Files from Explorer (`fromExplorer`) go where their type says; those that
// can't be read as text at all have their checksums compared instead.
// Without a `side` a file takes the first free side.

// Counts the files opened on each side, so that a slow one doesn't land on
// top of one opened after it.
const loads = { left: 0, right: 0 };

async function loadFile(side, file, { fromExplorer = false } = {}) {
  let from = active.kind;
  if (fromExplorer) from = SHEET_FILE.test(file.name) ? 'sheets' : 'docs';
  else if (from === 'files') {
    active.load(side, file);
    return;
  }
  const origin = workspaces[from];
  // So that the file can be seen opening.
  if (origin !== active) activate(from);
  side ??= origin.isEmpty('left') ? 'left' : 'right';
  const load = ++loads[side];
  origin.setLoading(side, file.name, load);
  let result;
  try {
    result = await window.compareApi.parseFile(file, { table: from === 'sheets' });
  } catch (error) {
    // Folders, for one, can't be read at all.
    result = { ok: false, error: error.message };
  }
  origin.setLoading(side, null, load);
  if (load !== loads[side]) return;
  if (!result.ok) {
    if (fromExplorer && result.code === 'UNSUPPORTED') {
      workspaces.files.load(side, file);
      if (active.kind !== 'files') activate('files');
      return;
    }
    showMessage(`Couldn't open ${file.name}: ${result.error}`);
    return;
  }
  const kind = result.sheets ? 'sheets' : 'docs';
  const opened = { name: file.name, details: result.details, sheets: result.sheets, source: result.source };
  workspaces[kind].setText(side, result.text, opened);
  if (kind !== active.kind) activate(kind);
  if (result.warning) showMessage(`${file.name}: ${result.warning}`, 'info');
}

// Files passed on by Explorer: two fill both sides, one takes a free side.
function openPaths(paths) {
  const files = paths.map((filePath) => ({ path: filePath, name: fileName(filePath) }));
  if (files.length >= 2) {
    loadFile('left', files[0], { fromExplorer: true });
    loadFile('right', files[1], { fromExplorer: true });
  } else if (files.length === 1) {
    loadFile(null, files[0], { fromExplorer: true });
  }
}

// Find bar: searches the comparison on show.

let findTimer;

function renderFindCount() {
  if (findBar.hidden) return;
  const { index, count } = active.findState?.() ?? { index: -1, count: 0 };
  const query = findInput.value;
  findBar.classList.toggle('no-results', query !== '' && count === 0);
  if (query === '') findCount.textContent = '';
  else if (count === 0) findCount.textContent = 'No results';
  else if (index < 0) findCount.textContent = `${count.toLocaleString()} ${count === 1 ? 'match' : 'matches'}`;
  else findCount.textContent = `${(index + 1).toLocaleString()} of ${count.toLocaleString()}`;
}

function openFind() {
  if (active.kind === 'files') return;
  if (!active.comparing) {
    showMessage('Find searches the comparison. Press Ctrl+Enter to compare first.', 'info', 4000);
    return;
  }
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) active.search(findInput.value);
  renderFindCount();
}

function closeFind() {
  if (findBar.hidden) return;
  findBar.hidden = true;
  clearTimeout(findTimer);
  findTimer = null;
  active.clearFind?.();
}

function findStep(step) {
  if (findBar.hidden) return;
  active.findStep(step);
  renderFindCount();
}

function searchNow() {
  clearTimeout(findTimer);
  findTimer = null;
  active.search(findInput.value);
  renderFindCount();
}

// Searches once typing pauses; Enter goes through the matches.
findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(searchNow, 150);
});
findInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (findTimer) searchNow();
  else findStep(event.shiftKey ? -1 : 1);
});
findBtn.addEventListener('click', openFind);
$('#find-prev').addEventListener('click', () => findStep(-1));
$('#find-next').addEventListener('click', () => findStep(1));
$('#find-close').addEventListener('click', closeFind);

// Export

async function exportAs(format) {
  exportMenu.hidePopover();
  const file = active.exportResult?.(format);
  if (!file) return;
  if (file.empty) {
    showMessage('There are no differences to put in a patch.', 'info');
    return;
  }
  const result = await window.compareApi.saveFile(file);
  if (result.ok) showMessage(`Saved ${fileName(result.filePath)}`, 'success', 3000);
  else if (result.error) showMessage(`Couldn't save the file: ${result.error}`);
}

exportBtn.style.anchorName = '--export';
exportMenu.style.positionAnchor = '--export';
for (const item of exportMenu.querySelectorAll('button')) {
  item.addEventListener('click', () => exportAs(item.dataset.format));
}

function selectTheme(theme) {
  for (const button of themeButtons) {
    button.setAttribute('aria-checked', String(button.dataset.theme === theme));
  }
}

compareBtn.addEventListener('click', toggleComparing);
$('#swap-btn').addEventListener('click', () => active.swap());

// The option switches are remembered from one start to the next.
const OPTIONS = { ignoreCase: optCase, ignoreWhitespace: optSpace, onlyDifferences: optOnly };
try {
  const saved = JSON.parse(localStorage.getItem('options')) || {};
  for (const [name, input] of Object.entries(OPTIONS)) input.checked = saved[name] === true;
} catch {
  // Nothing saved, or no storage: the switches start off.
}

for (const option of Object.values(OPTIONS)) {
  option.addEventListener('change', () => {
    try {
      const values = Object.fromEntries(Object.entries(OPTIONS).map(([name, input]) => [name, input.checked]));
      localStorage.setItem('options', JSON.stringify(values));
    } catch {
      // As above.
    }
    active.sync();
  });
}

for (const item of sidebarItems) {
  item.addEventListener('click', () => activate(item.dataset.kind));
}

// theme.js restores the sidebar's state when the app starts.
const sidebarCollapsed = () => document.documentElement.classList.contains('sidebar-collapsed');

function renderSidebarToggle() {
  const label = `${sidebarCollapsed() ? 'Expand' : 'Collapse'} sidebar`;
  sidebarToggle.title = `${label} (Ctrl+B)`;
  sidebarToggle.setAttribute('aria-label', label);
  sidebarToggle.setAttribute('aria-expanded', String(!sidebarCollapsed()));
}

function toggleSidebar() {
  const collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'expanded');
  renderSidebarToggle();
}

sidebarToggle.addEventListener('click', toggleSidebar);
renderSidebarToggle();

for (const button of themeButtons) {
  button.addEventListener('click', () => {
    const { theme } = button.dataset;
    applyTheme(theme);
    localStorage.setItem('theme', theme);
    selectTheme(theme);
  });
}
selectTheme(document.documentElement.dataset.theme);

// Ctrl+Plus, Ctrl+Minus and Ctrl+0, on the main keyboard or the number pad.
const ZOOM_KEYS = { '=': 'in', '+': 'in', NumpadAdd: 'in', '-': 'out', NumpadSubtract: 'out', 0: 'reset', Numpad0: 'reset' };

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  // Ctrl+1, Ctrl+2, Ctrl+3: the workspaces in the order of the sidebar.
  const kind = event.ctrlKey ? Object.keys(workspaces)[Number(event.key) - 1] : undefined;
  const zoom = event.ctrlKey && !event.altKey && ZOOM_KEYS[event.code.startsWith('Numpad') ? event.code : event.key];
  if (zoom) {
    event.preventDefault();
    window.compareApi.zoom(zoom);
  } else if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    toggleComparing();
  } else if (event.key === 'F8') {
    event.preventDefault();
    active.goToBlock(event.shiftKey ? -1 : 1);
  } else if (event.key === 'F3' || (event.ctrlKey && key === 'g')) {
    event.preventDefault();
    if (findBar.hidden) openFind();
    else findStep(event.shiftKey ? -1 : 1);
  } else if (event.ctrlKey && key === 'f') {
    event.preventDefault();
    openFind();
  } else if (event.ctrlKey && key === 's') {
    event.preventDefault();
    if (active.comparing) exportAs('html');
  } else if (event.key === 'Escape' && !findBar.hidden) {
    event.preventDefault();
    closeFind();
  } else if (event.ctrlKey && key === 'b') {
    event.preventDefault();
    toggleSidebar();
  } else if (kind) {
    event.preventDefault();
    activate(kind);
  }
});

// Files can be dropped anywhere; the half of the workspace decides the side.
const dropSide = (event) => {
  const { left, width } = active.root.getBoundingClientRect();
  return event.clientX < left + width / 2 ? 'left' : 'right';
};
const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');

// Marks the side a dragged file would land on; no side clears the mark.
function setDropHint(side) {
  active.root.classList.remove('drop-left', 'drop-right');
  if (side) active.root.classList.add(`drop-${side}`);
}

window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  setDropHint(dropSide(event));
});
window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) setDropHint(null);
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  setDropHint(null);
  const files = [...event.dataTransfer.files];
  if (files.length >= 2) {
    // Two files dropped together fill both sides.
    loadFile('left', files[0]);
    loadFile('right', files[1]);
  } else if (files.length === 1) {
    loadFile(dropSide(event), files[0]);
  }
});

window.compareApi.onZoom((factor) => showMessage(`Zoom ${Math.round(factor * 100)}% · Ctrl+0 resets`, 'info', 1800));

// Ctrl and the mouse wheel zoom the window a step per notch or, over
// documents shown as they look, the documents. Wheels report how far they
// turned in pixels, lines or pages.
const WHEEL_NOTCH = 100;
const WHEEL_UNITS = [1, 40, 800];
let wheelZoom = 0;
window.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) return;
    wheelZoom += event.deltaY * (WHEEL_UNITS[event.deltaMode] ?? 1);
    if (Math.abs(wheelZoom) < WHEEL_NOTCH / 2) return;
    const step = wheelZoom < 0 ? 1 : -1;
    wheelZoom = 0;
    if (event.target.closest?.('.doc-view')) active.zoomDocuments?.(step);
    else window.compareApi.zoom(step > 0 ? 'in' : 'out');
  },
  { passive: true }
);
window.compareApi.onOpenPaths(openPaths);

// The update button at the bottom of the sidebar, shown once a newer version
// is out. See updater.js.
const updateBtn = $('#update-btn');
let updateStatus = 'none';

function showUpdate({ status, version, percent = 0, manual }) {
  if (status === 'ready' && updateStatus === 'downloading') {
    showMessage(`Compare ${version} is downloaded. Restart to update now, or it updates when you close it.`, 'success');
  }
  updateStatus = status;
  const looks = {
    available: [
      '#i-update',
      `Update to ${version}`,
      manual ? `Compare ${version} is out. Opens the download page.` : `Compare ${version} is out. Downloads it.`,
    ],
    downloading: ['#i-update', `Downloading ${percent}%`, `Downloading Compare ${version}`],
    ready: ['#i-restart', 'Restart to update', `Restarts Compare on version ${version}`],
    restarting: ['#i-restart', 'Restarting…', `Restarting Compare on version ${version}`],
  }[status];
  updateBtn.hidden = !looks;
  if (!looks) return;
  const [icon, label, title] = looks;
  updateBtn.dataset.status = status;
  updateBtn.querySelector('use').setAttribute('href', icon);
  updateBtn.querySelector('span').textContent = label;
  updateBtn.title = title;
  updateBtn.style.setProperty('--progress', status === 'downloading' ? `${percent}%` : '100%');
}

updateBtn.addEventListener('click', async () => {
  const result = await window.compareApi.update();
  if (!result.ok) showMessage(result.error);
});
window.compareApi.onUpdateState(showUpdate);
window.compareApi.getUpdateState().then(showUpdate);

let savedWorkspace = null;
try {
  savedWorkspace = localStorage.getItem('workspace');
} catch {
  // No storage: start on the documents.
}
activate(Object.hasOwn(workspaces, savedWorkspace) ? savedWorkspace : 'docs');
window.compareApi.takeLaunchPaths().then(openPaths);
