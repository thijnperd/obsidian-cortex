// Early bootstrap: preserve legacy ?view=<mode> demo links and prevent theme FOUC.
(function initSiteEarly() {
  try {
    var params = new URLSearchParams(window.location.search);
    var view = params.get('view');
    var validViews = {
      universe: true,
      brain: true,
      replay: true,
      atlas: true,
      bento: true,
      decisions: true,
    };
    if (view && validViews[view]) {
      window.location.replace('./demo/' + window.location.search + window.location.hash);
      return;
    }
  } catch (e) {
    /* keep landing page */
  }

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
  document.documentElement.dataset.theme = pref;
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = pref === 'system' ? 'light dark' : pref;
})();
