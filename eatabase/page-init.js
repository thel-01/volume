// Shared setup also runs on the login, consent and legacy redirect pages.
import { BACKEND } from './config.js';
import { clearDayEndHour } from './nutrition.js';
import { toast } from './ui.js';

export let accountUserId = null;
let updateReloading = false;

function watchUpdates(registration, hadController) {
  let prompted = false, lastUpdateCheck = -Infinity;
  const showUpdate = () => {
    if (prompted || !registration.waiting || !navigator.serviceWorker.controller) return;
    prompted = true;
    const show = () => {
      if (!document.getElementById('toast-layer')) {
        const layer = document.createElement('div'); layer.id = 'toast-layer';
        layer.setAttribute('aria-live', 'polite'); document.body.append(layer);
      }
      toast('New version available. Reload to update.', null, true, 'info', {
        label: 'Reload',
        run: async () => {
          const waiting = registration.waiting;
          if (!waiting) return;
          waiting.postMessage({ type: 'SKIP_WAITING' });
          await new Promise(() => {}); // Keep the action busy until controllerchange reloads the page.
        },
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true }); else show();
  };
  const watchInstalling = () => {
    const worker = registration.installing;
    if (worker) worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') showUpdate();
    });
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = !!navigator.serviceWorker.controller; return; }
    if (updateReloading) return;
    updateReloading = true;
    location.reload();
  });
  registration.addEventListener('updatefound', watchInstalling);
  watchInstalling();
  showUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastUpdateCheck < 10 * 60 * 1000) return;
    lastUpdateCheck = Date.now();
    registration.update().catch(() => {});
  });
}

function watchAccount(supabase, user) {
  if (user.is_anonymous) return;
  accountUserId = user.id;
  let leaving = false;
  const changed = (event, session) => {
    if (event === 'INITIAL_SESSION' || leaving || session?.user?.id === accountUserId) return;
    leaving = true;
    document.documentElement.inert = true;
    document.documentElement.hidden = true;
    clearDayEndHour();
    if (!session?.user) location.replace('./login.html');
    else location.reload();
  };
  supabase.auth.onAuthStateChange(changed);
  // Close the gap between the startup guard and subscribing. Keep auth calls out of the callback.
  return supabase.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    changed('SESSION_CHECK', data?.session);
    return leaving;
  });
}

// Logged in, but this account isn't on Eatabase's access list yet.
function showClosed(supabase) {
  const render = () => {
    document.body.innerHTML = `<main><section class="screen"><header class="page-header"><span class="icon-link header-blank" aria-hidden="true"></span><h1>Eatabase</h1><span class="icon-link header-blank" aria-hidden="true"></span></header>
      <p class="empty-state">Eatabase isn’t open for this account yet.</p>
      <a class="link-button nav-link closed-link" href="https://thel-01.github.io/volume/dashboard.html">Go to Volume ↗</a>
      <button type="button" id="closed-log-out" class="link-button closed-link">Log out</button>
      <div id="closed-status" class="status error" role="alert" hidden></div></section></main>`;
    const out = document.getElementById('closed-log-out');
    out.onclick = async () => {
      out.disabled = true; out.textContent = 'Logging out…';
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (!error) { clearDayEndHour(); location.replace('./login.html'); return; }
      out.disabled = false; out.textContent = 'Log out';
      const st = document.getElementById('closed-status'); st.textContent = `Couldn't log out. ${error.message}`; st.hidden = false;
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true }); else render();
}
if (typeof document !== 'undefined') {
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js', { scope:'./' }).then(registration => {
      if (!location.pathname.endsWith('/connect.html')) watchUpdates(registration, hadController);
    }).catch(error => {
      console.error('Eatabase offline setup failed:', error);
      const show = () => {
        const el = document.createElement('p'); el.className = 'status error';
        el.textContent = 'Offline setup failed. Reopen the app online to try again.';
        (document.querySelector('main') || document.body).append(el);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once:true }); else show();
    });
  }
  if (BACKEND === 'supabase' && !['/login.html', '/connect.html'].some(path => location.pathname.endsWith(path))) {
    try {
      const { requireSession, supabase } = await import('../supabase-client.js');
      const user = await requireSession('./login.html');
      if (!user) { clearDayEndHour(); await new Promise(() => {}); }
      if (await watchAccount(supabase, user)) await new Promise(() => {});
      // Alpha: only accounts on public.cal_access get in (the tables and food search enforce
      // the same list; this just shows a clear page instead of a broken one).
      const { data: allowed, error } = await supabase.rpc('cal_allowed');
      if (error) throw error;
      if (allowed !== true) { showClosed(supabase); await new Promise(() => {}); }
    } catch (error) {
      const el = document.createElement('p'); el.className = 'status error'; el.setAttribute('role','alert');
      el.textContent = `Couldn't read your login. Please reload and try again. ${error.message}`;
      document.body.append(el);
      await new Promise(() => {}); // stop dependent page modules after a failed guard
    }
  }
}
