import './page-init.js';
import { BACKEND } from './config.js';

const $ = id => document.getElementById(id);
const authorizationId = new URLSearchParams(location.search).get('authorization_id');
function show(kind, message) { const el = $('status'); el.className = kind === 'blocked' ? 'consent-text' : `status ${kind}`; $('blocked-spacer').hidden = kind !== 'blocked'; el.textContent = message; el.hidden = false; }
function loginBusy(on, label) { for (const id of ['email', 'password', 'submit']) $(id).disabled = on; $('submit').textContent = label; }
function consentBusy(on) { $('allow').disabled = on; $('cancel').disabled = on; }

if (window.top !== window.self) {
  show('error', 'Open this page directly.');
} else if (!authorizationId) {
  show('error', "This link isn't valid. Start connecting again from your AI app.");
} else if (BACKEND !== 'supabase') {
  show('error', "Connecting isn't available right now. Please try again later.");
} else {
  try {
    const { supabase, describeAuthError } = await import('../supabase-client.js');

    let shownUserId = null;
    async function loadConsent(user) {
      shownUserId = null;
      $('login-group').hidden = true;
      $('login-form').hidden = true;
      $('consent').hidden = true;
      $('status').hidden = true;
      if (user.is_anonymous) {
        show('blocked', 'Demo accounts can’t connect apps.');
        return;
      }
      try {
        const { data: allowed, error: accessError } = await supabase.rpc('cal_allowed');
        if (accessError) throw accessError;
        if (allowed !== true) {
          show('blocked', 'Eatabase isn’t open for this account yet.');
          return;
        }
        // A brand-new account may connect before it ever opens the app; give it a settings row with its time zone.
        try {
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (zone) await supabase.from('cal_settings').upsert({ user_id: user.id, time_zone: zone }, { onConflict: 'user_id', ignoreDuplicates: true });
        } catch (error) { console.error('Could not create settings:', error); }
        const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (error) throw error;
        if (!data) throw new Error('Authorization details were empty');
        if (data.redirect_url) { location.replace(data.redirect_url); return; }
        if (!('authorization_id' in data)) throw new Error('Authorization details were incomplete');
        const name = typeof data.client?.name === 'string' && data.client.name.trim() || 'An app';
        const callback = new URL(data.redirect_uri);
        if (!callback.hostname) throw new Error('Authorization callback has no hostname');
        $('request-text').textContent = `${name} wants your permission to read, add and remove entries in Eatabase.`;
        $('callback-host').textContent = `Returns to ${callback.hostname}`;
        $('account-email').textContent = `Signed in as ${user.email || ''}`;
        shownUserId = user.id;
        $('consent').hidden = false;
      } catch (error) {
        console.error('Could not load authorization details:', error);
        show('error', "Couldn't load this request. Please try again.");
      }
    }

    $('login-form').addEventListener('submit', async event => {
      event.preventDefault(); $('status').hidden = true;
      const email = $('email').value.trim(), password = $('password').value;
      if (!email || !password) { show('error', 'Enter both your email and your password.'); return; }
      loginBusy(true, 'Logging in…');
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { console.error('Login failed:', error); show('error', describeAuthError(error)); return; }
        if (!data.session?.user) throw new Error('Login returned no session');
        await loadConsent(data.session.user);
      } catch (error) {
        console.error('Login failed:', error);
        show('error', "Logging in isn't working right now. Please try again later.");
      } finally { loginBusy(false, 'Log in'); }
    });

    async function decide(approve) {
      consentBusy(true); $('status').hidden = true;
      try {
        const { data: current } = await supabase.auth.getSession();
        if (!shownUserId || current.session?.user?.id !== shownUserId) {
          show('error', 'Your account changed. Reload this page to continue.');
          consentBusy(false);
          return;
        }
        const options = { skipBrowserRedirect: true };
        const { data, error } = approve
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, options)
          : await supabase.auth.oauth.denyAuthorization(authorizationId, options);
        if (error) throw error;
        if (!data?.redirect_url) throw new Error('Authorization decision returned no redirect URL');
        location.replace(data.redirect_url);
      } catch (error) {
        console.error('Could not complete authorization:', error);
        show('error', "Couldn't finish connecting. Please try again.");
        consentBusy(false);
      }
    }
    $('allow').addEventListener('click', () => decide(true));
    $('cancel').addEventListener('click', () => decide(false));

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await loadConsent(data.session.user);
    else { $('login-group').hidden = false; $('login-form').hidden = false; }
  } catch (error) {
    console.error('Could not load connection page:', error);
    show('error', "Couldn't load this page. Please reload and try again.");
  }
}
