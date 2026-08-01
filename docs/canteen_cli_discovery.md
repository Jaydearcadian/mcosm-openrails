# Arc Canteen RPC Operations

OpenRails uses Arc Canteen as the managed primary RPC provider for server-side Cloudflare Workers.
Public Arc RPC endpoints remain configured as fallbacks.

## Provider order

1. `ARC_CANTEEN_RPC_URL`: tokenized Worker secret returned by `arc-canteen rpc-url`
2. `ARC_RPC_URL`: `https://rpc.testnet.arc.io`
3. `ARC_RPC_FALLBACK_URL`: `https://rpc.drpc.testnet.arc.io`

The Canteen URL is server-only. Never place it in a `VITE_*` variable, browser bundle, log, sample
configuration, or committed file.

## CLI checks

```bash
arc-canteen --version
arc-canteen status
```

`arc-canteen status` can display sensitive provider details. Do not paste its full output into logs,
issues, or release notes.

## Cloudflare secret

Set the managed URL separately for each Worker that performs RPC calls:

```bash
npx wrangler secret put ARC_CANTEEN_RPC_URL
```

Paste the output of `arc-canteen rpc-url` at Wrangler's prompt. Rotate the Canteen token when it has
been exposed, then update every Worker secret before revoking the previous token.

Browser clients use only public endpoints. This keeps the managed token private while preserving
provider failover for Cockpit reads and wallet transactions.
