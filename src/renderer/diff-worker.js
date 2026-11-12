// Comparisons and parsing pasted cells run away from the interface thread.
importScripts('../../node_modules/diff/dist/diff.min.js', 'diff-engine.js', 'code-diff.js', '../table-text.js', 'table-diff.js');

onmessage = ({ data: { kind, left, right, options } }) => {
  if (kind === 'code') {
    postMessage(CodeDiff.compare(left, right, options));
  } else if (kind === 'sheets') {
    const leftSheets = left.sheets ?? TableText.toSheets(left.text);
    const rightSheets = right.sheets ?? TableText.toSheets(right.text);
    const diffs = TableDiff.compare(leftSheets, rightSheets, options);
    // Structured cloning loses the identities used to find workbook styling.
    // Send indexes so the page can reconnect loaded sheets to their originals.
    postMessage(diffs.map((diff) => ({
      ...diff,
      leftIndex: leftSheets.indexOf(diff.left),
      rightIndex: rightSheets.indexOf(diff.right),
    })));
  } else {
    postMessage(DiffEngine.compare(left, right, options));
  }
};
