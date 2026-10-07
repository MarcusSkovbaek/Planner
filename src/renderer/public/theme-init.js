// Pick the right theme before first paint to avoid a light flash in dark mode.
try {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
} catch (e) {
  /* ignore */
}
