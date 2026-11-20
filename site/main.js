// Cortex v2 landing page controller — theme toggle, accessible 6-view tabs,
// OS-aware download highlight, and clipboard copy helpers.

const THEME_KEY = 'cortex.theme';
const systemLight = window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null;

function readTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    const parsed = raw ? JSON.parse(raw) : 'dark';
    return parsed === 'light' || parsed === 'dark' || parsed === 'system' ? parsed : 'dark';
  } catch {
    return 'dark';
  }
}

function effectiveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemLight?.matches ? 'light' : 'dark';
}

function applyTheme(pref, { persist = true } = {}) {
  document.documentElement.dataset.theme = pref;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = pref === 'system' ? 'light dark' : pref;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(pref));
    } catch {
      /* storage blocked */
    }
  }
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    const label = effectiveTheme(pref) === 'dark'
      ? 'Switch to Warm Light theme'
      : 'Switch to Dark theme';
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
  }
}

function wireTheme() {
  applyTheme(readTheme(), { persist: false });
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = effectiveTheme(readTheme()) === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) applyTheme(readTheme(), { persist: false });
  });
}

function wireViewTabs() {
  const tabs = [...document.querySelectorAll('[data-view-tab]')];
  const panels = [...document.querySelectorAll('[data-view-panel]')];
  if (!tabs.length) return;

  const activate = (id, { focus = false } = {}) => {
    for (const tab of tabs) {
      const selected = tab.dataset.viewTab === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) {
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (focus) tab.focus();
      }
    }
    for (const panel of panels) {
      const selected = panel.dataset.viewPanel === id;
      if (selected) panel.removeAttribute('hidden');
      else panel.hidden = 'until-found';
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.viewTab));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next !== null) {
        event.preventDefault();
        activate(tabs[next].dataset.viewTab, { focus: true });
      }
    });
  });

  panels.forEach((panel) => {
    panel.addEventListener('beforematch', () => activate(panel.dataset.viewPanel));
  });
}

function highlightPlatform() {
  const ua = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
  let os = null;
  let label = 'Download v2.2.1';
  if (ua.includes('win')) {
    os = 'windows';
    label = 'Download for Windows';
  } else if (ua.includes('mac')) {
    os = 'macos';
    label = 'Download for macOS';
  } else if (ua.includes('linux')) {
    os = 'linux';
    label = 'Download for Linux';
  }
  const heroLabel = document.getElementById('hero-download-label');
  if (heroLabel) heroLabel.textContent = label;
  if (os) {
    const card = document.querySelector(`[data-platform="${os}"]`);
    if (card) card.classList.add('is-recommended');
  }
}

function wireCopyButtons() {
  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      if (!target || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(target.textContent || '');
        const label = button.querySelector('span');
        const use = button.querySelector('use');
        if (label) label.textContent = 'Copied';
        if (use) use.setAttribute('href', '#i-check');
        setTimeout(() => {
          if (label) label.textContent = 'Copy';
          if (use) use.setAttribute('href', '#i-copy');
        }, 1600);
      } catch {
        /* clipboard denied */
      }
    });
  });
}

wireTheme();
wireViewTabs();
highlightPlatform();
wireCopyButtons();
