// Find in the text and code comparisons: the places in their lines that
// have what is looked for, as Ranges that the CSS Custom Highlight API
// paints.
const FindText = (() => {
  // More matches than this aren't worth counting one by one.
  const MAX_MATCHES = 100000;
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The places in `elements` that have `query`, whatever its case, in order.
  function ranges(elements, query) {
    const pattern = new RegExp(escapeRegExp(query), 'giu');
    const found = [];
    for (const element of elements) {
      const nodes = [];
      let text = '';
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        nodes.push({ node: walker.currentNode, start: text.length });
        text += walker.currentNode.data;
      }
      if (text === '') continue;
      // Where in the element's text nodes a place in its text is.
      const locate = (offset, isEnd) => {
        let i = nodes.length - 1;
        while (i > 0 && (nodes[i].start > offset || (isEnd && nodes[i].start === offset))) i--;
        return [nodes[i].node, offset - nodes[i].start];
      };
      for (const match of text.matchAll(pattern)) {
        const range = new Range();
        range.setStart(...locate(match.index, false));
        range.setEnd(...locate(match.index + match[0].length, true));
        found.push(range);
        if (found.length >= MAX_MATCHES) return found;
      }
    }
    return found;
  }

  // Paints `matches`, and the one at `index` (if any) as the current one.
  function paint(matches, index) {
    const all = new Highlight();
    for (const range of matches) all.add(range);
    CSS.highlights.set('find', all);
    if (index >= 0) CSS.highlights.set('find-current', new Highlight(matches[index]));
    else CSS.highlights.delete('find-current');
  }

  return { ranges, paint };
})();
