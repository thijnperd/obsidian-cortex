// Synchronous theme bootstrap — runs before first paint to prevent FOUC.
// External script (no inline code) to preserve Cortex's strict script-src 'self' CSP.
(function initThemeEarly() {
  var pref = 'dark';
  try {
    var raw = localStorage.getItem('cortex.theme');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed === 'dark' || parsed === 'light' || parsed === 'system') {
        pref = parsed;
      }
    }
  } catch (e) {
    pref = 'dark';
  }
  var root = document.documentElement;
  root.dataset.theme = pref;
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = pref === 'system' ? 'light dark' : pref;
  }
})();
