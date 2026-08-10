# OpenRails Harness Setup

The harness setup command configures the existing local environment and runs a non-destructive preflight across the repository, Arc RPC, Arc Canteen, GitHub, Wrangler, NPM, and the local browser.

Run it from the repository root:

```bash
npm run harness:setup
```

The command checks the ignored root `.env` and `cockpit/.env.local` files before prompting. Existing valid values are retained. Secret input is hidden, and secret values are never printed. Server-side values are written to `.env`; browser-safe `VITE_*` values are written to `cockpit/.env.local`.

The browser must only receive public configuration. Do not put private keys, Arc Canteen credentials, Worker admin tokens, NPM tokens, Circle API secrets, or entity secrets in a `VITE_*` variable.

To inspect existing Cloudflare Worker secret names and provision only missing values, run:

```bash
npm run harness:setup -- --sync-cloudflare
```

This requires an authenticated Wrangler session. Existing Worker secrets are retained unless `--replace-existing` is explicitly supplied. The command uses `wrangler secret put`; it does not deploy Workers or create new Cloudflare databases, buckets, or routes.

The harness recognizes a standalone `wrangler` executable automatically. To use the repository's `npx wrangler` convention explicitly, run:

```bash
npm run harness:setup -- --sync-cloudflare --npx-wrangler
```

The explicit npx mode uses `npx --yes wrangler` so a first-time package resolution cannot wait for an interactive install confirmation.

Useful read-only mode:

```bash
npm run harness:setup -- --check
```

The NPM session token is not persisted by this setup command. Use a temporary `NPM_TOKEN` or an authenticated `npm login` session only at the SDK or MCP publication step.
