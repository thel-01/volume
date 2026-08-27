// ---------------------------------------------------------------------------
// Service worker.
//
// BUMP THIS VERSION whenever you change any file in APP_SHELL.
// The cache name is built from it, so a new version means a brand-new cache
// and the old one is thrown away — that's what stops the phone from serving
// a stale copy of the app forever.
// ---------------------------------------------------------------------------

const VERSION = 'v1.44.0';
const CACHE = `volume-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './app.html',
  './exercises.html',
  './log.html',
  './history.html',
  './settings.html',
  './dashboard.html',
  './progress.html',
  './exercise-trend.html',
  './weight.html',
  './volume.html',
  './injuries.html',
  './styles.css',
  './supabase-client.js',
  './date-utils.js',
  './chart.js',
  './strength-index.js',
  './weight-utils.js',
  './toast.js',
  './chip-tag.js',
  './register-sw.js',
  './manifest.json',
  './vendor/supabase.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './fonts/bebas-neue-400.woff2',
  './fonts/inter-variable.woff2',
  './fonts/dm-mono-400.woff2',
  './fonts/dm-mono-500.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      // Don't sit around waiting for every tab to close before activating.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever touch our own files, and only plain page loads.
  // Everything else — above all the calls to Supabase — goes straight to the
  // network untouched. Caching a login response would be a bad day.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: try the network first so a freshly deployed version wins,
  // and fall back to the cached copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only ever store a real page. This used to cache whatever came
          // back, so hitting a page that had been moved or renamed pinned its
          // 404 into the cache — and it kept being served from there long
          // after the address was fine again.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Everything else (CSS, JS, icons): network first, cache as the fallback.
  //
  // This used to be cache first, for speed. That quietly broke the app every
  // time a page started importing something new from a shared script: pages
  // are fetched network first, so a brand-new page arrived fresh, but its
  // imports came back from the old cache without the export it needed. The
  // module then failed to evaluate and the screen sat on "Loading…" forever.
  // A stale script that a new page can't use isn't worth the milliseconds.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
