# food-api

Eatabase's authenticated Open Food Facts relay. The source is a Supabase deployment artifact; the PWA does not execute it.

From the Volume repository root, deploy to the existing Volume project:

```sh
supabase login
supabase link --project-ref zhrlrgzpstipojaopnbo
supabase functions deploy food-api --no-verify-jwt
```

The handler verifies every Bearer token with Auth `getUser()` and checks the caller's `cal_access` membership. OPTIONS stays public for CORS; disable legacy gateway JWT verification only for this function. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. The service key is used only for the protected budget RPC; it is never sent to the browser or Open Food Facts.

Routes: `GET …/food-api/api/off-search?q=…&n=…&brand=…` returns `{count,hits}`; `GET …/food-api/api/off-product?code=…` looks up a barcode. Barcode scans and selected search results both use this authenticated product route. It reads `/api/v3.6/product` and returns the v3 status/result envelope and explicit `nutrition.input_sets`. Text search remains on Search-a-licious and keeps its independent `{count,hits}` contract.

`eatabase/config.js` selects the production relay URL and `BACKEND = 'supabase'`. `foodFetch` attaches the current session's Bearer token. Run the whole combined root `schema.sql` before using the backend. Real deployment, RLS and iOS checks remain owner work.

## Product API / serving-size upgrade

Deploy in this order:

1. Run the **whole root `schema.sql`** in the existing project’s SQL editor. The additive migration retains legacy gram entries and adds explicit millilitres plus food/size metadata snapshots. RLS and access policies remain in place.
2. Deploy this function with the command above. It preserves missing-product envelopes, returns upstream 429 distinctly, and carries Retry-After where provided. Only authorized callers can read its opportunistic per-instance product cache. This cache is not a distributed upstream quota guarantee.
3. Publish the updated frontend, including `food-product.js` and service worker **v8**. Close/reopen older Safari and installed-app tabs so they pick up the unit-aware interface. Older clients can keep logging grams, but cannot display new ml entries correctly.

Frontend changes: explicit packaged-product search (typing still searches local BLS/Recent), one detailed product load per uncached selection/scan, serving/package shortcuts from structured fields only, manual g/ml entry, saved repeat amounts, and retry/label-entry recovery without discarding the selected name. Missing serving sizes default to manual 100 g/ml rather than a full package. CSV adds `amount_unit`.

The new device product cache (`eatabase-off-cache-v2`) accepts only the new adapter shape, expires successful reads after seven days and misses after one day, and retains validated stale details as an explicit offline/deleted-record fallback. The service worker caches the app shell, not API responses or user data.

Recorded-fixture/local checks are in `caltech/api-upgrade/` (intentionally untracked). They cover parser units and conflicts, old/new storage round-trips, browser logging/edit/repeat/recovery, relay authorization and throttle behavior, and an isolated PostgreSQL migration run. No live schema or function deployment is performed by those checks.


## Server-side request limits

Run the **whole root `schema.sql` before deploying this function**. It adds
`food_api_budgets` and `take_food_api_budget(uuid, text)`. The table is inaccessible
to browser roles; only the service role can call the RPC. The handler uses the
user ID returned by Auth, never a client-supplied ID.

Rolling 60-second limits, shared across all instances:

| Route | Per account | Whole app |
| --- | ---: | ---: |
| Search | 20 | 30 |
| Product | 15 | 15 |

The database locks the global bucket before checking both budgets, preventing
concurrent requests from overspending. Rejected requests do not extend the wait.
All authorized requests count, including cached products and invalid inputs.
A denied budget returns HTTP 429 with `Retry-After`; missing/broken budget RPCs
return 503 without contacting Open Food Facts. Existing frontend cooldown handling
already supports these responses. These limits cover this relay, not other
services sharing the upstream IP address.

Regression checks from the repository root (Deno required):

```sh
deno run -A tests/security-db.test.ts
deno run --allow-read tests/food-api.test.ts
```

The SQL test uses an isolated PGlite PostgreSQL engine and stubs only cron
scheduling. It does not connect to production. See `SECURITY-SETUP.md` at the
repository root for Auth settings and deployment steps.
