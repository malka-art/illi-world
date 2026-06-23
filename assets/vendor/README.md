# Vendored third-party libraries

Self-hosted so the site loads no third-party script at runtime (important on the
payment-handling `/upgrade` page). Each file is pinned and committed.

## supabase-js-2.103.0.esm.js

- **Package:** `@supabase/supabase-js`
- **Version:** `2.103.0` (matches the extension's pinned version)
- **Format:** single self-contained ES module (zero external imports), minified
- **Used by:** `/upgrade` (`upgrade/index.html`) — `createClient` for `auth.verifyOtp` (silent web sign-in) + `auth.getSession` (carries the session across the Stripe round-trip)
- **License:** MIT (© Supabase) — https://github.com/supabase/supabase-js/blob/master/LICENSE
- **sha256:** `82eb69585e7ca94a89a557ee4cdcd123e224107d93be9202fd1358353cc4fb5c`

### How it was built (reproducible)

```bash
npm install @supabase/supabase-js@2.103.0 esbuild
npx esbuild node_modules/@supabase/supabase-js/dist/index.mjs \
  --bundle --format=esm --platform=browser --target=es2020 --minify --legal-comments=none \
  --outfile=supabase-js-2.103.0.esm.js
```

To upgrade: bump the version, rebuild with the command above, update the filename
+ the import path in `upgrade/index.html`, and refresh the sha256 here.
