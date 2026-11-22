// Offline app shell. The UI is static, so every GET that is not an API call
// can come from the cache; navigations and graph.json refresh in the
// background so a redeploy is picked up on the next launch.
//
// A local vault never touches this cache: its notes live in IndexedDB, which
// the service worker does not see.

const VERSION = 'cortex-v2.5.1-1';
const SHELL = ['./', './index.html', './styles.css', './manifest.json', './logo.svg', './favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isFresh(path) {
  return path.endsWith('/') || path.endsWith('/index.html') || path.endsWith('/graph.json');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate' || isFresh(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match('./index.html')),
        ),
    );
    return;
  }

  // Stale-while-revalidate: answer instantly from the cache, then refresh it in
  // the background. Cache-first with a fixed VERSION freezes the UI between
  // releases, because an installed app never asks the network again.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => hit);
      return hit || fresh;
    }),
  );
});
