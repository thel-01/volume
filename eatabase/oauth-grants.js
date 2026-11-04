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
const claudeHost = host => ['claude.ai', 'claude.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
export function isClaudeGrant(grant) {
  return /claude/i.test(grant?.client?.name || '') || clientHosts(grant).some(claudeHost);
}
export function grantHost(grant) { return clientHosts(grant)[0] || '—'; }
export async function listClaudeGrants(supabase) {
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('OAuth grants response was not an array');
  return data.filter(isClaudeGrant);
}
export async function revokeClaudeGrants(supabase) {
  // Re-read so every DCR client is included, even if it appeared since opening Details.
  const grants = await listClaudeGrants(supabase);
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
