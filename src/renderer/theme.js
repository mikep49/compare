// Loaded in <head> so the theme and the sidebar's state are in place before
// the first paint.

// The themes Settings offers. System is light or dark as Windows is set,
// and keeps up when that changes.
const THEMES = ['system', 'light', 'dark', 'oled'];
const systemDark = matchMedia('(prefers-color-scheme: dark)');

// Local storage may be missing or refuse to save; remembering settings is
// a convenience only.
function loadSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // As above.
  }
}

// The theme picked: one of THEMES. System is the default.
let themeChoice = THEMES.includes(loadSetting('theme')) ? loadSetting('theme') : 'system';

// The theme on show: the one picked or, for System, Windows' light or dark.
function renderTheme() {
  document.documentElement.dataset.theme = themeChoice === 'system' ? (systemDark.matches ? 'dark' : 'light') : themeChoice;
}

function applyTheme(choice) {
  themeChoice = choice;
  renderTheme();
  // The main process matches the window chrome (backdrop, caption buttons),
  // and with System lets the page follow Windows: until then a theme picked
  // before may still be what prefers-color-scheme says.
  window.compareApi.setTheme(choice);
}

systemDark.addEventListener('change', renderTheme);

document.documentElement.classList.toggle('material', window.compareApi.hasMaterial);
document.documentElement.classList.toggle('sidebar-collapsed', loadSetting('sidebar') === 'collapsed');
// Pages and sheets shown as they look are light or dark paper.
document.documentElement.dataset.paper = loadSetting('paper') === 'dark' ? 'dark' : 'light';
applyTheme(themeChoice);
