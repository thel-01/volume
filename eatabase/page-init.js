// Shared setup also runs on the login, consent and legacy redirect pages.
import { BACKEND } from './config.js';
import { clearDayEndHour } from './nutrition.js';

export let accountUserId = null;

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
    navigator.serviceWorker.register('./sw.js', { scope:'./' }).catch(error => {
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
