// The languages of source code files, told by their names: which files
// Explorer hands over belong in the code workspace, and which highlight.js
// language colors them. Loaded as a plain script in the renderer and via
// require() in the background process.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodeLanguages = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Extensions, by the highlight.js language that colors them.
  const EXTENSIONS = {
    arduino: 'ino',
    awk: 'awk',
    autohotkey: 'ahk',
    bash: 'sh bash zsh ksh',
    c: 'c h',
    clojure: 'clj cljs cljc edn',
    cmake: 'cmake',
    coffeescript: 'coffee',
    cpp: 'cpp cc cxx c++ hpp hh hxx h++ inl ipp',
    crystal: 'cr',
    csharp: 'cs csx',
    css: 'css',
    d: 'd',
    dart: 'dart',
    delphi: 'pas dpr',
    diff: 'diff patch',
    dockerfile: 'dockerfile',
    dos: 'bat cmd',
    elixir: 'ex exs',
    elm: 'elm',
    erb: 'erb',
    erlang: 'erl hrl',
    fortran: 'f f90 f95',
    fsharp: 'fs fsx fsi',
    glsl: 'glsl vert frag',
    go: 'go',
    gradle: 'gradle',
    graphql: 'graphql gql',
    groovy: 'groovy',
    haml: 'haml',
    handlebars: 'hbs handlebars',
    haskell: 'hs',
    ini: 'ini cfg toml editorconfig',
    java: 'java',
    javascript: 'js mjs cjs jsx',
    json: 'json jsonc json5 webmanifest ipynb',
    julia: 'jl',
    kotlin: 'kt kts',
    latex: 'tex sty',
    less: 'less',
    lisp: 'lisp',
    lua: 'lua',
    makefile: 'mk mak',
    markdown: 'md markdown',
    nim: 'nim',
    nix: 'nix',
    nsis: 'nsi nsh',
    objectivec: 'm mm',
    ocaml: 'ml mli',
    perl: 'pl pm',
    php: 'php phtml',
    plaintext: 'txt text log',
    powershell: 'ps1 psm1 psd1',
    properties: 'properties',
    protobuf: 'proto',
    python: 'py pyw pyi',
    r: 'r',
    ruby: 'rb rake gemspec',
    rust: 'rs',
    scala: 'scala sc',
    scheme: 'scm',
    scss: 'scss sass',
    sql: 'sql',
    stylus: 'styl',
    swift: 'swift',
    tcl: 'tcl',
    twig: 'twig',
    typescript: 'ts mts cts tsx',
    vbnet: 'vb',
    vbscript: 'vbs',
    verilog: 'v sv svh',
    vhdl: 'vhd vhdl',
    vim: 'vim',
    wasm: 'wat wast',
    x86asm: 'asm',
    xml: 'xml xsd xsl xslt svg html htm xhtml vue svelte csproj vbproj fsproj vcxproj props targets nuspec xaml resx config plist wsdl',
    yaml: 'yaml yml',
  };

  // Files known by their whole name, in lower case.
  const NAMES = {
    dockerfile: 'dockerfile',
    containerfile: 'dockerfile',
    makefile: 'makefile',
    gnumakefile: 'makefile',
    'cmakelists.txt': 'cmake',
    gemfile: 'ruby',
    rakefile: 'ruby',
    podfile: 'ruby',
    vagrantfile: 'ruby',
    jenkinsfile: 'groovy',
    'nginx.conf': 'nginx',
    '.gitignore': 'bash',
    '.gitattributes': 'bash',
    '.dockerignore': 'bash',
    '.npmignore': 'bash',
    '.env': 'bash',
    '.bashrc': 'bash',
    '.zshrc': 'bash',
    '.profile': 'bash',
    '.npmrc': 'ini',
    '.gitconfig': 'ini',
  };

  // Languages of text that is read rather than run, which stays with the
  // documents when it comes from Explorer.
  const PROSE = new Set(['markdown', 'plaintext']);

  const BY_EXTENSION = new Map();
  for (const [language, extensions] of Object.entries(EXTENSIONS)) {
    for (const extension of extensions.split(' ')) BY_EXTENSION.set(extension, language);
  }

  const baseName = (fileName) => String(fileName ?? '').split(/[\\/]/).pop().toLowerCase();

  // The extension of a file's name, in lower case, without the dot. Names
  // like .gitignore have none.
  function extensionOf(fileName) {
    const match = /.\.([^.]+)$/.exec(baseName(fileName));
    return match ? match[1] : '';
  }

  // The highlight.js language of a file, or null when its name doesn't say.
  function languageOf(fileName) {
    const name = baseName(fileName);
    return NAMES[name] ?? BY_EXTENSION.get(extensionOf(name)) ?? null;
  }

  // Whether a file is source code, to be compared as code.
  function isCode(fileName) {
    const language = languageOf(fileName);
    return language !== null && !PROSE.has(language);
  }

  return { languageOf, extensionOf, isCode };
});
