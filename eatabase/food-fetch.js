import { BACKEND, API_BASE } from './config.js';
// Requests stay on our authenticated relay; never send its token to OFF.
const windows = { search: [], product: [] }, cooldown = { search:0, product:0 };
function budget(kind) {
  const now = Date.now(), limit = kind === 'search' ? 10 : 15;
  windows[kind] = windows[kind].filter(t => now-t < 60000);
  if (now < cooldown[kind] || windows[kind].length >= limit) {
    const error = new Error('Product requests are busy. Wait a minute, then try again.'); error.kind = 'throttled'; throw error;
  }
  windows[kind].push(now);
}
export async function foodFetch(url, options = {}) {
  const target = new URL(url, location.href);
  const allowed = new URL(API_BASE || '.', location.href);
  if (target.origin !== allowed.origin || !target.pathname.startsWith(allowed.pathname.replace(/\/$/, '') + '/api/off-')) throw new Error('Unexpected food API destination.');
  const kind = target.pathname.endsWith('/off-search') ? 'search' : 'product';
  const headers = new Headers(options.headers);
  if (BACKEND === 'supabase') {
    const { supabase } = await import('../supabase-client.js');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data?.session) throw new Error('Please log in again.');
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  budget(kind);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 429) {
    const retry = response.headers.get('Retry-After');
    const seconds = Number(retry), time = retry && Number.isFinite(seconds) ? seconds*1000 : Date.parse(retry || '')-Date.now();
    cooldown[kind] = Date.now() + Math.max(60000, Number.isFinite(time) ? time : 0);
  }
  return response;
}
