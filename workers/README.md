# OpenRails Cloudflare Workers Sidecar Setup

This directory contains the serverless event-driven implementation of OpenRails sidecars and public
boundaries: the **Shared Interface Worker**, **Music Scrobble Webhook Worker**, **Reconciliation Cron
Worker**, **Indexer Worker**, and **Faucet Worker**.

---

## 1. Prerequisites

* Cloudflare account and authenticated Wrangler CLI:
  ```bash
  npx wrangler login
  ```

### RPC provider order

RPC-backed Workers use the managed Arc Canteen endpoint first and fail over to the public Arc
endpoints in `wrangler.toml`. Set the managed endpoint as a secret in each Worker directory:

```bash
npx wrangler secret put ARC_CANTEEN_RPC_URL
```

Use the tokenized URL from `arc-canteen rpc-url` as the secret value. Do not commit it or expose it
through a browser environment variable. The configured order is:

1. `ARC_CANTEEN_RPC_URL`
2. `ARC_RPC_URL` (`https://rpc.testnet.arc.io`)
3. `ARC_RPC_FALLBACK_URL` (`https://rpc.drpc.testnet.arc.io`)

---

## 2. Database & KV Setup

### A. Initialize the Key-Value (KV) Store
This store maps MusicBrainz Artist IDs (MBIDs) to artist EVM wallet addresses.
1. Create the KV namespace:
   ```bash
   npx wrangler kv:namespace create MUSICBRAINZ_REGISTRY
   ```
2. Wrangler will output a binding segment with IDs. Copy these into `workers/music-scrobble-worker/wrangler.toml` under `[[kv_namespaces]]`.

### B. Initialize the D1 SQL Database
This database acts as the off-chain cache database tracking pending play events and royalty balances.
1. Create the D1 database:
   ```bash
   npx wrangler d1 create openrails_stream_db
   ```
2. Copy the returned `database_id` UUID into BOTH `wrangler.toml` files:
   * `workers/music-scrobble-worker/wrangler.toml`
   * `workers/reconciliation-worker/wrangler.toml`
3. Execute the database schema initialization:
   * **For Local Sandbox Dev:**
     ```bash
     npx wrangler d1 execute openrails_stream_db --local --file=schema.sql
     ```
   * **For Production Edge Deploy:**
     ```bash
     npx wrangler d1 execute openrails_stream_db --remote --file=schema.sql
     ```

---

## 3. Deploying the Workers

### A. Deploy Music Scrobble Webhook Worker
1. Navigate to the scrobble worker folder and run deploy:
   ```bash
   cd music-scrobble-worker
   npm install
   npx wrangler deploy
   ```
2. Your worker endpoint will be live at `https://openrails-music-scrobble-worker.<subdomain>.workers.dev/webhook/scrobble`. You can point your Subsonic/Navidrome server webhook settings here.

### B. Deploy the Settler Cron Worker (reconciliation-worker)

A cron keeper that periodically **drip-settles active Paycard Streams** so recipients get paid
without anyone clicking "settle". It **only settles** (`processDripSettle`): it never opens or
closes a rail; opening and closure (residual flush) stay with the payer/merchant/creator. Settling
is permissionless and non-custodial: funds always flow payer → recipient per on-chain state; the
keeper only pays gas.

- **`SETTLER_MODE = "chain"` (default):** enumerates active streams from chain
  (`PaycardProvisioned` logs → `registry`): **no D1 required**. Streaming rails settle repeatedly
  once accrued value clears `MIN_ACCRUED_USDC`; one-time (`lifespanSeconds == 0`) rails settle once.
- **`SETTLER_MODE = "d1"`:** legacy: settle only paycards referenced by the music `plays` table
  (needs the D1 setup in §2.B; uncomment `[[d1_databases]]` in the worker `wrangler.toml`).

1. Fund a keeper wallet with Arc testnet gas, then set its key as a secret (never in the repo):
   ```bash
   cd ../reconciliation-worker
   npm install
   npx wrangler secret put RECONCILIATION_SIGNER_KEY
   # paste the funded keeper private key when prompted
   ```
2. (Optional) validate the bundle, then deploy:
   ```bash
   npx wrangler deploy --dry-run   # bundle check, no deploy
   npx wrangler deploy
   ```
3. Runs every minute (`crons = ["* * * * *"]` — Cloudflare Cron Triggers can't go below 1-minute
   granularity, this is the fastest native schedule available); tune interval, `MIN_ACCRUED_USDC`,
   `RECONCILIATION_BATCH_LIMIT`, and `SETTLER_WINDOW_BLOCKS` in `wrangler.toml`. Trigger manually
   with an authenticated `POST /reconcile` when `RECONCILIATION_ADMIN_TOKEN` is set.

**This worker also exposes two public, unauthenticated gasless-relay endpoints** (safety comes
from the envelope's own cryptographic signature, not caller identity — same non-custodial model as
everything else in this project):

- **`POST /relay-claim`** — sponsors gas for a RailsCard claim. Body: `{ envelopeToken, claimRecipient? }`.
  Decodes the signed envelope, checks the payer nonce, balance, and Hub allowance, then does a
  `staticCall` precheck. Invalid claims return `409` before the keeper spends gas. Legacy cards
  with an embedded permit are accepted only while that permit is valid. The worker then
  submits `claimWildcardPaycardChannel`/`openPaycardChannel` on the caller's behalf. This is what
  the SDK's `claimGasless()` (`sdk/src/relay.ts`) calls under the hood. Toggle:
  `RELAY_CLAIMS_ENABLED` (default `true`).
- **`POST /relay-open`** — sponsors gas for a RailsFlow/stream open. Body:
  `{ envelopeToken, permit? }` (an optional EIP-2612 permit lands the approval gaslessly too).
  Same `staticCall`-precheck-then-submit pattern; requires a fixed recipient (rejects wildcard).
  What the SDK's `payGasless()` calls under the hood. Same `RELAY_CLAIMS_ENABLED` toggle.

Each Worker accepts an encrypted `ARC_CANTEEN_RPC_URL` primary, `ARC_RPC_URL`, and an optional
`ARC_RPC_FALLBACK_URL`, in that order. Keep the credentialed Canteen URL in a Wrangler secret.
Independent public providers ensure reads, transaction broadcasts, and receipt polling do not
depend on one RPC service.

### C. Deploy the Indexer Worker (`indexer-worker`)

A factory-aware, durable read API: watches the V2 canonical hub plus every vault clone discovered
via `ArcOpenRailsFactoryV1`'s `CorporateVaultDeployed` event, ingests `PaycardProvisioned` /
`SettlementFlushed` / `ResidualDeltaReclaimed` into its own dedicated D1 database, and exposes a
public, CORS-enabled, GET-only read API (`/vaults`, `/streams`, `/streams/:vaultAddress/:paycardId
/history`, `/workflows/:id`, `/transactions/:hash`) so a static-hosted frontend (e.g. the cockpit on
Cloudflare Pages) can reach indexer-backed reads without needing any backend of its own. Every
response is explicitly `authoritative: false`: the onchain Vault is always the source of truth.

This worker uses its **own** D1 database (`openrails_indexer_db`) rather than the music sidecar's
`openrails_stream_db`, since nothing in this repo has actually provisioned that database yet
(both existing workers still ship with a placeholder `database_id`).

1. Create and seed the dedicated D1 database:
   ```bash
   cd indexer-worker
   npm install
   npx wrangler d1 create openrails_indexer_db
   # copy the returned database_id into indexer-worker/wrangler.toml
   npx wrangler d1 execute openrails_indexer_db --local --file=schema.sql
   npx wrangler d1 execute openrails_indexer_db --remote --file=schema.sql
   ```
2. (Optional) set an admin token to allow manually triggering a backfill tick without waiting for
   the cron:
   ```bash
   npx wrangler secret put INDEXER_ADMIN_TOKEN
   ```
3. Validate and deploy:
   ```bash
   npx wrangler deploy --dry-run
   npx wrangler deploy
   ```
4. Runs every 5 minutes (`crons = ["*/5 * * * *"]`); tune `SCAN_WINDOW_BLOCKS`,
   `MAX_CHUNKS_PER_TICK`, and `INITIAL_BACKFILL_BLOCKS` in `wrangler.toml`. Trigger manually with an
   authenticated `POST /tick` when `INDEXER_ADMIN_TOKEN` is set. Does not index V1 (`0x01EC…`,
   frozen/draining) or attempt reorg rollback: same last-write-wins/append-only policy as
   `stream-gateway` (see `docs/stream_indexing.md`).

### D. Deploy the Faucet Worker (`faucet-worker`)

A capped, self-serve testnet USDC drip for brand-new wallets: on Arc, USDC is also the native
gas token, so one drip covers both. Funded from its **own dedicated keeper wallet**, never the
deployer/governance wallet. Abuse-resistant by design: skips wallets that already hold enough,
cools down per-address *and* per-IP, and caps total drips per day on top of the wallet's own
limited balance.

1. Create the dedicated KV namespace (tracks cooldowns + the daily counter):
   ```bash
   cd faucet-worker
   npm install
   npx wrangler kv namespace create FAUCET_CLAIMS
   # copy the returned id into faucet-worker/wrangler.toml under [[kv_namespaces]]
   ```
2. Generate a dedicated faucet wallet (never reuses the deployer/settler keys) and fund it with a
   small amount of Arc testnet USDC via the Circle faucet UI (`https://faucet.circle.com`):
   ```bash
   npm run faucet:wallet   # prints the address only; key stays in gitignored .bot-wallets/faucet.json
   ```
3. Set secrets, then validate and deploy:
   ```bash
   npx wrangler secret put FAUCET_SIGNER_KEY    # paste the generated private key
   npx wrangler secret put FAUCET_ADMIN_TOKEN   # guards GET /status
   npx wrangler deploy --dry-run
   npx wrangler deploy
   ```
4. `POST /fund` (public, CORS-enabled, body `{"address": "0x…"}`) sends `FAUCET_DRIP_AMOUNT_USDC`
   (default 0.05) if the recipient holds less than `FAUCET_MAX_BALANCE_USDC` (default 0.10),
   subject to a `FAUCET_COOLDOWN_SECONDS` (default 1 day) cooldown per address and per requesting
   IP, and a `FAUCET_MAX_DRIPS_PER_DAY` (default 500) global cap. `FAUCET_ENABLED = "false"` is an
   instant kill switch. `GET /status` (admin-token gated) reports the faucet wallet's balance and
   today's drip count, so you know when it needs a top-up.

### E. Deploy the Shared Interface Worker (`interface-worker`)

This is the public Cloudflare Worker boundary for Shared Interface 1.2. It is separate from the
legacy Express server and does not submit Arc transactions. Its safe routes prepare, validate,
verify, and read interface objects. The Runtime routes persist signed control-plane state in Neon
Postgres. The current public deployment has the migration, database secret, Runtime administration
secret, and signed Runtime execution enabled.

The safe REST and signed Runtime surfaces are deployed at
`https://openrails-interface-worker.microcosm.workers.dev`. The public deployment reports Runtime
`CONFIGURED` with Neon persistence. It does not sign, broadcast, relay, hold keys, or move value.

The free deployment path is Cloudflare Workers Free plus a Neon Free project. D1 is not used for the
Runtime state because the Runtime store requires Postgres JSONB, transactions, row locking, and the
replay-key constraint.

1. Create a free Neon project and copy its PostgreSQL connection string. Keep it out of the repo.
2. Apply the Runtime migration from the repository through the Neon SQL Editor or a local `psql`:
   ```bash
   psql "$DATABASE_URL" -f ../../packages/openrails-runtime/migrations/001_runtime.sql
   ```
3. Set the two Worker secrets:
   ```bash
   cd interface-worker
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put OPENRAILS_RUNTIME_ADMIN_TOKEN
   ```
4. Set `OPENRAILS_RUNTIME_ENABLED = "true"` only after the migration, secret values, and security
   review gate are complete. Then validate and deploy:
   ```bash
   npm install
   npm run typecheck
   npm run bundle:check
   npx wrangler deploy
   ```

The installed Wrangler release requires Node 22. If the repository's default shell selects Node 20,
select the existing Node 22 installation before running Wrangler:

```bash
. "$HOME/.nvm/nvm.sh"
nvm use 22.22.2
```

Routes:

| Method & Path | Purpose | Auth |
|---|---|---|
| `GET /healthz` | Worker and Runtime configuration status. | none |
| `GET /api/interface/1.2.0/capabilities` | Shared Interface, Canonical Record, Circle boundary, and Runtime declarations. | none |
| `POST /api/interface/1.2.0/prepare` | Prepare a registry-selected operation request. | none; custody fields rejected |
| `POST /api/interface/1.2.0/validate` | Validate a request or response envelope. | none; custody fields rejected |
| `POST /api/interface/1.2.0/verify` | Verify an envelope and optional Canonical Record policy. | none; custody fields rejected |
| `GET /api/interface/1.2.0/read/:type/:id` | Read the shipped network or capability manifest. | none |
| `POST /api/interface/1.2.0/runtime/path` | Verify and persist a wallet-attested application Path. | EIP-191 Path attestation; no custody |
| `POST /api/interface/1.2.0/runtime/execute` | Execute one signed Shared Interface 1.2 Runtime control-plane transition: Workspace, Actor, Path, Intent, Proposal, Pact, or Proof lifecycle. | EIP-712 envelope signature; no custody |
| `POST /api/interface/1.2.0/runtime/discover` | Return wallet-authorized Workspace records and their persisted Runtime lifecycle projection. | EIP-712 envelope signature; no custody |
| `GET /api/interface/1.2.0/runtime/state` | Inspect persisted Runtime state while validating deployment. | `OPENRAILS_RUNTIME_ADMIN_TOKEN` |

The safe routes also remain available at `/api/interface/...` and `/api/v1/interface/...` for
compatibility. The Runtime endpoint never signs, broadcasts, relays, holds private keys, or moves
value. Financial settlement remains the existing wallet or keeper boundary. The Path route uses
the application-specific EIP-191 attestation defined by the Runtime deployment; the admin token
is reserved for persisted state inspection and operational controls.

Runtime discovery uses signed `workspace.list` and `workspace.get` reads. Visibility is limited to
the Workspace authority or a wallet-bound Actor associated with that Workspace. Wrong methods return
`405` with `Allow`; temporary Neon or RPC failures return retryable `503` responses. The App keeps
browser-only payment activity as a supplemental projection and does not treat it as Runtime or Arc
financial authority.

When the Cockpit needs the public safe interface without redirecting its legacy gateway calls, set
`VITE_OPENRAILS_INTERFACE_BASE` to the Worker URL. Keep it separate from
`VITE_OPENRAILS_API_BASE`.
