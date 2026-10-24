const $ = (selector) => document.querySelector(selector);

const compareBtn = $('#compare-btn');
const compareLabel = $('#compare-label');
const compareIcon = $('#compare-icon');
const messageEl = $('#message');
const optCase = $('#opt-case');
const optSpace = $('#opt-space');
const optOnly = $('#opt-only');
const themeButtons = [...document.querySelectorAll('#theme-switch button')];
const sidebarItems = [...document.querySelectorAll('.sidebar-item')];
const sidebarToggle = $('#sidebar-toggle');
// The controls for comparing texts and tables; files have no use for them.
const compareControls = [compareBtn, $('#swap-btn'), $('.switches')];

const SIDES = ['left', 'right'];

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
  },
  sheets: {
    label: 'Spreadsheets',
    icon: '#i-table',
    paste: { left: 'Paste the original cells', right: 'Paste the changed cells' },
    drop: 'or drop a file here — Excel, OpenDocument or CSV',
    edit: 'Edit tables',
  },
  files: {
    label: 'Files',
    titles: { left: 'File A', right: 'File B' },
    hint: { left: 'Drop the first file here', right: 'Drop the second file here' },
    drop: 'or use Open file — any kind of file',
  },
};

let messageTimer;

function showMessage(text) {
  messageEl.querySelector('span').textContent = text;
  messageEl.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    messageEl.hidden = true;
  }, 6000);
}

function formatValue(value) {
  if (value instanceof Date) return value.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

function renderDetails(container, details) {
  container.replaceChildren(
    ...details.map((group) => {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      const list = document.createElement('dl');
      for (const { label, value } of group.items) {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = formatValue(value);
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

function buildCell(side, sideClass) {
  const num = document.createElement('div');
  const cell = document.createElement('div');
  num.className = `num ${sideClass}`;
  cell.className = `cell ${sideClass}`;
  if (!side) {
    num.classList.add('filler');
    cell.classList.add('filler');
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
  // Spreadsheets are shown as tables, everything else as lines of text.
  const tableView = kind === 'sheets' ? createTableView(tableEl) : null;

  let comparing = false;
  // The option switches the comparison on show was made with.
  let comparedWith = '';
  // Set when the texts changed while the workspace was out of sight.
  let stale = false;
  // Runs of differing rows, for previous/next navigation: how many there are
  // and which one is current.
  let blockCount = 0;
  let currentBlock = -1;
  // First row of each run in the text diff.
  let blocks = [];
  // One comparison per pair of sheets.
  let sheetDiffs = [];
  let activeSheet = 0;

  const panes = {};
  for (const side of SIDES) {
    const head = find(`.pane-head[data-side="${side}"]`);
    const body = find(`.pane-body[data-side="${side}"]`);
    const pane = {
      textarea: body.querySelector('textarea'),
      nameEl: head.querySelector('.pane-name'),
      infoBtn: head.querySelector('.info-btn'),
      detailsEl: head.querySelector('.details'),
      // { name, details, sheets } while the text is an unedited loaded file;
      // only spreadsheets have sheets.
      file: null,
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

  function compareTexts(options) {
    const { rows, stats } = DiffEngine.compare(panes.left.textarea.value, panes.right.textarea.value, options);

    const fragment = document.createDocumentFragment();
    blocks = [];
    let previousType = 'equal';
    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = `row ${row.type}`;
      rowEl.append(...buildCell(row.left, 'l'), ...buildCell(row.right, 'r'));
      if (row.type !== 'equal' && previousType === 'equal') blocks.push(rowEl);
      previousType = row.type;
      fragment.append(rowEl);
    }

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
    stale = false;
    if (tableView) compareSheets(options, keepSheet);
    else compareTexts(options);
  }

  function setComparing(value) {
    comparing = value;
    root.classList.toggle('comparing', comparing);
    editView.hidden = comparing;
    diffView.hidden = !comparing || Boolean(tableView);
    tableEl.hidden = !comparing || !tableView;
    if (comparing) {
      runCompare();
      return;
    }
    diffView.replaceChildren();
    if (tableView) tableView.clear();
    sheetTabs.hidden = true;
    showNote('', false);
    navigatorEl.hidden = true;
    blocks = [];
    blockCount = 0;
    sheetDiffs = [];
  }

  // Brings the comparison up to date with its texts and the option switches;
  // either may have changed while another workspace was on show.
  function sync() {
    diffView.classList.toggle('only-diff', optOnly.checked);
    if (comparing && stale) runCompare();
    else if (comparing && comparedWith !== optionsKey()) runCompare(true);
    if (tableView) tableView.setOnlyDifferences(optOnly.checked);
  }

  function goToBlock(step) {
    if (blockCount === 0) return;
    const previous = currentBlock;
    if (currentBlock < 0) currentBlock = step > 0 ? 0 : blockCount - 1;
    else currentBlock = (currentBlock + step + blockCount) % blockCount;
    if (tableView) {
      tableView.goTo(currentBlock);
    } else {
      if (previous >= 0) blocks[previous].classList.remove('current');
      blocks[currentBlock].classList.add('current');
      blocks[currentBlock].scrollIntoView({ block: 'center' });
    }
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

  find('.prev-btn').addEventListener('click', () => goToBlock(-1));
  find('.next-btn').addEventListener('click', () => goToBlock(1));

  return {
    kind,
    root,
    panes,
    get comparing() {
      return comparing;
    },
    setComparing,
    setText,
    sync,
    goToBlock,
    swap,
  };
}

// The workspace for files of any kind. Two files are identical when their
// SHA-256 checksums are, so there is no text to edit and nothing to set off:
// the verdict is there as soon as both checksums are.
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
    panes[side] = {
      card: body.querySelector('.file-card'),
      hint: body.querySelector('.empty-hint'),
      // The checksum being worked out, if any.
      job: 0,
      // { sha256, size, details } once it is there.
      file: null,
    };
    head.querySelector('.pane-title').textContent = config.titles[side];
    wireHead(head, side, () => clear(side));
    showHint(side, config.hint[side], config.drop);
  }

  // Stands in for the details of a side that has none yet.
  function showHint(side, title, text) {
    const { card, hint } = panes[side];
    card.hidden = true;
    hint.hidden = false;
    hint.querySelector('strong').textContent = title;
    hint.querySelector('span').textContent = text;
  }

  function renderVerdict() {
    const { left, right } = panes;
    const both = Boolean(left.file && right.file);
    const identical = both && left.file.sha256 === right.file.sha256;
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
    const working = 'Working out the checksum…';
    showHint(side, file.name, working);
    const result = await window.compareApi.hashFile(job, file, (read) => {
      if (pane.job === job) showHint(side, file.name, `${working} ${Math.floor((read / file.size) * 100)}%`);
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
    renderDetails(pane.card, [...result.details, { title: 'Checksum', items: [{ label: 'SHA-256', value: result.sha256 }] }]);
    pane.hint.hidden = true;
    pane.card.hidden = false;
    renderVerdict();
  }

  // The rest is what the top bar and the keyboard ask of the workspace on
  // show; none of it applies here.
  return { kind, root, load, comparing: false, setComparing() {}, sync() {}, goToBlock() {}, swap() {} };
}

const workspaces = { docs: createWorkspace('docs'), sheets: createWorkspace('sheets'), files: createFilesWorkspace() };
// The workspace on show.
let active = workspaces.docs;

function renderCompareButton() {
  compareLabel.textContent = active.comparing ? KINDS[active.kind].edit : 'Compare';
  compareIcon.setAttribute('href', active.comparing ? '#i-edit' : '#i-compare');
}

function activate(kind) {
  active = workspaces[kind];
  for (const workspace of Object.values(workspaces)) workspace.root.hidden = workspace !== active;
  for (const item of sidebarItems) item.setAttribute('aria-current', String(item.dataset.kind === kind));
  for (const control of compareControls) control.hidden = kind === 'files';
  localStorage.setItem('workspace', kind);
  active.sync();
  renderCompareButton();
}

function toggleComparing() {
  active.setComparing(!active.comparing);
  renderCompareButton();
}

// Opens a file on one side of the workspace it belongs in, which need not be
// the one on show: spreadsheets go to theirs, Word documents and PDFs to the
// documents. Plain text stays where it was opened and is read accordingly.
// Among the files everything stays, to be compared as it is.
async function loadFile(side, file) {
  const from = active.kind;
  if (from === 'files') {
    active.load(side, file);
    return;
  }
  const result = await window.compareApi.parseFile(file, { table: from === 'sheets' });
  if (!result.ok) {
    showMessage(`Couldn't open ${file.name}: ${result.error}`);
    return;
  }
  const kind = result.sheets ? 'sheets' : 'docs';
  workspaces[kind].setText(side, result.text, { name: file.name, details: result.details, sheets: result.sheets });
  if (kind !== from) activate(kind);
}

function selectTheme(theme) {
  for (const button of themeButtons) {
    button.setAttribute('aria-checked', String(button.dataset.theme === theme));
  }
}

compareBtn.addEventListener('click', toggleComparing);
$('#swap-btn').addEventListener('click', () => active.swap());

for (const option of [optCase, optSpace, optOnly]) {
  option.addEventListener('change', () => active.sync());
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

document.addEventListener('keydown', (event) => {
  // Ctrl+1, Ctrl+2, Ctrl+3: the workspaces in the order of the sidebar.
  const kind = event.ctrlKey ? Object.keys(workspaces)[Number(event.key) - 1] : undefined;
  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    toggleComparing();
  } else if (event.key === 'F8') {
    event.preventDefault();
    active.goToBlock(event.shiftKey ? -1 : 1);
  } else if (event.ctrlKey && event.key.toLowerCase() === 'b') {
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

activate(Object.hasOwn(workspaces, localStorage.getItem('workspace')) ? localStorage.getItem('workspace') : 'docs');
