// Turns two texts into aligned side-by-side rows with word-level highlights.
// Loaded as a plain script in the renderer and via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('diff'));
  } else {
    root.DiffEngine = factory(root.Diff);
  }
})(typeof self !== 'undefined' ? self : this, function (Diff) {
  // Below this share of common words, two lines are treated as unrelated and
  // highlighted whole instead of word by word.
  const MIN_SIMILARITY = 0.3;

  const TOKEN_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

  function splitLines(text) {
    if (text === '') return [];
    const lines = text.split(/\r\n|\r|\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  function lineKey(line, opts) {
    let key = line;
    if (opts.ignoreWhitespace) key = key.trim().replace(/\s+/g, ' ');
    if (opts.ignoreCase) key = key.toLowerCase();
    return key;
  }

  // Runs a diff over two key arrays and returns, per side, which indexes have
  // no counterpart on the other side.
  function changedFlags(leftKeys, rightKeys) {
    const left = new Array(leftKeys.length).fill(false);
    const right = new Array(rightKeys.length).fill(false);
    let l = 0;
    let r = 0;
    for (const part of Diff.diffArrays(leftKeys, rightKeys)) {
      if (part.removed) {
        for (let i = 0; i < part.count; i++) left[l++] = true;
      } else if (part.added) {
        for (let i = 0; i < part.count; i++) right[r++] = true;
      } else {
        l += part.count;
        r += part.count;
      }
    }
    return { left, right };
  }

  function toSegments(tokens, flags) {
    const segments = [];
    for (let i = 0; i < tokens.length; i++) {
      const last = segments[segments.length - 1];
      if (last && last.changed === flags[i]) last.text += tokens[i];
      else segments.push({ text: tokens[i], changed: flags[i] });
    }
    return segments;
  }

  function plain(text) {
    return text === '' ? [] : [{ text, changed: false }];
  }

  function whole(text) {
    return text === '' ? [] : [{ text, changed: true }];
  }

  function diffWords(leftLine, rightLine, opts) {
    const sides = [leftLine, rightLine].map((line) => {
      const tokens = line.match(TOKEN_RE) || [];
      // Indexes of the tokens that take part in the comparison.
      const compared = [];
      tokens.forEach((token, i) => {
        if (!(opts.ignoreWhitespace && /^\s/.test(token))) compared.push(i);
      });
      const keys = compared.map((i) => (opts.ignoreCase ? tokens[i].toLowerCase() : tokens[i]));
      return { tokens, compared, keys };
    });

    const flags = changedFlags(sides[0].keys, sides[1].keys);
    const words = (side) => side.keys.filter((key) => !/^\s/.test(key)).length;
    const commonWords = (side, sideFlags) =>
      side.keys.filter((key, i) => !sideFlags[i] && !/^\s/.test(key)).length;
    const total = words(sides[0]) + words(sides[1]);
    const similarity =
      total === 0 ? 1 : (commonWords(sides[0], flags.left) + commonWords(sides[1], flags.right)) / total;

    if (similarity < MIN_SIMILARITY) {
      return { left: whole(leftLine), right: whole(rightLine) };
    }

    const expand = (side, sideFlags) => {
      const tokenFlags = new Array(side.tokens.length).fill(false);
      side.compared.forEach((tokenIndex, i) => {
        tokenFlags[tokenIndex] = sideFlags[i];
      });
      return toSegments(side.tokens, tokenFlags);
    };
    return { left: expand(sides[0], flags.left), right: expand(sides[1], flags.right) };
  }

  function compare(leftText, rightText, options) {
    const opts = { ignoreCase: false, ignoreWhitespace: false, ...options };
    const leftLines = splitLines(leftText);
    const rightLines = splitLines(rightText);
    const parts = Diff.diffArrays(
      leftLines.map((line) => lineKey(line, opts)),
      rightLines.map((line) => lineKey(line, opts))
    );

    const rows = [];
    const stats = { changed: 0, removed: 0, added: 0 };
    let l = 0;
    let r = 0;
    let pendingRemoved = 0;
    let pendingAdded = 0;

    // A run of removed lines followed by added lines is shown as changed
    // lines, paired in order; whatever is left over stays removed or added.
    const flush = () => {
      const paired = Math.min(pendingRemoved, pendingAdded);
      for (let i = 0; i < paired; i++) {
        const words = diffWords(leftLines[l], rightLines[r], opts);
        rows.push({
          type: 'changed',
          left: { num: l + 1, segments: words.left },
          right: { num: r + 1, segments: words.right },
        });
        l++;
        r++;
      }
      for (let i = paired; i < pendingRemoved; i++) {
        rows.push({ type: 'removed', left: { num: l + 1, segments: plain(leftLines[l]) }, right: null });
        l++;
      }
      for (let i = paired; i < pendingAdded; i++) {
        rows.push({ type: 'added', left: null, right: { num: r + 1, segments: plain(rightLines[r]) } });
        r++;
      }
      stats.changed += paired;
      stats.removed += pendingRemoved - paired;
      stats.added += pendingAdded - paired;
      pendingRemoved = 0;
      pendingAdded = 0;
    };

    for (const part of parts) {
      if (part.removed) {
        pendingRemoved += part.count;
      } else if (part.added) {
        pendingAdded += part.count;
      } else {
        flush();
        for (let i = 0; i < part.count; i++) {
          rows.push({
            type: 'equal',
            left: { num: l + 1, segments: plain(leftLines[l]) },
            right: { num: r + 1, segments: plain(rightLines[r]) },
          });
          l++;
          r++;
        }
      }
    }
    flush();

    return { rows, stats };
  }

  return { compare };
});
