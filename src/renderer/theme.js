// Loaded in <head> so the theme and the sidebar's state are in place before
// the first paint.
const THEMES = ['light', 'dark', 'oled'];

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // The main process matches the window chrome (backdrop, caption buttons).
  window.compareApi.setTheme(theme);
}

function initialTheme() {
  const saved = localStorage.getItem('theme');
  if (THEMES.includes(saved)) return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

document.documentElement.classList.toggle('material', window.compareApi.hasMaterial);
document.documentElement.classList.toggle('sidebar-collapsed', localStorage.getItem('sidebar') === 'collapsed');
applyTheme(initialTheme());
