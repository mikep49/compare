// Compares two long texts away from the page, which stays responsive
// meanwhile. See compareTexts() in app.js.
importScripts('../../node_modules/diff/dist/diff.min.js', 'diff-engine.js');

onmessage = ({ data: { left, right, options } }) => {
  postMessage(DiffEngine.compare(left, right, options));
};
