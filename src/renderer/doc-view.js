// The document view: the two documents of a comparison side by side as
// they look, pages and all, with the changes the comparison found marked on
// them. Built in a .doc-view element; app.js shows it instead of the lines
// of text. Each side scrolls on its own and, with "Scroll together" on, the
// other side keeps the same place in view.
function createDocView(root, { onFindChange } = {}) {
  const SIDES = ['left', 'right'];
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const MIN_ZOOM = ZOOM_STEPS[0];
  const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
  // Must match the padding of .doc-pages in styles.css.
  const PAGE_GAP = 16;
  // How far down the view a change is put when going to it.
  const REVEAL_AT = 0.3;
  // Pairs of places kept for scrolling together; more only take longer.
  const MAX_SYNC_POINTS = 4000;
  const MAX_MATCHES = 100000;
  // The highlights this view paints, in the order they're painted in.
  // doc-current is the run of differences gone to last.
  const LAYERS = ['doc-removed', 'doc-added', 'doc-current', 'find', 'find-current'];

  const zoomLabel = root.querySelector('.doc-zoom-level');
  const syncButton = root.querySelector('.doc-sync');

  const sides = {};
  for (const name of SIDES) {
    const pane = root.querySelector(`.doc-pane[data-side="${name}"]`);
    sides[name] = {
      name,
      scroller: pane.querySelector('.doc-scroll'),
      content: pane.querySelector('.doc-content'),
      pagesEl: pane.querySelector('.doc-pages'),
      marksEl: pane.querySelector('.doc-marks'),
      statusEl: pane.querySelector('.doc-status'),
      // The document on show, as open() made it.
      entry: null,
      // The text that was compared, and how it lines up with the document.
      text: '',
      aligner: null,
      alignedWith: null,
      alignedText: null,
      // The changes marked on this side, as pieces of runs of the document
      // (see DocAlign.pieces) with their block, also by block.
      changes: [],
      byBlock: new Map(),
      // Per block, the place in the document's text to show for it.
      anchors: [],
      // Pieces of the find matches on this side.
      found: [],
      // Where this side was scrolled to by the other, so that the scroll
      // isn't passed back.
      expected: null,
    };
  }
  const other = (side) => (side === sides.left ? sides.right : sides.left);
  const sourceOf = (side) => side.entry?.source ?? null;

  // Bumped on every show(), so that documents that finish opening late
  // don't apply to a newer comparison.
  let generation = 0;
  let rows = null;
  let current = -1;
  // The block to go to once the documents are open.
  let pending = -1;
  let query = '';
  // [{ side, pieces, offset }], left side first.
  let matches = [];
  let currentMatch = -1;
  let zoom = 1;
  let fit = true;
  let pixelRatio = window.devicePixelRatio;
  let redrawTimer = null;
  // Off unless turned on, so that the mouse wheel scrolls only the
  // document it's over.
  let syncOn = false;
  try {
    syncOn = localStorage.getItem('docScrollTogether') === 'on';
  } catch {
    // Scrolling on their own is the default.
  }
  // Pairs of places in the two documents' texts that go together, and the
  // same as scroll positions, worked out when first needed.
  let syncPairs = [];
  let syncTable = null;
  // The highlights last painted, by name.
  const painted = new Map();

  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  function setStatus(side, kind, text) {
    side.statusEl.hidden = !kind;
    side.statusEl.dataset.kind = kind || '';
    side.statusEl.querySelector('.doc-status-text').textContent = text || '';
  }

  function rangeOf(side, piece) {
    if (piece.range) return piece.range;
    const node = sourceOf(side)?.node(piece.run);
    if (!node) return null;
    const range = new Range();
    range.setStart(node, Math.min(piece.start, node.length));
    range.setEnd(node, Math.min(piece.end, node.length));
    piece.range = range;
    return range;
  }

  // The pieces each highlight is made of, as [side, pieces] pairs.
  function layer(name) {
    if (name === 'doc-removed') return [[sides.left, sides.left.changes]];
    if (name === 'doc-added') return [[sides.right, sides.right.changes]];
    if (name === 'doc-current') return SIDES.map((key) => [sides[key], sides[key].byBlock.get(current) ?? []]);
    if (name === 'find') return SIDES.map((key) => [sides[key], sides[key].found]);
    const match = matches[currentMatch];
    return match ? [[sides[match.side], match.pieces]] : [];
  }

  function paint(name) {
    const highlight = new Highlight();
    highlight.priority = LAYERS.indexOf(name);
    for (const [side, pieces] of layer(name)) {
      for (const piece of pieces) {
        const range = rangeOf(side, piece);
        if (range) highlight.add(range);
      }
    }
    painted.set(name, highlight);
    CSS.highlights.set(name, highlight);
  }

  // Adds what's on a page that was just laid out to the highlights.
  function paintPage(side, page) {
    for (const name of LAYERS) {
      const highlight = painted.get(name);
      if (!highlight || CSS.highlights.get(name) !== highlight) continue;
      for (const [owner, pieces] of layer(name)) {
        if (owner !== side) continue;
        for (const piece of pieces) {
          if (piece.page !== page) continue;
          const range = rangeOf(side, piece);
          if (range) highlight.add(range);
        }
      }
    }
  }

  // Where a place in a side's document is, in the coordinates of its
  // scrolling content: { top, left, height }, or null.
  function place(side, offset, base = side.scroller.getBoundingClientRect()) {
    const source = sourceOf(side);
    if (!source || offset === undefined) return null;
    const { model } = source;
    const run = DocAlign.runAt(offset, model);
    const rect = source.rect(run, offset - model.runStarts[run]);
    if (!rect) return null;
    return {
      top: rect.top - base.top + side.scroller.scrollTop,
      left: rect.left - base.left + side.scroller.scrollLeft,
      height: rect.height,
    };
  }

  function scrollSide(side, top, left = side.scroller.scrollLeft) {
    const { scroller } = side;
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
    side.expected = { top: scroller.scrollTop, left: scroller.scrollLeft };
  }

  // Scrolls a side so that a place is in view, `at` of the way down.
  function reveal(side, spot, at) {
    if (!spot) return;
    const { scroller } = side;
    let left = scroller.scrollLeft;
    if (spot.left < left || spot.left > left + scroller.clientWidth - 24) left = spot.left - scroller.clientWidth / 3;
    scrollSide(side, spot.top - scroller.clientHeight * at, left);
  }

  // Scroll positions that go together, from the pairs of places in the
  // texts: each side's list only ever goes down. Places that would make it
  // go back up, such as a footnote read in among the text, are left out.
  function buildSyncTable() {
    const { left, right } = sides;
    const leftBase = left.scroller.getBoundingClientRect();
    const rightBase = right.scroller.getBoundingClientRect();
    const spots = [];
    const stride = Math.max(1, Math.ceil(syncPairs.length / MAX_SYNC_POINTS));
    for (let i = 0; i < syncPairs.length; i += stride) {
      const a = place(left, syncPairs[i][0], leftBase);
      const b = place(right, syncPairs[i][1], rightBase);
      if (a && b) spots.push([a.top, b.top]);
    }
    const table = { left: [0], right: [0] };
    for (let i = 0; i < spots.length; i++) {
      const [a, b] = spots[i];
      const next = spots[i + 1];
      // A lone place out of step with the next one is likely misplaced.
      if (next && (a > next[0] || b > next[1])) continue;
      if (a < table.left.at(-1) || b < table.right.at(-1)) continue;
      table.left.push(a);
      table.right.push(b);
    }
    table.left.push(Math.max(table.left.at(-1), left.scroller.scrollHeight));
    table.right.push(Math.max(table.right.at(-1), right.scroller.scrollHeight));
    return table;
  }

  // The scroll position on side `to` that goes with `y` on side `from`.
  function mapY(from, to, y) {
    syncTable ??= buildSyncTable();
    const a = syncTable[from.name];
    const b = syncTable[to.name];
    let low = 0;
    let high = a.length - 1;
    while (low < high - 1) {
      const mid = (low + high) >>> 1;
      if (a[mid] <= y) low = mid;
      else high = mid;
    }
    const span = a[high] - a[low];
    const t = span > 0 ? Math.min(1, Math.max(0, (y - a[low]) / span)) : 0;
    return b[low] + t * (b[high] - b[low]);
  }

  const bothOpen = () => SIDES.every((name) => sourceOf(sides[name]));

  // Brings the other side to the place that goes with what's in the middle
  // of this one.
  function follow(side) {
    if (!syncOn || !bothOpen()) return;
    const to = other(side);
    const middle = side.scroller.scrollTop + side.scroller.clientHeight / 2;
    scrollSide(to, mapY(side, to, middle) - to.scroller.clientHeight / 2, side.scroller.scrollLeft);
  }

  function onScroll(side) {
    const { scroller, expected } = side;
    side.expected = null;
    if (expected && Math.abs(scroller.scrollTop - expected.top) < 2 && Math.abs(scroller.scrollLeft - expected.left) < 2) {
      return;
    }
    follow(side);
  }

  // Marks the run of differences gone to last: a bar in the margin of each
  // page it's on, from its first line to its last, or, on a side that has
  // nothing of it, a caret where the other side's text goes in.
  function renderMarks() {
    for (const name of SIDES) {
      const side = sides[name];
      side.marksEl.replaceChildren();
      if (current < 0 || !sourceOf(side) || root.hidden) continue;
      const base = side.content.getBoundingClientRect();
      const pieces = side.byBlock.get(current) ?? [];
      // How far down each page it goes.
      const spans = new Map();
      for (const piece of pieces) {
        const range = rangeOf(side, piece);
        const page = range?.startContainer.parentElement?.closest('.doc-page');
        if (!page) continue;
        for (const rect of range.getClientRects()) {
          if (rect.width === 0 || rect.height === 0) continue;
          const span = spans.get(page);
          if (span) {
            span.top = Math.min(span.top, rect.top);
            span.bottom = Math.max(span.bottom, rect.bottom);
          } else {
            spans.set(page, { top: rect.top, bottom: rect.bottom });
          }
        }
      }
      const marks = [...spans].map(([page, span]) => {
        const box = page.getBoundingClientRect();
        const mark = document.createElement('div');
        mark.className = 'doc-mark';
        // In the page's margin, a little way in from its edge.
        mark.style.left = `${box.left - base.left + Math.max(4, box.width * 0.025)}px`;
        mark.style.top = `${span.top - base.top - 2}px`;
        mark.style.height = `${span.bottom - span.top + 4}px`;
        return mark;
      });
      if (pieces.length === 0) {
        // The content scrolls in the scroller from its top left corner.
        const spot = place(side, side.anchors[current]);
        if (spot) {
          const caret = document.createElement('div');
          caret.className = 'doc-mark caret';
          caret.style.left = `${spot.left - 1}px`;
          caret.style.top = `${spot.top}px`;
          caret.style.height = `${Math.max(spot.height, 12)}px`;
          marks.push(caret);
        }
      }
      side.marksEl.append(...marks);
    }
  }

  function renderZoom() {
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    zoomLabel.setAttribute('aria-pressed', String(fit));
    zoomLabel.title = fit ? 'Fitted to the width of the pages' : 'Fit the pages to the width';
    syncButton.title = 'Scroll both documents together';
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
    syncTable = null;
    renderZoom();
    renderMarks();
    // Pages are drawn anew once the zoom settles.
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      for (const name of SIDES) sourceOf(sides[name])?.setZoom(zoom);
    }, 150);
  }

  // Fits the widest page of either side into the narrower side.
  function fitZoom() {
    if (!fit) return;
    const widths = SIDES.map((name) => sourceOf(sides[name])?.width() ?? 0).filter((width) => width > 0);
    const room = Math.min(...SIDES.map((name) => sides[name].scroller.clientWidth));
    if (widths.length === 0 || room <= 0) return;
    setZoom(room / (Math.max(...widths) + 2 * PAGE_GAP));
  }

  function stepZoom(direction) {
    fit = false;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? MAX_ZOOM)
        : (ZOOM_STEPS.findLast((step) => step < zoom - 0.001) ?? MIN_ZOOM);
    setZoom(next);
  }

  // Works out what the comparison marks on a side's document.
  function markChanges(side) {
    side.changes = [];
    side.byBlock = new Map();
    side.anchors = [];
    const source = sourceOf(side);
    if (!source || !rows) return;
    if (side.alignedWith !== source || side.alignedText !== side.text) {
      side.aligner = DocAlign.align(side.text, source.model.text);
      side.alignedWith = source;
      side.alignedText = side.text;
    }
    const { ranges, anchors } = DocAlign.changes(rows, side.text, side.name);
    for (const { start, end, block } of ranges) {
      for (const [from, to] of side.aligner.ranges(start, end)) {
        DocAlign.pieces(from, to, source.model, side.changes, { block });
      }
    }
    for (const piece of side.changes) {
      piece.page = source.pageOf(piece.run);
      if (!side.byBlock.has(piece.block)) side.byBlock.set(piece.block, []);
      side.byBlock.get(piece.block).push(piece);
    }
    side.anchors = anchors.map((offset) => side.aligner.point(offset));
  }

  function findMatches() {
    matches = [];
    currentMatch = -1;
    for (const name of SIDES) {
      const side = sides[name];
      side.found = [];
      const source = sourceOf(side);
      if (!query || !source) continue;
      const pattern = new RegExp(escapeRegExp(query), 'giu');
      for (const match of source.model.text.matchAll(pattern)) {
        if (matches.length >= MAX_MATCHES) break;
        const pieces = DocAlign.pieces(match.index, match.index + match[0].length, source.model, []);
        if (pieces.length === 0) continue;
        for (const piece of pieces) piece.page = source.pageOf(piece.run);
        matches.push({ side: name, pieces, offset: match.index });
        side.found.push(...pieces);
      }
    }
  }

  // Puts a side's document in place once it's open, or says why it isn't.
  function settle(side) {
    const { entry } = side;
    if (entry.error) {
      side.pagesEl.replaceChildren();
      setStatus(side, 'error', `${entry.name} can't be shown as a document: ${entry.error.message}`);
      return;
    }
    setStatus(side, null);
    if (entry.placedIn === side) return;
    entry.placedIn = side;
    side.pagesEl.replaceChildren(entry.source.el);
    entry.source.attach(side.scroller, (page) => {
      // The entry may have moved to the other side since.
      const owner = SIDES.map((name) => sides[name]).find((candidate) => candidate.entry === entry);
      if (!owner) return;
      paintPage(owner, page);
      if (current >= 0) renderMarks();
    });
    entry.source.setZoom(zoom);
  }

  // Brings everything up to date once a document has opened.
  function refresh() {
    for (const name of SIDES) markChanges(sides[name]);
    if (bothOpen()) {
      const points = DocAlign.syncPoints(rows ?? [], sides.left.text, sides.right.text);
      syncPairs = points.map(([a, b]) => [sides.left.aligner.point(a), sides.right.aligner.point(b)]);
    } else {
      syncPairs = [];
    }
    syncTable = null;
    fitZoom();
    paint('doc-removed');
    paint('doc-added');
    paint('doc-current');
    if (query) {
      findMatches();
      paint('find');
      paint('find-current');
      onFindChange?.();
    }
    if (pending >= 0 && SIDES.every((name) => sides[name].entry.source || sides[name].entry.error)) {
      const block = pending;
      pending = -1;
      goTo(block);
    } else {
      renderMarks();
    }
  }

  // Starts opening a document. Returns its entry: `source` once it's open,
  // or `error`; `promise` settles then. `placedIn` is the side whose pages
  // hold it, and `dropped` is set once it's no longer wanted.
  function open(input) {
    const entry = { key: input.key, name: input.name, source: null, error: null, dropped: false, placedIn: null };
    entry.promise = DocSources.open(input, (page, pages) => {
      const owner = SIDES.map((name) => sides[name]).find((candidate) => candidate.entry === entry);
      if (owner && pages > 1) setStatus(owner, 'loading', `Reading ${input.name}: page ${page} of ${pages}…`);
    }).then(
      (source) => {
        if (entry.dropped) source.destroy();
        else entry.source = source;
      },
      (error) => {
        entry.error = error;
      }
    );
    return entry;
  }

  // Shows the documents of a comparison: `inputs` has, per side, what
  // DocSources.open() takes plus `key`, which stays the same while the
  // document does, `name` and the `text` that was compared. `nextRows` are
  // those of DiffEngine.compare().
  function show(inputs, nextRows) {
    const run = ++generation;
    rows = nextRows;
    current = -1;
    pending = -1;
    // Documents already open are kept, even when they swapped sides.
    const previous = SIDES.map((name) => sides[name].entry).filter(Boolean);
    for (const name of SIDES) {
      const side = sides[name];
      const input = inputs[name];
      side.text = input.text;
      const kept = previous.find((entry) => entry.key === input.key);
      if (kept) {
        previous.splice(previous.indexOf(kept), 1);
        side.entry = kept;
        if (!kept.source && !kept.error) setStatus(side, 'loading', `Opening ${kept.name}…`);
      } else {
        side.entry = open(input);
        side.pagesEl.replaceChildren();
        setStatus(side, input.kind ? 'loading' : null, input.kind ? `Opening ${input.name}…` : '');
      }
    }
    for (const entry of previous) {
      entry.dropped = true;
      entry.source?.destroy();
    }
    for (const name of SIDES) {
      const side = sides[name];
      const { entry } = side;
      if (entry.source || entry.error) {
        settle(side);
        continue;
      }
      entry.promise.then(() => {
        if (run !== generation || side.entry !== entry) return;
        settle(side);
        refresh();
      });
    }
    refresh();
  }

  function goTo(block) {
    current = block;
    if (!SIDES.every((name) => sides[name].entry?.source || sides[name].entry?.error)) {
      pending = block;
      return;
    }
    for (const name of SIDES) {
      const side = sides[name];
      reveal(side, place(side, side.anchors[block]), REVEAL_AT);
    }
    paint('doc-current');
    renderMarks();
  }

  // Looks for `text`, whatever its case, in both documents, and returns how
  // many matches there are.
  function search(text) {
    query = text;
    findMatches();
    paint('find');
    paint('find-current');
    return matches.length;
  }

  function goToMatch(index) {
    currentMatch = index;
    paint('find-current');
    const match = matches[index];
    if (!match) return;
    const side = sides[match.side];
    const spot = place(side, match.offset);
    const { scrollTop, clientHeight } = side.scroller;
    if (spot && (spot.top < scrollTop + 24 || spot.top + spot.height > scrollTop + clientHeight - 96)) {
      reveal(side, spot, 0.4);
      follow(side);
    }
  }

  const searchState = () => ({ index: currentMatch, count: matches.length });

  // Takes the marks off; the documents stay open for the next comparison.
  function clear() {
    generation++;
    rows = null;
    current = -1;
    pending = -1;
    query = '';
    matches = [];
    currentMatch = -1;
    for (const name of SIDES) {
      Object.assign(sides[name], { changes: [], byBlock: new Map(), anchors: [], found: [] });
      sides[name].marksEl.replaceChildren();
    }
    for (const [name, highlight] of painted) {
      if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name);
    }
    painted.clear();
  }

  for (const name of SIDES) {
    const side = sides[name];
    side.scroller.addEventListener('scroll', () => onScroll(side), { passive: true });
  }

  root.querySelector('.doc-zoom-in').addEventListener('click', () => stepZoom(1));
  root.querySelector('.doc-zoom-out').addEventListener('click', () => stepZoom(-1));
  zoomLabel.addEventListener('click', () => {
    fit = true;
    fitZoom();
    renderZoom();
  });
  syncButton.addEventListener('click', () => {
    syncOn = !syncOn;
    try {
      localStorage.setItem('docScrollTogether', syncOn ? 'on' : 'off');
    } catch {
      // Remembering it is a convenience only.
    }
    renderZoom();
    // Lines the right side up with the left straight away.
    if (syncOn) follow(sides.left);
  });

  new ResizeObserver(() => {
    if (root.hidden || root.clientWidth === 0) return;
    // Moved to another screen, or the window zoomed: pages are drawn anew.
    if (window.devicePixelRatio !== pixelRatio) {
      pixelRatio = window.devicePixelRatio;
      for (const name of SIDES) sourceOf(sides[name])?.setZoom(zoom, true);
    }
    fitZoom();
    syncTable = null;
    renderMarks();
  }).observe(root);

  renderZoom();

  return {
    show,
    clear,
    goTo,
    search,
    goToMatch,
    searchState,
    // Zooms a step in (1) or out (-1), as Ctrl and the mouse wheel do.
    zoomStep: stepZoom,
  };
}
