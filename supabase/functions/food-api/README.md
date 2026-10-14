# food-api

Eatabase's authenticated Open Food Facts relay. The source is a Supabase deployment artifact; the PWA does not execute it.

From the Volume repository root, deploy to the existing Volume project:

```sh
supabase login
supabase link --project-ref zhrlrgzpstipojaopnbo
supabase functions deploy food-api --no-verify-jwt
```

The handler verifies every Bearer token with Auth `getUser()` and checks the caller's `cal_access` membership. OPTIONS stays public for CORS; disable legacy gateway JWT verification only for this function. Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

Routes: `GET …/food-api/api/off-search?q=…&n=…&brand=…` returns `{count,hits}`; `GET …/food-api/api/off-product?code=…` looks up a barcode. The current scanner uses Open Food Facts directly for barcode lookup.

`eatabase/config.js` selects the production relay URL and `BACKEND = 'supabase'`. `foodFetch` attaches the current session's Bearer token. Run the whole combined root `schema.sql` before using the backend. Real deployment, RLS and iOS checks remain owner work.
