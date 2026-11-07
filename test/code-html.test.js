const test = require('node:test');
const assert = require('node:assert/strict');
const CodeHtml = require('../src/renderer/code-html');
const CodeLanguages = require('../src/code-languages');
const { highlightCode } = require('../src/highlight-code');

test('highlighted code is cut into lines, spans running on across them', () => {
  const html = '<span class="hljs-keyword">const</span> s = <span class="hljs-string">`a\n<span class="hljs-subst">${b}</span>`</span>; <span class="hljs-comment">/* x &lt;&amp;&gt; &quot;y&#x27;\n*/</span>';
  assert.deepEqual(CodeHtml.toLines(html), [
    [
      ['const', 'hljs-keyword'],
      [' s = ', ''],
      ['`a', 'hljs-string'],
    ],
    [
      ['${b}', 'hljs-subst'],
      ['`', 'hljs-string'],
      ['; ', ''],
      ['/* x <&> "y\'', 'hljs-comment'],
    ],
    [['*/', 'hljs-comment']],
  ]);
});

test('a line is colored and its changed words marked, both escaped', () => {
  const tokens = [
    ['if', 'hljs-keyword'],
    [' (a < ', ''],
    ['10', 'hljs-number'],
    [')', ''],
  ];
  const segments = [
    { text: 'if (a < ', changed: false },
    { text: '1', changed: true },
    { text: '0)', changed: false },
  ];
  assert.equal(
    CodeHtml.lineHtml('if (a < 10)', tokens, segments),
    '<span class="hljs-keyword">if</span> (a &lt; <span class="x"><span class="hljs-number">1</span></span><span class="hljs-number">0</span>)'
  );
  assert.equal(CodeHtml.lineHtml('if (a < 10)', tokens, null), '<span class="hljs-keyword">if</span> (a &lt; <span class="hljs-number">10</span>)');
  // Tokens for other text are left out.
  assert.equal(CodeHtml.lineHtml('x < y', tokens, null), 'x &lt; y');
  assert.equal(CodeHtml.lineHtml('', null, null), '');
});

test('files are told apart by their names', () => {
  assert.equal(CodeLanguages.languageOf('C:\\src\\App.TSX'), 'typescript');
  assert.equal(CodeLanguages.languageOf('Dockerfile'), 'dockerfile');
  assert.equal(CodeLanguages.languageOf('CMakeLists.txt'), 'cmake');
  assert.equal(CodeLanguages.languageOf('notes'), null);
  assert.equal(CodeLanguages.extensionOf('.gitignore'), '');
  assert.equal(CodeLanguages.extensionOf('archive.tar.gz'), 'gz');
  assert.ok(CodeLanguages.isCode('build/installer.nsh'));
  assert.ok(CodeLanguages.isCode('.gitignore'));
  assert.ok(!CodeLanguages.isCode('README.md'));
  assert.ok(!CodeLanguages.isCode('notes.txt'));
  assert.ok(!CodeLanguages.isCode('report.docx'));
});

test('code is colored by its file name, or by what it looks like', () => {
  const js = highlightCode({ text: 'const a = 1;', fileName: 'x.js' });
  assert.equal(js.language, 'javascript');
  assert.equal(js.name, 'JavaScript');
  assert.match(js.html, /<span class="hljs-keyword">const<\/span>/);
  // Extensions highlight.js knows by itself.
  assert.equal(highlightCode({ text: 'x', fileName: 'a.rs' }).language, 'rust');
  assert.equal(highlightCode({ text: '[a]\nb = 1', fileName: 'Cargo.toml' }).name, 'TOML');
  // A language asked for wins.
  assert.equal(highlightCode({ text: 'x', fileName: 'a.js', language: 'python' }).language, 'python');
  // Pasted code is recognized; text in a file of no known type stays plain.
  assert.equal(highlightCode({ text: 'def f(x):\n    return x\n' }).language, 'python');
  assert.equal(highlightCode({ text: 'def f(x):\n    return x\n', fileName: 'notes.conf' }).language, null);
  assert.equal(highlightCode({ text: '' }).language, null);
});
