// Eatabase food relay: a Supabase Edge Function serving /api/off-search and
// /api/off-product. Same contract as the local development relay,
// so the frontend only changes its base URL (eatabase/config.js API_BASE).
//
// Why it exists: Open Food Facts' search service sends no CORS header, so a
// browser can't call it directly. This relays the call from Supabase instead.
//
// Why it needs a logged-in user: the relay must not be an open proxy. Every
// request spends from OFF's shared rate limit (~10 searches/min per IP), so
// anyone who found the URL could burn it for everyone else.

import { createClient } from 'npm:@supabase/supabase-js@2';

const UA = 'Eatabase/0.2 (https://github.com/thel-01/volume)';
const PRODUCT_FIELDS = 'code,schema_version,product_name,product_name_de,product_name_en,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutrition.input_sets,last_modified_t';
// Opportunistic edge-instance caching; upstream limits still apply across instances.
const productCache = new Map<string, { at:number; body:unknown }>();
class UpstreamError extends Error {
  constructor(message:string, public status:number, public retryAfter:string | null = null) { super(message); }
}
const FIELDS = 'code,product_name,product_name_de,brands,quantity,nutriments,unique_scans_n';
// Query-syntax characters OFF's search treats as operators; typed text must not use them.
const SEARCH_NOISE = new Set([...'()[]{}:"\\/^~*?!+-']);
// Brand names keep their letters and spaces, but these would break the brands:"..." filter.
const BRAND_NOISE = new Set([...'"\\:()']);
const MAX_PAGE_SIZE = 50;
class InvalidInput extends Error {}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(status: number, body: unknown, retryAfter?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter, 'Access-Control-Expose-Headers': 'Retry-After' } : {}) },
  });
}

/** True only for a request carrying a valid Supabase login (the user's JWT). */
/** 'ok', 'anon' (no valid login) or 'denied' (logged in, but not on Eatabase's access list). */
async function access(req: Request): Promise<'ok' | 'anon' | 'denied'> {
  const authorization = req.headers.get('Authorization');
  if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) return 'anon';
  // Same client setup as a normal app page, but with the caller's token, so
  // getUser() checks *their* session rather than the anon key.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return 'anon';
  // Same list the cal_* tables enforce (public.cal_access, schema.sql).
  const allowed = await supabase.rpc('cal_allowed');
  return !allowed.error && allowed.data === true ? 'ok' : 'denied';
}

async function fetchJson(url: string, allowMissing = false): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok && !(allowMissing && res.status === 404)) throw new UpstreamError(`Open Food Facts answered HTTP ${res.status}`, res.status, res.headers.get('Retry-After'));
  return res.json();
}

/** Same as Python's int(): optional spaces and sign, digits only. Anything else is an error. */
function parsePageSize(raw: string): number {
  if (!/^\s*[+-]?\d+\s*$/.test(raw)) throw new InvalidInput('Invalid page size.');
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PAGE_SIZE) throw new InvalidInput('Page size must be 1–50.');
  return n;
}

async function offSearch(params: URLSearchParams): Promise<unknown> {
  if ((params.get('q') ?? '').length > 100) throw new InvalidInput('Query must be at most 100 characters.');
  if ((params.get('brand') ?? '').length > 80) throw new InvalidInput('Brand must be at most 80 characters.');
  let q = [...(params.get('q') ?? '')].map(c => (SEARCH_NOISE.has(c) ? ' ' : c)).join('').trim();
  const n = parsePageSize(params.get('n') ?? '20');
  // Optional brand filter, spelled as on the products ("Gut & Günstig").
  const brand = [...(params.get('brand') ?? '')].filter(c => !BRAND_NOISE.has(c)).join('').trim();
  if (brand) q = `${q} brands:"${brand}"`;
  const search = new URLSearchParams({
    q: `${q} countries_tags:"en:germany"`,
    langs: 'de,en',
    page_size: String(n),
    fields: FIELDS,
  });
  const body = await fetchJson(`https://search.openfoodfacts.org/search?${search}`) as { count?: number; hits?: unknown[] };
  return { count: body.count ?? null, hits: body.hits ?? [] };
}

async function offProduct(params: URLSearchParams): Promise<unknown> {
  const code = params.get('code') ?? '';
  if (!/^\d{8,14}$/.test(code)) throw new InvalidInput('Barcode must be 8–14 digits.');
  const cached = productCache.get(code);
  if (cached && Date.now() - cached.at < 3600e3) return cached.body;
  const body = await fetchJson(`https://world.openfoodfacts.org/api/v3.6/product/${code}.json?fields=${PRODUCT_FIELDS}&lc=de`, true) as { result?: { id?:string } };
  if (body.result?.id === 'product_found' || body.result?.id === 'product_not_found') {
    if (productCache.size >= 500) productCache.delete(productCache.keys().next().value!);
    productCache.set(code, { at:Date.now(), body });
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { pathname, searchParams } = new URL(req.url);
  // Matched on the suffix: Supabase serves this under /functions/v1/food-api/...
  const route = req.method !== 'GET' ? null
    : pathname.endsWith('/api/off-search') ? offSearch
    : pathname.endsWith('/api/off-product') ? offProduct
    : null;
  if (!route) return json(404, { error: 'not found' });

  try {
    const who = await access(req);
    if (who === 'anon') return json(401, { error: 'log in to use food search' });
    if (who === 'denied') return json(403, { error: 'Eatabase isn’t open for this account yet' });
    return json(200, await route(searchParams));
  } catch (e) {
    // Surface upstream failures to the page, never hang.
    const throttled = e instanceof UpstreamError && e.status === 429;
    return json(e instanceof InvalidInput ? 400 : throttled ? 429 : 502, { error: e instanceof Error ? e.message : String(e), kind: throttled ? 'throttled' : 'unavailable' }, e instanceof UpstreamError ? e.retryAfter : null);
  }
});
