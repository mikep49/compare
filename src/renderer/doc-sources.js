// The documents the document view shows, laid out as pages: Word files with
// docx-preview, PDFs with pdf.js and anything else as a page of plain text.
// Both libraries are loaded the first time they're needed.
//
// DocSources.open() returns a source:
// - el: the element that holds its pages.
// - model: its text as { text, runStarts, runEnds }. The runs are the text
//   nodes it is shown in, in order; text between runs separates blocks.
// - width(): its widest page in CSS pixels at 100%, once el is on the page.
// - node(run): the text node of a run, or null while its page isn't laid out.
// - pageOf(run): the page a run is on, for sources that lay out pages as
//   they come into view; -1 for the others.
// - rect(run, offset): where a place in a run is on screen, or null.
// - attach(scroller, onPage): starts laying out pages as they come into view
//   in `scroller`, calling onPage(index) as each one is ready.
// - setZoom(zoom, redraw): draws pages for the zoom they're shown at.
// - destroy()
const DocSources = (() => {
  const LIBS = new URL('../../node_modules/', location.href).href;
  // CSS pixels per PDF point: pages are shown at their printed size at 100%.
  const CSS_UNITS = 96 / 72;
  // A page of plain text is as wide as a Letter page.
  const TEXT_PAGE_WIDTH = 816;
  // PDF pages kept drawn out of view, and the largest canvas drawn for one.
  const MAX_CANVASES = 12;
  const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
  // Elements that start a new block of text in a Word document.
  const BLOCKS = new Set([
    'ARTICLE', 'BR', 'DIV', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'OL', 'P', 'SECTION',
    'TABLE', 'TD', 'TH', 'TR', 'UL',
  ]);

  function element(className) {
    const el = document.createElement('div');
    el.className = className;
    return el;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${src} couldn't be loaded.`));
      document.head.append(script);
    });
  }

  let docxLibrary = null;
  function loadDocx() {
    docxLibrary ??= loadScript(`${LIBS}jszip/dist/jszip.min.js`)
      .then(() => loadScript(`${LIBS}docx-preview/dist/docx-preview.min.js`))
      .then(() => window.docx);
    return docxLibrary;
  }

  let pdfLibrary = null;
  function loadPdf() {
    pdfLibrary ??= import(`${LIBS}pdfjs-dist/build/pdf.min.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${LIBS}pdfjs-dist/build/pdf.worker.min.mjs`;
      return pdfjs;
    });
    return pdfLibrary;
  }

  // pdf.js reads the fonts and character maps PDFs leave out with
  // XMLHttpRequest, which can't open files; fetch() can.
  class FileDataFactory {
    constructor(urls) {
      this.urls = urls;
    }

    async fetch({ kind, filename }) {
      const response = await fetch(`${this.urls[kind]}${filename}`);
      if (!response.ok && response.status !== 0) throw new Error(`Unable to load ${filename}`);
      return new Uint8Array(await response.arrayBuffer());
    }
  }

  // Collects a document's text, run by run.
  function modelBuilder() {
    let text = '';
    const starts = [];
    const ends = [];
    const refs = [];
    return {
      add(str, ref) {
        starts.push(text.length);
        text += str;
        ends.push(text.length);
        refs.push(ref);
      },
      gap(separator) {
        text += separator;
      },
      done: () => ({ model: { text, runStarts: Int32Array.from(starts), runEnds: Int32Array.from(ends) }, refs }),
    };
  }

  // Where a place in a text node is on screen, or null when it isn't shown.
  function placeRect(node, offset) {
    if (!node.isConnected) return null;
    const at = Math.min(Math.max(0, offset), node.length);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, Math.min(node.length, at + 1));
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0 ? null : rect;
  }

  function textSource(text) {
    const el = element('doc-doc');
    const page = element('doc-page doc-text-page');
    const node = document.createTextNode(text);
    page.append(node);
    el.append(page);
    return {
      el,
      model: { text, runStarts: Int32Array.of(0), runEnds: Int32Array.of(text.length) },
      width: () => TEXT_PAGE_WIDTH,
      node: () => node,
      pageOf: () => -1,
      rect: (_run, offset) => placeRect(node, offset),
      attach() {},
      setZoom() {},
      destroy() {},
    };
  }

  // The text of the elements under `root`, with a line break between
  // blocks, and its text nodes.
  function domModel(root) {
    const builder = modelBuilder();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let newBlock = false;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType !== Node.TEXT_NODE) {
        if (BLOCKS.has(node.tagName)) newBlock = true;
        continue;
      }
      if (node.data === '') continue;
      if (newBlock) builder.gap('\n');
      newBlock = false;
      builder.add(node.data, node);
    }
    return builder.done();
  }

  // Each document gets class names of its own: docx-preview turns the
  // styles of a document into CSS rules for them.
  let docxCount = 0;

  async function docxSource(bytes) {
    const docx = await loadDocx();
    // The CSS docx-preview writes goes into style sheets of their own, as
    // the page's Content-Security-Policy doesn't allow <style> elements.
    const css = [];
    const h = (spec) => {
      if (spec?.tagName === 'style') {
        css.push(spec.children.join(''));
        return document.createComment('');
      }
      return docx.defaultOptions.h(spec);
    };
    const options = {
      className: `docx-${++docxCount}`,
      inWrapper: false,
      // Breaks pages where Word last did, not just at manual page breaks.
      ignoreLastRenderedPageBreak: false,
      // Data URLs, unlike blob URLs, go away with the document.
      useBase64URL: true,
      renderComments: false,
      h,
    };
    const parsed = await docx.parseAsync(bytes, options);
    const nodes = await docx.renderDocument(parsed, options);
    const el = element('doc-doc');
    el.append(...nodes);
    const pages = [...el.querySelectorAll(':scope > section')];
    for (const page of pages) page.classList.add('doc-page');
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css.join('\n'));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const { model, refs } = domModel(el);
    return {
      el,
      model,
      width: () => Math.max(0, ...pages.map((page) => page.offsetWidth)),
      node: (run) => refs[run] ?? null,
      pageOf: () => -1,
      rect: (run, offset) => (refs[run] ? placeRect(refs[run], offset) : null),
      attach() {},
      setZoom() {},
      destroy() {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((other) => other !== sheet);
      },
    };
  }

  // Pages are laid out as they come into view: their text first, in a
  // pdf.js text layer over the page, then a canvas with the page drawn at
  // the zoom it's shown at. Only the last few pages drawn keep their canvas.
  async function pdfSource(bytes, onProgress) {
    const pdfjs = await loadPdf();
    const task = pdfjs.getDocument({
      // pdf.js takes the bytes over; the file keeps its own.
      data: bytes.slice(),
      isEvalSupported: false,
      BinaryDataFactory: FileDataFactory,
      cMapUrl: `${LIBS}pdfjs-dist/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${LIBS}pdfjs-dist/standard_fonts/`,
      wasmUrl: `${LIBS}pdfjs-dist/wasm/`,
      verbosity: 0,
    });
    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      task.destroy();
      throw error;
    }

    const el = element('doc-doc');
    const pages = [];
    const builder = modelBuilder();
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        onProgress?.(n, doc.numPages);
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: CSS_UNITS });
        // Read as parse-file.js reads it, so that the two texts line up.
        const content = await page.getTextContent();
        const index = n - 1;
        const items = content.items.map((item, i) => {
          builder.add(item.str, { page: index, item: i });
          if (item.hasEOL) builder.gap('\n');
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(transform[2], transform[3]);
          return { left: transform[4], top: transform[5] - height, height, width: item.width * CSS_UNITS, length: item.str.length };
        });
        builder.gap('\n\n');
        const pageEl = element('doc-page doc-pdf-page');
        pageEl.style.width = `${viewport.width}px`;
        pageEl.style.height = `${viewport.height}px`;
        pageEl.dataset.page = index;
        el.append(pageEl);
        pages.push({ index, page, viewport, content, items, el: pageEl, layer: null, ready: false, canvas: null, drawn: 0, task: null, visible: false });
      }
    } catch (error) {
      task.destroy();
      throw error;
    }
    const { model, refs } = builder.done();

    let zoom = 1;
    let observer = null;
    let onPage = null;
    // Pages with a canvas, the one drawn first first.
    const drawn = [];

    function dropCanvas(page) {
      if (!page.canvas) return;
      page.canvas.width = page.canvas.height = 0;
      page.canvas.remove();
      page.canvas = null;
      page.drawn = 0;
    }

    function draw(page) {
      if (page.drawn === zoom && page.canvas) return;
      if (page.task && page.task.zoom === zoom) return;
      page.task?.cancel();
      const fits = Math.sqrt(MAX_CANVAS_PIXELS / (page.viewport.width * page.viewport.height));
      const scale = Math.min(zoom * (window.devicePixelRatio || 1), fits);
      const viewport = page.page.getViewport({ scale: CSS_UNITS * scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const renderTask = page.page.render({ canvasContext: canvas.getContext('2d'), viewport });
      const zoomDrawn = zoom;
      page.task = { zoom: zoomDrawn, cancel: () => renderTask.cancel() };
      const task = page.task;
      renderTask.promise.then(
        () => {
          if (page.task !== task) return;
          page.task = null;
          // The new canvas takes over from the old one only once it's drawn.
          dropCanvas(page);
          page.el.prepend(canvas);
          page.canvas = canvas;
          page.drawn = zoomDrawn;
          const at = drawn.indexOf(page);
          if (at >= 0) drawn.splice(at, 1);
          drawn.push(page);
          for (let i = 0; drawn.length > MAX_CANVASES && i < drawn.length; ) {
            if (drawn[i].visible) i++;
            else dropCanvas(drawn.splice(i, 1)[0]);
          }
        },
        () => {
          // Cancelled for a newer drawing, or the page couldn't be drawn.
          if (page.task === task) page.task = null;
        }
      );
    }

    async function show(page) {
      if (!page.layer) {
        const layerEl = element('textLayer');
        page.el.append(layerEl);
        page.layer = new pdfjs.TextLayer({ textContentSource: page.content, container: layerEl, viewport: page.viewport });
        try {
          await page.layer.render();
          page.ready = true;
        } catch {
          // Without its text the page can still be seen, just not marked.
        }
        page.content = null;
        if (page.ready) onPage?.(page.index);
      }
      if (page.visible) draw(page);
    }

    const node = (run) => {
      const ref = refs[run];
      const page = ref && pages[ref.page];
      return page?.ready ? (page.layer.textDivs[ref.item]?.firstChild ?? null) : null;
    };

    return {
      el,
      model,
      width: () => Math.max(0, ...pages.map((page) => page.viewport.width)),
      node,
      pageOf: (run) => refs[run]?.page ?? -1,
      rect(run, offset) {
        const text = node(run);
        if (text) return placeRect(text, offset);
        // Not laid out yet: where pdf.js says the text is on the page.
        const ref = refs[run];
        if (!ref) return null;
        const page = pages[ref.page];
        const item = page.items[ref.item];
        const box = page.el.getBoundingClientRect();
        const scale = box.width / page.viewport.width;
        const x = item.length > 0 ? (item.width * Math.min(offset, item.length)) / item.length : 0;
        const top = box.top + item.top * scale;
        const left = box.left + (item.left + x) * scale;
        return { top, bottom: top + item.height * scale, left, right: left, width: 0, height: item.height * scale };
      },
      attach(scroller, callback) {
        onPage = callback;
        observer?.disconnect();
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const page = pages[entry.target.dataset.page];
              page.visible = entry.isIntersecting;
              if (page.visible) show(page);
            }
          },
          { root: scroller, rootMargin: '50% 0px' }
        );
        for (const page of pages) observer.observe(page.el);
      },
      setZoom(value, redraw = false) {
        zoom = value;
        for (const page of pages) {
          if (redraw) {
            page.drawn = 0;
            page.task?.cancel();
            page.task = null;
          }
          // Pages whose text couldn't be laid out are still drawn.
          if (page.visible && page.layer) draw(page);
        }
      },
      destroy() {
        observer?.disconnect();
        for (const page of pages) {
          page.task?.cancel();
          page.layer?.cancel();
          dropCanvas(page);
        }
        task.destroy();
      },
    };
  }

  // `input` is { kind, bytes } for a Word file or PDF ('docx', 'pdf'), else
  // { text }. `onProgress(page, pages)` follows the reading of a PDF.
  function open(input, onProgress) {
    if (input.kind === 'docx') return docxSource(input.bytes);
    if (input.kind === 'pdf') return pdfSource(input.bytes, onProgress);
    return Promise.resolve(textSource(input.text));
  }

  return { open };
})();
