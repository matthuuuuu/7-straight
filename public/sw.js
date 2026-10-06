// Service worker: lets the game be installed and open without a connection
// (play-on-this-device mode works fully offline). Online rooms always go to
// the network.
//
// __BUILD__ is replaced with a new value on every build (see vite.config.js),
// so each deploy gets a fresh cache and the old one is deleted.

const CACHE = 'seven-straight-__BUILD__';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

function remember(req, res) {
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: always try the network first so new versions show up right away.
  // Only a proper copy of the game's start page is kept for offline use.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const isShell = res.ok && !res.redirected && url.pathname === '/'
            && (res.headers.get('content-type') || '').includes('text/html');
          if (isShell) remember('/', res);
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Built files have unique names, so a saved copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) remember(req, res);
        return res;
      })),
    );
    return;
  }

  // Everything else (icons, manifest): fresh when online, saved copy offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) remember(req, res);
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
