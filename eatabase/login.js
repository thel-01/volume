import './page-init.js';
import { BACKEND } from './config.js';
const $ = id => document.getElementById(id), home = './home.html';
function show(kind, message) { const el = $('status'); el.className = `status ${kind}`; el.textContent = message; el.hidden = false; }
function busy(on, label) { for (const id of ['email','password','submit']) $(id).disabled = on; $('submit').textContent = label; }
if (BACKEND !== 'supabase') location.replace(home);
else {
  try {
    const { supabase, describeAuthError } = await import('../supabase-client.js');
    $('login-form').addEventListener('submit', async event => {
      event.preventDefault(); $('status').hidden = true;
      const email = $('email').value.trim(), password = $('password').value;
      if (!email || !password) { show('error', 'Enter both your email and your password.'); return; }
      busy(true, 'Logging in…');
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { show('error', describeAuthError(error)); busy(false, 'Log in'); return; }
        if (!data.session) {
          console.error('Login returned no session:', data);
          show('error', 'Logging in isn\'t working right now. Please try again later.'); busy(false, 'Log in'); return;
        }
        show('ok', 'Logged in. Loading…'); location.replace(home);
      } catch (error) { show('error', describeAuthError(error)); busy(false, 'Log in'); }
    });
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) show('error', describeAuthError(error));
      else if (data.session) { show('info', 'Already logged in. Taking you through…'); location.replace(home); }
    } catch (error) { show('error', describeAuthError(error)); }
  } catch (error) { busy(true, 'Log in'); show('error', `Couldn't load login. Please reload and try again. ${error.message}`); }
}
