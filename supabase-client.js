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
