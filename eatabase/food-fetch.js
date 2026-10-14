import { BACKEND } from './config.js';
// The deployed relay checks the user's token; OFF's direct barcode URL stays public.
export async function foodFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (BACKEND === 'supabase') {
    const { supabase } = await import('../supabase-client.js');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data?.session) throw new Error('Please log in again.');
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  return fetch(url, { ...options, headers });
}
