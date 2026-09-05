// Minimal service worker: makes the app installable (Chrome/Edge require
// an active service worker for the "Install" prompt to appear) and caches
// the app shell (this HTML/CSS/JS itself) so the interface loads with no
// internet connection. Your actual data — customers, invoices, etc. —
// doesn't rely on this cache at all; it lives in the browser's IndexedDB
// database (handled inside app.html), which persists on its own and works
// fully offline once you've signed in on this device at least once.

const CACHE_NAME = 'pomology-shell-v2';
const APP_SHELL = ['./', './index.html', './app.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  // Each file is cached independently — if the connection drops partway
  // through (e.g. someone switches to airplane mode moments after their
  // very first login), whatever already succeeded is kept rather than the
  // whole cache being thrown away, which is what the all-or-nothing
  // cache.addAll() used to do.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellFile = APP_SHELL.some((path) => url.pathname.endsWith(path.replace('./', '/')));
  if (isShellFile) {
    // Network-first: this app changes often, so always try to fetch the
    // latest version first, updating the cache with whatever comes back.
    // Only fall back to the cached copy when there's truly no connection —
    // that's what keeps the app openable offline, without ever getting
    // permanently stuck showing an old version once you're back online.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
  // Everything else (Supabase API calls, the CDN library) always goes to
  // the network untouched.
});
