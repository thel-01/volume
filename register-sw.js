// Registers the service worker. Included by every page.
// Service workers only run on https:// or on localhost, so opening the files
// directly with file:// will skip this — that's expected, not a bug.

(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.info('[sw] Not supported in this browser — the app still works, just no offline support.');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((registration) => {
        console.info('[sw] Registered, scope:', registration.scope);

        // If a new version is waiting, reload once so it takes over
        // instead of the phone showing the old build.
        registration.addEventListener('updatefound', () => {
          const incoming = registration.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            if (incoming.state === 'activated' && navigator.serviceWorker.controller) {
              console.info('[sw] New version active — reloading.');
              window.location.reload();
            }
          });
        });
      })
      .catch((error) => {
        console.error('[sw] Registration failed:', error);
      });
  });
})();
