# Eatabase MCP

Connect your own Claude account to your Eatabase log. The server offers
`log_food`, `get_day`, and `delete_entry`, using your account and existing RLS.

## Owner setup

1. Run the **full repository `schema.sql`** in the Supabase SQL editor. It is
   the source of truth and safe to paste and re-run in full. It installs the
   access-token hook and restrictive OAuth policies: connector tokens can only
   select/insert/delete their own `cal_entries`, select their `cal_settings`,
   and check membership through `cal_allowed()`. Workout/shared tables, saved
   foods, goal history, settings writes and demo-management RPCs are blocked.
   Ordinary app sessions without `client_id` keep their existing access.

2. **Prerequisite: activate asymmetric JWT signing keys.** In the Supabase
   dashboard → **Settings → JWT Keys**, create/activate an **ECC or RSA** signing
   key before issuing connector tokens. HS256 is unsupported: `getClaims`
   falls back to Auth's `/user` for symmetric keys, and that endpoint rejects
   OAuth client sessions. Verification failures return 401; no extra fallback
   is implemented.
   [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys)

3. Enable **Authentication → OAuth Server**. In **Authentication → URL
   Configuration**, use **Site URL** `https://thel-01.github.io/volume/`; set
   OAuth Server's **Authorization Path** to `/eatabase/connect.html`.
   Supabase trims the Site URL's trailing slash and appends the path, preserving
   `/volume`, so the consent URL is exactly
   `https://thel-01.github.io/volume/eatabase/connect.html`. Do not include
   `/volume` again in Authorization Path. The live dashboard setting has not
   been inspected; confirm it matches before enabling OAuth, and check existing
   login redirects if changing the shared Site URL.
   [Supabase setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started),
   [URL composition implementation](https://github.com/supabase/auth/blob/master/internal/api/oauthserver/authorize.go)

   Keep **Dynamic Client Registration ON** for Claude's **Register automatically**
   option (recommended). Alternatively, preregister an OAuth client with callback
   URL `https://claude.ai/api/mcp/auth_callback`, enter its credentials in Claude,
   and turn DCR off if desired. This implementation does not assume support for
   Claude's newer “published identity” registration method.
   [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)

4. Enable **Authentication → Hooks → Custom Access Token**, selecting
   `public.eatabase_mcp_access_token_hook` installed by step 1. If a hook already
   exists, merge this claim transformation into it instead of replacing existing
   behavior. For non-anonymous OAuth clients, it sets `aud` to the array
   `['authenticated', 'https://zhrlrgzpstipojaopnbo.supabase.co/functions/v1/eatabase-mcp']`.
   Ordinary app sessions retain their audience. All OAuth clients using this
   project's consent page consequently target Eatabase. Reconnect Claude after
   enabling it so it receives a new token.

   The MCP function requires its own URL in the audience and rejects the generic
   audience alone; `authenticated` remains alongside it for the database API.
   Issuance, refresh and PostgREST acceptance have **not** been tested live.
   [Supabase token security](https://supabase.com/docs/guides/auth/oauth-server/token-security),
   [custom token hooks](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook),
   [MCP audience requirement](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

5. Deploy the function (this implementation task does not deploy it):

   ```sh
   supabase functions deploy eatabase-mcp --project-ref zhrlrgzpstipojaopnbo --no-verify-jwt
   ```

   `SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied by Supabase. Every request
   verifies its JWT through `auth.getClaims`, rejects demo users, then calls
   `cal_allowed()`. Entry and settings queries carry your bearer token and obey
   row-level security. A separate client uses `SUPABASE_SERVICE_ROLE_KEY` only
   for the server-only usage-budget RPC. Supabase supplies this secret to the
   hosted function; ensure it is available when running locally.
   [Supabase deployment guide](https://supabase.com/docs/guides/getting-started/byo-mcp)

6. Publish the frontend. `eatabase/connect.html`, `eatabase/connect.js` and the
   updated shared `eatabase/page-init.js` go live through GitHub Pages on push.
   Ensure the consent URL from step 3 is published before connecting Claude.
   This implementation task does not push or publish it.

7. In **claude.ai → Settings → Connectors → Add custom connector** (the current
   UI may call this **Customize → Connectors → Add → Custom → Web**), enter:

   ```text
   https://zhrlrgzpstipojaopnbo.supabase.co/functions/v1/eatabase-mcp
   ```

   Choose sign-in and **Register automatically**; alternatively choose your own
   preregistered OAuth client. Sign in with your existing, allowed Eatabase
   account and approve access on the consent page. Enable the connector in a
   chat and try “Add a 600 kcal lunch called Restaurant: pasta to my Eatabase log
   for 2026-11-03.” Inspect `get_day` before retrying any uncertain write.
   [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

## Behavior and discovery

- Official `@modelcontextprotocol/sdk@1.29.0` web-standard transport, tested under
  Deno. Each request gets a fresh server/transport, no session ID, JSON responses,
  no SSE stream. The SDK handles initialize/negotiation, ping and JSON-RPC
  dispatch. GET and DELETE return 405 after authentication; notifications return
  empty 202. This avoids Node HTTP adapters and a second protocol implementation.
- Public resource metadata is served at
  `/functions/v1/eatabase-mcp/.well-known/oauth-protected-resource`, plus
  `/functions/v1/eatabase-mcp/.well-known/oauth-protected-resource/functions/v1/eatabase-mcp`
  and `/functions/v1/eatabase-mcp/oauth-protected-resource` aliases. Its issuer is
  `https://zhrlrgzpstipojaopnbo.supabase.co/auth/v1`.
- Every 401 includes `WWW-Authenticate: Bearer resource_metadata="…"` pointing to
  the reachable first URL. The handler also recognizes the RFC path
  `/.well-known/oauth-protected-resource/functions/v1/eatabase-mcp`, but Supabase's
  gateway does **not** route origin-root paths into an individual Edge Function.
  Header discovery is the supported route on this deployment. If a client probes
  only the origin-root well-known path and ignores the challenge, an external
  routing layer is needed. That behavior remains to be verified with Claude.
  [MCP discovery rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- `log_food` writes a `source: quick`, `basis: once` snapshot. The name appears in
  the app's entry list (`app.js` passes `e.name` to `listRow`); it is not replaced
  with “Quicklog.” Unknown macros are NULL; explicitly known zero is allowed.
  Bounds match quicklog: 0–10000 kcal, 0–1000 g per macro, stored to one decimal.
  Omitted meal stays NULL even when grouping is enabled, appearing under “Other.”
- Dates are required local dates; the model must ask when uncertain. `get_day`
  returns the configured `day_end_hour` and current settings goals, not historical
  goal history. Totals mirror the app's `{value, missing, count}` per nutrient.
- Browser requests from `https://claude.ai`, `https://chatgpt.com` and the Supabase
  origin are permitted. Add other browser-client/site origins with the optional
  comma-separated `MCP_ALLOWED_ORIGINS` function secret. Server-to-server clients
  do not need an Origin header. CORS allows MCP headers and exposes the challenge.
- Per-user tool limits are 30 log calls per minute and 300 per UTC day;
  reads and deletes each allow 60 calls per minute. Invalid arguments do not
  consume a slot. These limits apply to this Edge Function, not direct database
  requests permitted by the caller's token.
- Log insertion is not idempotent; deletion is idempotent. Tool annotations
  describe that behavior. Client approval UI remains the client's choice.
  Later ChatGPT OAuth interoperation is untested.

## Local verification

```sh
deno test -A tests/eatabase-mcp.test.ts
deno check supabase/functions/eatabase-mcp/index.ts
deno run -A tests/security-db.test.ts
deno run --allow-read tests/food-api.test.ts
deno test --allow-read tests/eatabase-consent.test.ts
git diff --check
```

Tests run the real SDK with a stubbed Supabase client. They need no runtime
network permission, project credentials, browser, or live database. Dependency
downloads may be needed on the first run. The database check runs the full
schema twice in isolated PGlite and checks OAuth RLS/RPC restrictions. Consent tests mock the DOM and Supabase. No live
Supabase requests were made.
