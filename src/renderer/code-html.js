// Lines of code as HTML: colored as highlight.js colored them, and with the
// words that changed marked. Loaded as a plain script in the renderer and
// via require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodeHtml = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]);
  // The ones highlight.js writes.
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };
  const decode = (html) => html.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, name) => ENTITIES[name]);

  // highlight.js's HTML for a text as its lines, each a list of tokens
  // [text, className]: the class of the innermost span the text is in, or
  // '' outside any. Spans that run over several lines, such as block
  // comments, carry on in each.
  function toLines(html) {
    const lines = [[]];
    const classes = [];
    for (const [match, className] of html.matchAll(/<span class="([^"]*)">|<\/span>|[^<]+/g)) {
      if (className !== undefined) {
        classes.push(className.replace(/[^\w -]/g, ''));
      } else if (match === '</span>') {
        classes.pop();
      } else {
        const current = classes.length > 0 ? classes[classes.length - 1] : '';
        decode(match)
          .split('\n')
          .forEach((text, i) => {
            if (i > 0) lines.push([]);
            if (text !== '') lines[lines.length - 1].push([text, current]);
          });
      }
    }
    return lines;
  }

  const span = (text, className) => (className ? `<span class="${className}">${escapeHtml(text)}</span>` : escapeHtml(text));

  // A line of code as HTML. `tokens` color it, as toLines() returns them for
  // the line, or null; they're left out unless they have the line's text.
  // `segments` mark the words that changed, as DiffEngine returns them, in
  // spans of class `x`, or null.
  function lineHtml(text, tokens, segments) {
    const pieces = tokens && tokens.map(([piece]) => piece).join('') === text ? tokens : [[text, '']];
    if (!segments) return pieces.map(([piece, className]) => span(piece, className)).join('');
    let html = '';
    // The token the next segment starts in, and where in it.
    let index = 0;
    let offset = 0;
    for (const segment of segments) {
      let rest = segment.text.length;
      let inner = '';
      while (rest > 0 && index < pieces.length) {
        const [piece, className] = pieces[index];
        const take = Math.min(rest, piece.length - offset);
        inner += span(piece.slice(offset, offset + take), className);
        rest -= take;
        offset += take;
        if (offset === piece.length) {
          index++;
          offset = 0;
        }
      }
      html += segment.changed ? `<span class="x">${inner}</span>` : inner;
    }
    return html;
  }

  return { toLines, lineHtml, escapeHtml };
});
