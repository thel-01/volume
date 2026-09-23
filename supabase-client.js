// ---------------------------------------------------------------------------
// Shared Supabase connection. EVERY page imports from this file.
// Never copy the URL / key into another page — change them here only.
// ---------------------------------------------------------------------------

import { createClient } from './vendor/supabase.js';

const SUPABASE_URL = 'https://zhrlrgzpstipojaopnbo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gvttYIUOpCX8jyKF2ebhdQ_kljLf4aJ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Write the session to localStorage, which survives closing the tab,
    // closing the browser, and rebooting the phone. This is what keeps you
    // logged in for months rather than for one browsing session.
    persistSession: true,
    storage: window.localStorage,
    storageKey: 'volume-auth',

    // The access token only lasts an hour. This quietly swaps in a fresh one
    // in the background using the long-lived refresh token, so you never see
    // a logout as long as you open the app now and then.
    autoRefreshToken: true,

    // No magic links or OAuth in this app, so there is never a token in the
    // URL to look for. Leaving this off avoids a pointless startup check.
    detectSessionInUrl: false,
  },
});

/**
 * Every row a query matches, not just the first 1000.
 *
 * Supabase caps a single response at 1000 rows by default and says nothing
 * when it cuts a result short — no error, no flag, just a shorter array. For
 * a table that grows with every workout or weigh-in (sets, sessions,
 * session_exercises, body_weights), a plain select('*') would one day start
 * silently dropping rows: and since most of these are ordered oldest-first,
 * it'd be the NEWEST ones that went missing.
 *
 * Pass a function that builds a fresh query each time (a Supabase query can
 * only be run once), ending in a stable order — always add a final
 * .order('id') tiebreak, or two rows sharing a timestamp could land on
 * either side of a page boundary and get duplicated or skipped. Returns the
 * same { data, error } shape a plain query does, so it drops straight into
 * an existing Promise.all.
 *
 * PAGE_SIZE matches Supabase's own default cap: a page coming back shorter
 * than that means there's nothing left. If the project's max-rows setting
 * is ever lowered below 1000, lower this to match — otherwise every capped
 * page would look like the last one.
 */
const PAGE_SIZE = 1000;
export async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...data);
    if (data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

/**
 * Guard for pages that require a login.
 * If there's no session, bounce to the login page and stop.
 * Returns the logged-in user, or null if we redirected.
 */
export async function requireSession(loginPage = './index.html') {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    // Don't fail silently: if we genuinely can't tell, say so rather than
    // dumping the user on the login page with no explanation.
    console.error('Could not read the saved session:', error);
  }

  if (!data?.session) {
    window.location.replace(loginPage);
    return null;
  }

  return data.session.user;
}

/**
 * True if a query error looks like it's caused by a stale/invalid access
 * token rather than a real data problem. Standalone iOS PWAs freeze all JS
 * (including the library's own background token refresh) while backgrounded,
 * so the token can go stale during that time; the first query fired right
 * after reopening then hits this before the library's refresh has caught up.
 * Callers use this to refresh the session and retry once instead of showing
 * a raw error for something that isn't really a failure.
 */
export function isAuthError(error) {
  if (!error) return false;
  if (error.status === 401 || error.code === 'PGRST301') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes('jwt') || message.includes('token');
}

/**
 * Human-readable version of a Supabase auth error.
 * Supabase's raw messages are terse; this adds the likely cause.
 */
export function describeAuthError(error) {
  if (!error) return 'Something went wrong.';

  const code = error.code || error.error_code;

  if (code === 'invalid_credentials') {
    return 'Wrong email or password.';
  }
  if (code === 'email_not_confirmed') {
    return 'That user exists but its email was never confirmed. In the Supabase dashboard, delete the user and re-create it with "Auto Confirm User" ticked.';
  }
  if (code === 'signup_disabled' || code === 'email_provider_disabled') {
    return 'Email logins are turned off for this Supabase project (Authentication → Sign In / Providers → Email).';
  }
  if (code === 'over_request_rate_limit' || error.status === 429) {
    return 'Too many attempts in a row. Wait a minute and try again.';
  }
  if (error.message === 'Failed to fetch' || error.name === 'AuthRetryableFetchError') {
    return 'Could not reach Supabase. Check your internet connection, and check the project URL in supabase-client.js.';
  }
  if (error.status === 401 || code === 'invalid_api_key') {
    return 'Supabase rejected the API key. Check the anon/publishable key in supabase-client.js.';
  }

  return error.message || 'Something went wrong.';
}
