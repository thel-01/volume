// Stateless, user-scoped MCP endpoint. Deploy with --no-verify-jwt: discovery
// must be public, and access() verifies every MCP request before dispatch.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Server } from 'npm:@modelcontextprotocol/sdk@1.29.0/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.29.0/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, type CallToolRequest } from 'npm:@modelcontextprotocol/sdk@1.29.0/types.js';

const PROJECT_URL = 'https://zhrlrgzpstipojaopnbo.supabase.co';
const RESOURCE = `${PROJECT_URL}/functions/v1/eatabase-mcp`;
const ISSUER = `${PROJECT_URL}/auth/v1`;
// This URL is routed to the function by the Supabase gateway. The RFC 9728
// origin-root URL is outside an Edge Function's routing boundary.
const METADATA_URL = `${RESOURCE}/.well-known/oauth-protected-resource`;
const BASE_PATH = '/functions/v1/eatabase-mcp';
const METADATA_PATHS = new Set([
  `${BASE_PATH}/.well-known/oauth-protected-resource`,
  `${BASE_PATH}/.well-known/oauth-protected-resource${BASE_PATH}`,
  `${BASE_PATH}/oauth-protected-resource`,
  `/.well-known/oauth-protected-resource${BASE_PATH}`,
]);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, apikey, x-client-info, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
};
const KEYS = ['kcal', 'protein', 'carbs', 'fat'] as const;
type Nutrient = typeof KEYS[number];
type Client = ReturnType<typeof userClient>;
type Entry = { id: string; name: string; meal: string | null; day: string; logged_at: string } & Record<Nutrient, number | null>;
const ENTRY_COLUMNS = 'id,day,name,meal,kcal,protein,carbs,fat,logged_at';
const daySchema = {
  type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'Only pass day (YYYY-MM-DD) for a specific date the user names. Omit it for today; use days_back for yesterday or earlier tracking days. Do not combine with days_back.',
};
const daysBackSchema = {
  type: 'integer', minimum: 0, maximum: 30,
  description: 'Tracking days before today: 0 = today, 1 = yesterday, up to 30. Omit day when using this.',
};
const relativeDayDescription = ' Omit day when the user means today; use days_back for yesterday or earlier. The user’s tracking day can end after midnight and differ from the calendar date. Only pass day for a specific date the user names.';
// Match quicklog's input bounds, which also fit cal_entries numeric precision.
const LIMITS = { kcal: 10000, protein: 1000, carbs: 1000, fat: 1000 };
const TOOLS = [
  {
    name: 'log_food',
    description: 'Add one meal or food to the user’s Eatabase log. Use a short descriptive name and the supplied or agreed nutrition estimates. A call creates a new entry: do not repeat after a successful save. Omit unknown macros; never use zero for unknown values. If meal is omitted, it stays unassigned (Other in the app).' + relativeDayDescription,
    inputSchema: {
      type: 'object' as const, additionalProperties: false, required: ['name', 'kcal'],
      properties: {
        day: daySchema, days_back: daysBackSchema,
        name: { type: 'string', minLength: 1, maxLength: 160, description: 'A name the user will see, for example Restaurant: ribeye, fries, salad.' },
        kcal: { type: 'number', minimum: 0, maximum: LIMITS.kcal, description: 'Total calories for this entry, not per 100 g.' },
        ...Object.fromEntries(KEYS.slice(1).map(key => [key, { type: 'number', minimum: 0, maximum: LIMITS[key], description: `Total ${key} in grams. Omit if unknown; zero means known to be zero.` }])),
        meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'], description: 'Optional meal group. Omit if unsure.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'get_day',
    description: 'Read the user’s entries and totals for a local date, plus current configured goals. Each nutrient total includes value, missing and count: missing values make it a lower bound. Goals are current settings, not historical goals.' + relativeDayDescription,
    inputSchema: { type: 'object' as const, additionalProperties: false, properties: { day: daySchema, days_back: daysBackSchema } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'delete_entry',
    description: 'Permanently remove one of the user’s log entries. Use the exact id returned by get_day or log_food and only delete when the user asks. Repeating the same deletion has no further effect.',
    inputSchema: { type: 'object' as const, additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid', description: 'The entry id, not a food id.' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

function unauthorized(): Response {
  return json(401, { error: 'Sign in to Eatabase with an access token intended for this MCP server.' }, {
    'WWW-Authenticate': `Bearer resource_metadata="${METADATA_URL}"`,
  });
}

function userClient(token: string) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// A project token alone is not enough: MCP requires resource audience binding.
// getClaims verifies the signature/expiry through Supabase JWKS. Asymmetric
// signing keys are required; verification failures return 401.
async function access(req: Request): Promise<{ client: Client; userId: string } | Response> {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!match) return unauthorized();
  const client = userClient(match[1]);
  const { data, error } = await client.auth.getClaims(match[1])
    .catch(() => ({ data: null, error: true }));
  const claims = data?.claims;
  if (error || !claims || claims.iss !== ISSUER || typeof claims.sub !== 'string' || !claims.sub ||
    claims.role !== 'authenticated' || claims.is_anonymous === true ||
    !(Array.isArray(claims.aud) ? claims.aud.includes(RESOURCE) : claims.aud === RESOURCE)) return unauthorized();
  const allowed = await client.rpc('cal_allowed');
  if (allowed.error) return json(503, { error: 'Eatabase access could not be checked. Try again shortly.' });
  if (allowed.data !== true) return json(403, { error: 'Eatabase isn’t open for this account yet.' });
  return { client, userId: claims.sub };
}

class ToolInputError extends Error {}
class DatabaseError extends Error {}
async function takeBudget(userId: string, name: string) {
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const budget = await admin.rpc('take_eatabase_mcp_budget', { p_user_id: userId, p_tool: name });
    const retry = budget.data;
    if (budget.error || !Number.isInteger(retry) || retry < 0 || retry > 86400) throw new DatabaseError();
    if (retry > 0) throw new ToolInputError(`Eatabase's ${name} limit was reached. No action was taken. Wait ${retry} seconds before another call. Stop retrying now and tell the user about the limit and wait time.`);
  } catch (error) {
    if (error instanceof ToolInputError) throw error;
    throw new ToolInputError('Eatabase could not check your limit. No action was taken. Wait 60 seconds before another call. Stop retrying now and tell the user that Eatabase is temporarily unavailable.');
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolInputError('Provide an object containing the tool inputs.');
  return value as Record<string, unknown>;
}
function only(args: Record<string, unknown>, fields: string[]) {
  if (Object.keys(args).some(key => !fields.includes(key))) throw new ToolInputError(`Use only these fields: ${fields.join(', ')}.`);
}
function day(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ToolInputError('day must be a real local date in YYYY-MM-DD form. Ask the user if unsure.');
  }
  return value;
}
// Read the caller's settings through the same RLS-scoped client as entries.
async function trackingDay(client: Client, userId: string, daysBack: number): Promise<string> {
  const settings = await client.from('cal_settings').select('day_end_hour,time_zone').eq('user_id', userId).maybeSingle();
  if (settings.error) throw new DatabaseError();
  if (!settings.data?.time_zone) throw new ToolInputError("Eatabase has no saved time zone for your account. Open Eatabase while signed in and connected, then try again — or tell me the date.");
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.data.time_zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
  } catch { throw new ToolInputError('Eatabase could not use your saved time zone. Open Eatabase once, then try again — or tell me the date.'); }
  const local = Object.fromEntries(parts.map(part => [part.type, part.value]));
  // UTC is only a calendar arithmetic container, never the user's local instant.
  const date = new Date(`${local.year}-${local.month}-${local.day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (Number(local.hour) < (settings.data.day_end_hour ?? 0) ? 1 : 0) - daysBack);
  return date.toISOString().slice(0, 10);
}
function dayLabel(date: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date(`${date}T00:00:00Z`));
  const label = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${label.weekday}, ${label.day} ${label.month}`;
}
function nutrition(args: Record<string, unknown>): Record<Nutrient, number | null> {
  return Object.fromEntries(KEYS.map(key => {
    const value = args[key];
    if (value === undefined && key !== 'kcal') return [key, null];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMITS[key]) {
      throw new ToolInputError(`${key} must be a number from 0 to ${LIMITS[key]}.${key !== 'kcal' ? ' Omit it if unknown.' : ''}`);
    }
    // cal_entries stores numeric(..., 1); return exactly what will be saved.
    return [key, Math.round(value * 10) / 10];
  })) as Record<Nutrient, number | null>;
}
function entry(row: Entry): Entry {
  return { ...row, ...Object.fromEntries(KEYS.map(key => [key, row[key] == null ? null : Number(row[key])])) };
}
function totals(entries: Entry[]) {
  return Object.fromEntries(KEYS.map(key => [key, {
    value: Math.round(entries.reduce((sum, row) => sum + (row[key] ?? 0), 0) * (key === 'kcal' ? 1 : 10)) / (key === 'kcal' ? 1 : 10),
    missing: entries.filter(row => row[key] == null).length,
    count: entries.length,
  }]));
}
async function entriesForDay(client: Client, userId: string, date: string): Promise<Entry[]> {
  const rows: Entry[] = [];
  // Page below PostgREST's default 1000-row cap; stable tie-breaker avoids loss.
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const result = await client.from('cal_entries').select(ENTRY_COLUMNS).eq('user_id', userId).eq('day', date)
      .order('logged_at').order('id').range(offset, offset + size - 1);
    if (result.error) throw new DatabaseError();
    const page = (result.data ?? []) as Entry[];
    rows.push(...page.map(entry));
    if (page.length < size) return rows;
  }
}
function result(value: Record<string, unknown>, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : { structuredContent: value }) };
}

function rpcError(code: number, message: string, id: string | number | null = null): Response {
  return json(400, { jsonrpc: '2.0', id, error: { code, message } });
}

async function message(req: Request): Promise<{ body: unknown } | Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return rpcError(-32700, 'Parse error: invalid JSON.'); }
  // SDK 1.29 labels invalid envelopes as parse errors. Distinguish valid JSON
  // from an invalid JSON-RPC request here, as JSON-RPC 2.0 requires.
  if (!body || typeof body !== 'object' || Array.isArray(body)) return rpcError(-32600, 'Invalid Request: send one JSON-RPC message.');
  const value = body as Record<string, unknown>;
  const validId = typeof value.id === 'string' || (typeof value.id === 'number' && Number.isFinite(value.id));
  if (value.jsonrpc !== '2.0' || ('id' in value && !validId)) return rpcError(-32600, 'Invalid Request.');
  if ('method' in value) {
    if (typeof value.method !== 'string') return rpcError(-32600, 'Invalid Request: method must be a string.');
    if ('params' in value && (!value.params || typeof value.params !== 'object' || Array.isArray(value.params))) {
      return rpcError(-32602, 'Invalid params: provide an object.', validId ? value.id as string | number : null);
    }
  } else if (!validId || (('result' in value) === ('error' in value))) {
    return rpcError(-32600, 'Invalid Request.');
  }
  return { body };
}

async function callTool(client: Client, userId: string, name: string, value: unknown) {
  if (!TOOLS.some(tool => tool.name === name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  let saved: Entry | undefined;
  try {
    const args = object(value ?? {});
    if (name === 'delete_entry') {
      only(args, ['id']);
      if (typeof args.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.id)) throw new ToolInputError('id must be the entry UUID returned by get_day or log_food.');
      await takeBudget(userId, name);
      const removed = await client.from('cal_entries').delete().eq('user_id', userId).eq('id', args.id).select(ENTRY_COLUMNS).maybeSingle();
      if (removed.error) throw new DatabaseError();
      if (!removed.data) return result({ id: args.id, deleted: false, message: 'No matching entry exists in your log. It may already have been deleted.' });
      return result({ id: args.id, deleted: true, entry: entry(removed.data as Entry) });
    }
    only(args, name === 'log_food' ? ['day', 'days_back', 'name', ...KEYS, 'meal'] : ['day', 'days_back']);
    if (args.day !== undefined && args.days_back !== undefined) throw new ToolInputError('Use either day or days_back, not both.');
    if (args.days_back !== undefined && (typeof args.days_back !== 'number' || !Number.isInteger(args.days_back) || args.days_back < 0 || args.days_back > 30)) {
      throw new ToolInputError('days_back must be an integer from 0 to 30.');
    }
    const explicitDate = args.day === undefined ? undefined : day(args.day);
    if (name === 'log_food') {
      if (typeof args.name !== 'string' || !args.name.trim() || Array.from(args.name).length > 160) throw new ToolInputError('name must contain 1–160 characters and describe the food or meal.');
      if (args.meal !== undefined && !['breakfast', 'lunch', 'dinner', 'snack'].includes(args.meal as string)) throw new ToolInputError('meal must be breakfast, lunch, dinner or snack, or omit it.');
    }
    const values = name === 'log_food' ? nutrition(args) : null;
    // Pure input errors do not consume quota; relative-day reads still do.
    await takeBudget(userId, name);
    const date = explicitDate ?? await trackingDay(client, userId, (args.days_back as number | undefined) ?? 0);
    if (name === 'log_food') {
      // Same snapshot as quicklog.js -> store-supabase.js entryToRow().
      // Explicit null millilitres satisfies the later amount_matches_basis rule.
      const row = {
        id: crypto.randomUUID(), user_id: userId, day: date, logged_at: new Date().toISOString(),
        meal: args.meal ?? null, source: 'quick', source_ref: null, name: args.name,
        basis: 'once', grams: null, millilitres: null, portions: null,
        base_kcal: null, base_protein: null, base_carbs: null, base_fat: null, ...values,
      };
      const inserted = await client.from('cal_entries').insert(row).select(ENTRY_COLUMNS).single();
      if (inserted.error || !inserted.data) throw new DatabaseError();
      saved = entry(inserted.data as Entry);
      // Do not let a failed follow-up read encourage duplicate insertion.
      const entries = await entriesForDay(client, userId, date);
      return result({ saved: true, day: saved.day, day_label: dayLabel(saved.day), entry: saved, totals: totals(entries) });
    }
    const [entries, settings] = await Promise.all([
      entriesForDay(client, userId, date),
      client.from('cal_settings').select('nutrients,meals,day_end_hour').eq('user_id', userId).maybeSingle(),
    ]);
    if (settings.error) throw new DatabaseError();
    const nutrients = settings.data?.nutrients as Record<string, { on?: boolean; goal?: number; type?: string }> | undefined;
    const goals = Object.fromEntries(KEYS.filter(key => nutrients?.[key]?.on !== false && nutrients?.[key]?.goal != null).map(key => [key, nutrients![key]]));
    return result({ day: date, day_label: dayLabel(date), entries, totals: totals(entries), goals: Object.keys(goals).length ? goals : null,
      meals: settings.data?.meals ?? true, day_end_hour: settings.data?.day_end_hour ?? 0 });
  } catch (error) {
    if (saved) return result({ saved: true, day: saved.day, day_label: dayLabel(saved.day), entry: saved, totals: null, message: 'Entry saved. Totals are temporarily unavailable. Use get_day to refresh; do not log this entry again.' });
    return result({ error: error instanceof ToolInputError ? error.message : name === 'log_food'
      ? 'Could not confirm the save. Check get_day before retrying to avoid a duplicate.'
      : 'Could not read or delete your data. Try again shortly.' }, true);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Validate browser origins even on OPTIONS. Server-to-server clients normally
  // omit Origin. Add other browser clients/site origins via this optional secret.
  const origin = req.headers.get('Origin');
  const origins = [PROJECT_URL, 'https://claude.ai', 'https://chatgpt.com', ...(Deno.env.get('MCP_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim())];
  if (origin && !origins.includes(origin)) return json(403, { error: 'Browser origin is not allowed.' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const rawPath = new URL(req.url).pathname.replace(/\/$/, '');
  // Hosted/local gateways may strip /functions/v1 before invoking the worker.
  const path = rawPath === '/eatabase-mcp' || rawPath.startsWith('/eatabase-mcp/') ? `/functions/v1${rawPath}` : rawPath;
  if (METADATA_PATHS.has(path)) {
    if (req.method !== 'GET') return json(405, { error: 'Use GET for resource metadata.' }, { Allow: 'GET, OPTIONS' });
    return json(200, { resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ['header'], resource_name: 'Eatabase' });
  }
  if (path !== BASE_PATH) return json(404, { error: 'not found' });
  let server: Server | undefined;
  try {
    const who = await access(req);
    if (who instanceof Response) return who;
    // No persistent SSE stream or session exists to open or terminate.
    if (req.method === 'GET' || req.method === 'DELETE') return json(405, { error: 'This stateless endpoint accepts MCP messages by POST.' }, { Allow: 'POST, OPTIONS' });
    server = new Server({ name: 'eatabase', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, (request: CallToolRequest) => callTool(who.client, who.userId, request.params.name, request.params.arguments));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    // Leave media-type errors to the transport, without reading an unrelated body.
    const parsed = req.method === 'POST' && req.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json'
      ? await message(req) : undefined;
    if (parsed instanceof Response) return parsed;
    const response = await transport.handleRequest(req, parsed ? { parsedBody: parsed.body } : undefined);
    // Consume before closing so the SDK can finish its asynchronous dispatch.
    const body = await response.text();
    const headers = new Headers(response.headers);
    Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
    headers.set('Cache-Control', 'no-store');
    return new Response(response.status === 202 || response.status === 204 ? null : body, { status: response.status, headers });
  } catch {
    return json(503, { error: 'Eatabase is temporarily unavailable. Check get_day before retrying a write.' });
  } finally {
    await server?.close();
  }
});
