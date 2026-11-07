// The code view: two versions of source code compared the way GitHub shows
// the changes of a pull request, split side by side or unified in one
// column. The changes come in hunks with a few lines around them, and the
// lines in between are folded away behind buttons that bring them back, 20
// at a time. The code turns colored once the background process has
// highlighted it.
function createCodeView(root, { onRender } = {}) {
  // Lines each click on a fold brings back.
  const EXPAND_STEP = 20;
  const SIDES = ['left', 'right'];
  // The buttons of a fold: [icon, label].
  const EXPANDERS = {
    up: ['#i-fold-up', 'Expand up'],
    down: ['#i-fold-down', 'Expand down'],
    all: ['#i-unfold', 'Expand all'],
  };
  const NO_EOL =
    '<span class="no-eol" title="No newline at end of file">' +
    '<svg class="icon" aria-label="No newline at end of file"><use href="#i-no-eol" /></svg></span>';

  const nameEl = root.querySelector('.code-name');
  const statEl = root.querySelector('.code-stat');
  const languageEl = root.querySelector('.code-language');
  const expandBtn = root.querySelector('.code-expand');
  const scroller = root.querySelector('.code-scroll');
  const content = root.querySelector('.code-diff');

  // The comparison on show, as CodeDiff.compare() returned it, and the
  // names of the files on each side ('' for pasted code).
  let diff = null;
  let names = { left: '', right: '' };
  // One flag per row: whether it is on show now, and at first.
  let shown = null;
  let initial = null;
  let layout = 'split';
  // Per side, the lines of tokens that color the code (see CodeHtml), or
  // null while it isn't colored; the texts and names they're for; and the
  // name of the language.
  let tokens = { left: null, right: null };
  let coloredFor = null;
  let language = '';
  // Numbers the colorings, so that a late one for other texts is dropped.
  let coloring = 0;
  // The code of both sides colored last, to show again without asking, as
  // when the sides are swapped.
  const colored = [];
  let currentBlock = -1;
  // Find: what is looked for, the ranges that have it and the one gone to.
  let query = '';
  let matches = [];
  let currentMatch = -1;

  content.classList.add(layout);

  const plural = (count, unit) => `${count.toLocaleString()} ${count === 1 ? unit : `${unit}s`}`;

  // highlight.js's colors for a text, as lines of tokens or null.
  async function highlight(text, fileName, wanted) {
    if (text === '') return { language: null, lines: null };
    const cached = colored.find((entry) => entry.text === text && entry.fileName === fileName && entry.wanted === wanted);
    if (cached) return cached.result;
    let reply;
    try {
      reply = await window.compareApi.highlightCode(text, { fileName, language: wanted });
    } catch {
      reply = { ok: false };
    }
    const result = reply.ok && reply.language ? { language: reply.language, name: reply.name, lines: CodeHtml.toLines(reply.html) } : { language: null, lines: null };
    colored.unshift({ text, fileName, wanted, result });
    colored.length = Math.min(colored.length, 2);
    return result;
  }

  // Colors both sides. A side without a file takes the language of the
  // other: code pasted next to an opened file is likely in its language.
  async function color(texts) {
    const job = ++coloring;
    const order = names.right || (!names.left && texts.right) ? ['right', 'left'] : ['left', 'right'];
    const results = {};
    for (const side of order) {
      const first = results[order[0]];
      results[side] = names[side] || !first
        ? await highlight(texts[side], names[side], null)
        : await highlight(texts[side], names[order[0]], first.language);
      if (job !== coloring) return;
    }
    tokens = { left: results.left.lines, right: results.right.lines };
    const { left, right } = { left: results.left.name, right: results.right.name };
    language = left && right && left !== right ? `${left} → ${right}` : right || left || '';
    languageEl.textContent = language;
    if (tokens.left || tokens.right) {
      const place = anchor();
      render();
      restore(place);
    }
  }

  // The line at the top of the view and how far down it is, to keep it in
  // place when the lines around it change.
  function anchor() {
    const box = scroller.getBoundingClientRect();
    const line = document.elementFromPoint(box.left + box.width / 4, box.top + 4)?.closest('.ln');
    return line && content.contains(line) ? { row: line.dataset.row, offset: line.getBoundingClientRect().top - box.top } : null;
  }

  function restore(place) {
    const line = place && content.querySelector(`.ln[data-row="${place.row}"]`);
    if (line) scroller.scrollTop += line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - place.offset;
  }

  // A line of one side as HTML, colored and with its changed words marked.
  function codeHtml(side, line) {
    const html = CodeHtml.lineHtml(line.text, tokens[side]?.[line.num - 1] ?? null, line.segments);
    return line.noEol ? html + NO_EOL : html;
  }

  function rowAttributes(index) {
    const block = diff.blockOf[index];
    return ` data-row="${index}"${block >= 0 ? ` data-block="${block}"` : ''}`;
  }

  // Each row as it is: the original on the left, the changed version on the
  // right, and shaded where a side has no line.
  function splitRows({ start, end }) {
    let html = '';
    for (let i = start; i < end; i++) {
      const row = diff.rows[i];
      html += `<div class="ln"${rowAttributes(i)}>`;
      SIDES.forEach((side, s) => {
        const line = row[side];
        const sideClass = s === 0 ? 'l' : 'r';
        if (!line) {
          html += `<div class="ln-num ${sideClass} empty"></div><div class="ln-code ${sideClass} empty"></div>`;
          return;
        }
        const kind = row.type === 'equal' ? 'ctx' : s === 0 ? 'del' : 'add';
        html += `<div class="ln-num ${sideClass} ${kind}">${line.num}</div>`;
        html += `<div class="ln-code ${sideClass} ${kind}">${codeHtml(side, line)}</div>`;
      });
      html += '</div>';
    }
    return html;
  }

  // The rows in one column: unchanged lines with both their numbers, and of
  // each change the removed lines, then the added ones.
  function unifiedRows({ start, end }) {
    let html = '';
    for (const { row: i, side } of CodeDiff.unified(diff.rows, start, end)) {
      const row = diff.rows[i];
      html += `<div class="ln"${rowAttributes(i)}>`;
      if (!side) {
        html += `<div class="ln-num ctx">${row.left.num}</div><div class="ln-num ctx">${row.right.num}</div>`;
        html += `<div class="ln-code ctx">${codeHtml('right', row.right)}</div>`;
      } else {
        const line = row[side];
        const kind = side === 'left' ? 'del' : 'add';
        const [leftNum, rightNum] = side === 'left' ? [line.num, ''] : ['', line.num];
        html += `<div class="ln-num ${kind}">${leftNum}</div><div class="ln-num ${kind}">${rightNum}</div>`;
        html += `<div class="ln-code ${kind}">${codeHtml(side, line)}</div>`;
      }
      html += '</div>';
    }
    return html;
  }

  // The header of a hunk, with the buttons that bring back the lines folded
  // away before it. A fold at the end of the file has only the buttons.
  function foldRow({ gap, hunk }) {
    const size = gap.end - gap.start;
    if (size === 0 && !hunk) return '';
    let buttons = [];
    if (size > 0) {
      if (gap.start === 0) buttons = ['up'];
      else if (!hunk) buttons = ['down'];
      else if (size <= EXPAND_STEP) buttons = ['all'];
      else buttons = ['down', 'up'];
    }
    const buttonsHtml = buttons
      .map((how) => {
        const [icon, label] = EXPANDERS[how];
        return `<button class="hunk-btn" data-expand="${how}" title="${label}" aria-label="${label}"><svg class="icon" aria-hidden="true"><use href="${icon}" /></svg></button>`;
      })
      .join('');
    const text = hunk ? CodeHtml.escapeHtml(hunk.header) : '';
    return `<div class="hunk${buttons.length > 1 ? ' tall' : ''}" data-start="${gap.start}" data-end="${gap.end}"><div class="hunk-expand">${buttonsHtml}</div><div class="hunk-text">${text}</div></div>`;
  }

  function render() {
    let html = '';
    for (const part of CodeDiff.hunks(diff, shown)) {
      html += foldRow(part);
      if (part.hunk) html += layout === 'split' ? splitRows(part.hunk) : unifiedRows(part.hunk);
    }
    content.innerHTML = html;
    markCurrent();
    renderExpandButton();
    onRender?.();
  }

  const allShown = () => shown.every(Boolean);

  function renderExpandButton() {
    const expanded = allShown() && !initial.every(Boolean);
    const label = expanded ? 'Collapse expanded lines' : 'Expand all lines';
    expandBtn.disabled = initial.every(Boolean);
    expandBtn.title = label;
    expandBtn.setAttribute('aria-label', label);
    expandBtn.setAttribute('aria-pressed', String(expanded));
    expandBtn.querySelector('use').setAttribute('href', expanded ? '#i-fold' : '#i-unfold');
  }

  function renderHead() {
    const { left, right } = names;
    nameEl.textContent = left && right && left !== right ? `${left} → ${right}` : right || left;
    nameEl.title = nameEl.textContent;
    const { additions, deletions } = diff.stats;
    statEl.innerHTML =
      `<span class="code-added">+${additions.toLocaleString()}</span>` +
      `<span class="code-removed">−${deletions.toLocaleString()}</span>` +
      `<span class="code-squares">${CodeDiff.diffstat(diff.stats).map((kind) => `<i class="${kind}"></i>`).join('')}</span>`;
    statEl.title = `${plural(additions, 'line')} added, ${plural(deletions, 'line')} removed`;
    languageEl.textContent = language;
    const lines = Math.max(diff.left.lines.length, diff.right.lines.length, 1);
    content.style.setProperty('--digits', String(String(lines).length));
  }

  // Shows a comparison; `nextNames` are the names of the files on each side.
  function show(nextDiff, nextNames) {
    diff = nextDiff;
    names = nextNames;
    initial = CodeDiff.initialShown(diff);
    shown = initial.slice();
    currentBlock = -1;
    const texts = { left: diff.left.lines.join('\n'), right: diff.right.lines.join('\n') };
    const same =
      coloredFor && SIDES.every((side) => coloredFor.texts[side] === texts[side] && coloredFor.names[side] === names[side]);
    if (!same) {
      coloredFor = { texts, names };
      tokens = { left: null, right: null };
      language = '';
      color(texts);
    }
    renderHead();
    render();
    scroller.scrollTop = 0;
  }

  // 'split' or 'unified'. Returns whether that changed.
  function setLayout(next) {
    if (next === layout) return false;
    content.classList.replace(layout, next);
    layout = next;
    if (diff) {
      const place = anchor();
      render();
      restore(place);
    }
    return true;
  }

  // Brings back folded rows `start` to `end`: the first or last 20 of them
  // ('down' or 'up'), or all.
  function expand(start, end, how, focus) {
    const from = how === 'up' ? Math.max(start, end - EXPAND_STEP) : start;
    const to = how === 'down' ? Math.min(end, start + EXPAND_STEP) : end;
    shown.fill(1, from, to);
    render();
    // The keyboard stays on the fold, if lines are still folded there.
    if (focus && how !== 'all') {
      const fold = how === 'up' ? `[data-start="${start}"]` : `[data-end="${end}"]`;
      content.querySelector(`.hunk${fold} [data-expand="${how}"]`)?.focus();
    }
  }

  function markCurrent() {
    for (const line of content.querySelectorAll('.ln.current')) line.classList.remove('current', 'first', 'last');
    if (currentBlock < 0) return;
    const lines = content.querySelectorAll(`.ln[data-block="${currentBlock}"]`);
    for (const line of lines) line.classList.add('current');
    lines[0]?.classList.add('first');
    lines[lines.length - 1]?.classList.add('last');
  }

  // Goes to a run of differing rows, by its place in diff.blocks.
  function goTo(block) {
    currentBlock = block;
    markCurrent();
    content.querySelector(`.ln[data-block="${block}"]`)?.scrollIntoView({ block: 'center' });
  }

  // Find: in the code on show, not in the folded lines.
  function search(text) {
    query = text;
    currentMatch = -1;
    matches = query ? FindText.ranges(content.querySelectorAll('.ln-code'), query) : [];
    FindText.paint(matches, currentMatch);
    return matches.length;
  }

  function goToMatch(index) {
    currentMatch = index;
    FindText.paint(matches, index);
    matches[index].startContainer.parentElement.closest('.ln').scrollIntoView({ block: 'center' });
  }

  const searchState = () => ({ index: currentMatch, count: matches.length });

  // What an export of the comparison needs: the rows on show, how they're
  // laid out, and how they're colored.
  const exportState = () => ({ shown, layout, tokens, language });

  function clear() {
    diff = null;
    shown = null;
    initial = null;
    coloring++;
    coloredFor = null;
    tokens = { left: null, right: null };
    language = '';
    currentBlock = -1;
    query = '';
    matches = [];
    currentMatch = -1;
    content.replaceChildren();
    nameEl.textContent = '';
    statEl.replaceChildren();
    languageEl.textContent = '';
  }

  content.addEventListener('click', (event) => {
    const button = event.target.closest('.hunk-btn');
    if (!button) return;
    const { start, end } = button.closest('.hunk').dataset;
    expand(Number(start), Number(end), button.dataset.expand, event.detail === 0);
  });

  // Selecting text in one side of the split view leaves the other alone, so
  // that the code of one version can be copied.
  content.addEventListener('mousedown', (event) => {
    const cell = event.target.closest?.('.ln-code');
    content.dataset.select = cell?.classList.contains('l') ? 'l' : cell?.classList.contains('r') ? 'r' : '';
  });

  expandBtn.addEventListener('click', () => {
    if (!diff) return;
    const place = anchor();
    shown = allShown() ? initial.slice() : new Uint8Array(shown.length).fill(1);
    render();
    restore(place);
  });

  return { show, setLayout, goTo, clear, search, goToMatch, searchState, exportState };
}
