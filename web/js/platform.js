// The UI runs on the same machine as the vault, so the browser's own platform
// is the right one to name in a shortcut. Static exports follow the visitor.
const agent = navigator.userAgent || '';

export const isMac = /Macintosh|Mac OS X|iPhone|iPad/.test(agent);
export const platform = isMac ? 'macos' : /Windows/.test(agent) ? 'windows' : 'linux';
export const mod = isMac ? '⌘' : 'Ctrl';

/** `⌘K` on macOS, `Ctrl K` everywhere else. */
export function key(letter) {
  return isMac ? `${mod}${letter}` : `${mod} ${letter}`;
}

/** Fills every `[data-mod]` and titles every `[data-shortcut]` in place. */
export function applyPlatformHints() {
  document.documentElement.dataset.platform = platform;
  document.querySelectorAll('[data-mod]').forEach((element) => {
    element.textContent = key(element.dataset.mod);
  });
  document.querySelectorAll('[data-shortcut]').forEach((element) => {
    const label = element.dataset.title || element.getAttribute('aria-label') || '';
    if (!label) return;
    element.title = `${label} (${key(element.dataset.shortcut)})`;
  });
}
