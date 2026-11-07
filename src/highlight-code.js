// Colors source code with highlight.js, in the background process that also
// reads files, so that a large file doesn't hold up the window. The page
// cuts the HTML it returns into lines (see renderer/code-html.js).
const CodeLanguages = require('./code-languages');

// Code longer than this isn't colored: it would take a while, and the
// changes are what such a comparison is read for.
const MAX_LENGTH = 2 * 1024 * 1024;
// Code without a file name is told apart by this much of it, among these
// languages, and left plain when none of them fits it well enough.
const SAMPLE_LENGTH = 20000;
const GUESSES = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'dos', 'go', 'graphql', 'ini', 'java', 'javascript',
  'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown', 'objectivec', 'perl', 'php', 'powershell', 'python', 'r',
  'ruby', 'rust', 'scss', 'sql', 'swift', 'typescript', 'vbnet', 'xml', 'yaml',
];
const MIN_RELEVANCE = 3;

// Names to show where highlight.js's own don't fit, by extension and then
// by language.
const EXTENSION_NAMES = {
  htm: 'HTML', html: 'HTML', xhtml: 'XHTML', svg: 'SVG', vue: 'Vue', svelte: 'Svelte', toml: 'TOML', jsx: 'JSX',
  tsx: 'TSX', json5: 'JSON5', jsonc: 'JSON with comments', sass: 'Sass', h: 'C header', props: 'MSBuild',
  targets: 'MSBuild', csproj: 'MSBuild', vbproj: 'MSBuild', fsproj: 'MSBuild', vcxproj: 'MSBuild', xaml: 'XAML',
};
const LANGUAGE_NAMES = { xml: 'XML', ini: 'INI', plaintext: 'Plain text', dos: 'Batch', bash: 'Shell', vbnet: 'Visual Basic' };

let hljs = null;

// `text` is the code, with \n between its lines, and `fileName` the name of
// its file, if any. `language` makes it that language, when highlight.js
// knows it. Returns { language, name, html }: the language it was colored
// as, by highlight.js's name for it and by the name to show, and the HTML.
// Without a language, there is no HTML either.
function highlightCode({ text, fileName = '', language: wanted = null }) {
  if (text === '' || text.length > MAX_LENGTH) return { language: null };
  hljs ??= require('highlight.js');
  const known = (language) => (language && hljs.getLanguage(language) ? language : null);
  let language = known(wanted) ?? known(CodeLanguages.languageOf(fileName));
  const extension = CodeLanguages.extensionOf(fileName);
  // highlight.js knows more extensions than the list does.
  if (!language && extension) language = known(extension);
  if (!language && !extension) {
    const guess = hljs.highlightAuto(text.slice(0, SAMPLE_LENGTH), GUESSES);
    if (guess.relevance >= MIN_RELEVANCE) language = guess.language;
  }
  if (!language) return { language: null };
  const { value } = hljs.highlight(text, { language, ignoreIllegals: true });
  const name = EXTENSION_NAMES[extension] ?? LANGUAGE_NAMES[language] ?? hljs.getLanguage(language).name;
  return { language, name, html: value };
}

module.exports = { highlightCode, MAX_LENGTH };
