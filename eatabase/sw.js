// Bump on EVERY deployment that changes any shell file. Eatabase owns only its own caches, alongside Volume.
const VERSION = 'v11';
const CACHE = `eatabase-${VERSION}`;
const APP_SHELL = [
  "./home.html",
  "./index.html",
  "./analytics.html",
  "./settings.html",
  "./goals.html",
  "./foods.html",
  "./history.html",
  "./weight.html",
  "./login.html",
  "./overview.html",
  "./offline.html",
  "./analytics.js",
  "./app.js",
  "./chart.js",
  "./config.js",
  "./date-utils.js",
  "./food-fetch.js",
  "./foods.js",
  "./goals.js",
  "./history.js",
  "./home.js",
  "./login.js",
  "./number-input.js",
  "./nutrient-charts.js",
  "./nutrition.js",
  "./page-init.js",
  "./quicklog.js",
  "./scanner.js",
  "./settings.js",
  "./store-local.js",
  "./store-supabase.js",
  "./store.js",
  "./toast.js",
  "./ui.js",
  "./weight-section.js",
  "./weight-utils.js",
  "./weight.js",
  "./app.css",
  "./home.css",
  "./weight-section.css",
  "./weight.css",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./food-search.js",
  "./food-product.js",
  "./bls-foods.json",
  "./scan-worker.js",
  "./vendor/zxing_reader.js",
  "./vendor/zxing_reader.wasm",
  "../styles.css",
  "../supabase-client.js",
  "../vendor/supabase.js",
  "../fonts/bebas-neue-400.woff2",
  "../fonts/inter-variable.woff2",
  "../fonts/dm-mono-400.woff2",
  "../fonts/dm-mono-500.woff2"
];
const assets = new Set(APP_SHELL.map(path => new URL(path, self.location).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL.map(path => new Request(new URL(path, self.location), { cache: 'reload' })))));
});
// Let existing tabs finish using the previous version before activation.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('eatabase-') && name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // A strict static allowlist keeps APIs and user data out of the cache.
  const navigation = request.mode === 'navigate' && url.pathname.startsWith(new URL('./', self.location).pathname);
  if (!navigation && !assets.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Install fills one complete version before activating. Serve that same
    // version's HTML and modules together, without a network wait per import.
    // Query strings select page state, not a different static document.
    const assetURL = new URL(request.url); assetURL.search = ''; assetURL.hash = '';
    if (assets.has(assetURL.href)) {
      const cached = await cache.match(assetURL.href);
      if (cached) return cached;
    }
    try {
      return await fetch(request, { cache: 'no-cache' });
    } catch {
      return (navigation ? await cache.match('./offline.html') : null) || Response.error();
    }
  })());
});
