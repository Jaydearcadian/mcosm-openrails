# OpenRails V1: Wrangler Configuration & Deployment Guide

This document provides a configuration blueprint and template `wrangler.toml` layout for deploying the OpenRails sidecars (such as the Subsonic Scrobble Sidecar or Reconciliation Daemon) to Cloudflare Workers using the **Wrangler CLI**.

> [!NOTE]
> Planning and analysis note. Confirm current implementation before treating any item as shipped.

---

## 1. Wrangler Project Setup

To deploy the sidecars as a Cloudflare Worker:
1. Initialize a new wrangler project in your sidecar folder:
   ```bash
   npx wrangler init openrails-music-sidecar
   ```
2. Configure the bindings and settings using the template below.

---

## 2. Template `wrangler.toml` Configuration

Below is the standard demo/testnet-oriented configuration template for the sidecars. It includes the required bindings for **Cloudflare KV** (for MBID-to-wallet mapping lookups) and **Cloudflare D1** (for relational stream state tracking):

```toml
#:schema node_modules/wrangler/config-schema.json
name = "openrails-music-sidecar"
main = "src/index.ts"
compatibility_date = "2026-06-24"

# Environment Variables passed into the Worker (e.g. env.ARC_RPC_URL)
[vars]
ARC_CHAIN_ID = "5042002"
ARC_RPC_URL = "https://rpc.testnet.arc.io"
OPENRAILS_HUB_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
ARC_USDC_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"

# 1. Cloudflare KV Bindings (Maps MBIDs to Creator Wallet Addresses)
[[kv_namespaces]]
binding = "MUSICBRAINZ_REGISTRY"
id = "YOUR_PRODUCTION_KV_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_KV_NAMESPACE_ID"

# 2. Cloudflare D1 Database Bindings (Stores Active Stream Ledger Records)
[[d1_databases]]
binding = "STREAM_DB"
database_name = "openrails_stream_db"
database_id = "YOUR_D1_DATABASE_UUID"

# 3. Scheduled Triggers (For running the Reconciliation Daemon every 1 minute)
[triggers]
crons = ["*/1 * * * *"]
```

---

## 3. Storage Initialisation Commands

Use the Wrangler CLI to instantiate the bound databases before deploying:

### A. Create the KV Namespace (Artist Registry)
Run the following command to create the lookup registry:
```bash
npx wrangler kv:namespace create MUSICBRAINZ_REGISTRY
```
* Wrangler will output a `binding` block with a unique ID. Paste this ID into the `id` field under `[[kv_namespaces]]` in your `wrangler.toml`.

### B. Create the D1 Database (Stream Cache)
Run the following command to spin up the SQL database:
```bash
npx wrangler d1 create openrails_stream_db
```
* Paste the returned `database_id` UUID into the `database_id` field under `[[d1_databases]]` in your `wrangler.toml`.

---

## 4. Deploying to Cloudflare
Once configured, deploy the Worker to the edge network:
```bash
npx wrangler deploy
```
