// listGrants returns { data: [{ client: { id, name, uri, logo_uri }, scopes,
// granted_at }], error }. The bundled SDK passes this response through unchanged.
export function hostname(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}
function clientHosts(grant) {
  const client = grant?.client;
  // Grants currently expose the website URI; accept redirect fields when supplied too.
  return [grant?.redirect_uri, client?.redirect_uri, ...(Array.isArray(client?.redirect_uris) ? client.redirect_uris : []), client?.uri]
    .map(hostname).filter(Boolean);
}
const inDomains = (domains, host) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
// One entry per AI app that can connect. Matching uses the client name or its real host.
export const PROVIDERS = [
  { id: 'claude', name: 'Claude', by: 'Anthropic', nameRe: /claude/i, domains: ['claude.ai', 'claude.com'] },
  { id: 'chatgpt', name: 'ChatGPT', by: 'OpenAI', nameRe: /chatgpt|openai/i, domains: ['chatgpt.com', 'openai.com'] },
];
export function isProviderGrant(provider, grant) {
  return provider.nameRe.test(grant?.client?.name || '') || clientHosts(grant).some(host => inDomains(provider.domains, host));
}
export const isClaudeGrant = grant => isProviderGrant(PROVIDERS[0], grant);
export function grantHost(grant) { return clientHosts(grant)[0] || '—'; }
async function allGrants(supabase) {
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('OAuth grants response was not an array');
  return data;
}
// Every grant that belongs to a known AI app, so one request serves all cards.
export async function listConnectorGrants(supabase) {
  return (await allGrants(supabase)).filter(grant => PROVIDERS.some(provider => isProviderGrant(provider, grant)));
}
export async function listClaudeGrants(supabase) {
  return (await allGrants(supabase)).filter(isClaudeGrant);
}
export async function revokeProviderGrants(supabase, provider) {
  // Re-read so every DCR client is included, even if it appeared since opening Details.
  const grants = (await allGrants(supabase)).filter(grant => isProviderGrant(provider, grant));
  const ids = [...new Set(grants.map(grant => grant.client?.id))];
  if (ids.some(id => typeof id !== 'string' || !id)) throw new Error('OAuth grant has no client ID');
  let failure;
  for (const clientId of ids) {
    try {
      const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
      if (error) throw error;
    } catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
}
export const revokeClaudeGrants = supabase => revokeProviderGrants(supabase, PROVIDERS[0]);
