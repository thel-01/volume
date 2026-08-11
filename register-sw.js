// Boot-time housekeeping, included by every page: registers the service
// worker, and makes a failed page script visible instead of silent.
// Service workers only run on https:// or on localhost, so opening the files
// directly with file:// will skip this — that's expected, not a bug.

// A page's module script can fail before a single line of it runs — an import
// that no longer matches what the shared file exports is enough. Nothing in
// the page can catch that, because the page never started, so every screen
// would just sit on "Loading…" for ever. This is the one listener that still
// runs in that case, so it's what turns a dead screen into a real message.
(function surfaceBootFailures() {
  let shown = false;

  window.addEventListener('error', (event) => {
    // Ignore errors from anything that isn't the page failing to start.
    const isScriptFailure = event.target instanceof HTMLScriptElement
      || event.target === window;
    if (shown || !isScriptFailure) return;

    const loading = document.getElementById('loading');
    const status = document.getElementById('top-status');
    // Only speak up while the page is still visibly stuck on its loading
    // state — an error thrown after a screen has rendered is that screen's
    // own to report, in context.
    if (!loading || loading.hidden) return;

    shown = true;
    loading.hidden = true;
    if (status) {
      status.className = 'status error';
      status.textContent = 'This screen failed to load. Close and reopen the app to pick up the latest version.';
      status.hidden = false;
    }
  }, true); // capture: resource-level load errors don't bubble
})();

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
