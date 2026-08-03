# openrails-mcp

Safe-only MCP server for the OpenRails Shared Interface 1.1 surface over stdio. The server can
read the bundled Arc Testnet manifest, prepare operation envelopes, validate envelopes, and verify
Pact-declared Canonical Record bindings.

The MCP process does not create or custody signers, accept private keys, sign wallet requests,
submit transactions, or autonomously relay financial actions. The existing OpenRails keeper relay
remains a separate compatibility path for legacy application and server flows.

## Tools

| Tool | Purpose |
|---|---|
| `openrails_capabilities` | Report Shared Interface capabilities and safe-only execution limits. |
| `openrails_prepare` | Prepare a request envelope for an external wallet or runtime. |
| `openrails_validate` | Validate a request or response envelope against the registry. |
| `openrails_verify` | Verify an envelope and optional Canonical Record binding without claiming financial success. |
| `openrails_read` | Read the bundled network manifest or capability declarations. Other objects need an indexer adapter. |

Canonical Records are optional. A Pact may omit them, allow them, or require them. When present,
the SDK validates the bilateral typed actor signature commitment, Pact party and encrypted key
coverage, exposure policy, and settlement references. Cryptographic actor verification requires an
application verifier. Vault state remains the canonical financial state.

## Configuration

| Var | Default | Notes |
|---|---|---|
| `OPENRAILS_NETWORK_MODE` | `arc-testnet` | Network manifest selected by the safe context. |
| `OPENRAILS_RPC_URL` | `https://rpc.testnet.arc.io` | Displayed configuration only. The MCP does not create an RPC signer or broadcast. |
| `OPENRAILS_CHAIN_ID` | `5042002` | Arc Testnet chain id. |
| `OPENRAILS_HUB_ADDRESS` | `0x941C...6D0b` | Canonical OpenRails Hub configuration. |
| `OPENRAILS_USDC_ADDRESS` | `0x3600...0000` | Arc USDC configuration. |
| `OPENRAILS_RELAY_URL` | deployed keeper | Retained for compatibility reporting. The safe MCP does not call it. |
| `OPENRAILS_APP_BASE_URL` | `https://openrails.pages.dev` | Application reference. |
| `OPENRAILS_EXPLORER_BASE_URL` | `https://testnet.arcscan.app` | Explorer reference. |

No signer key environment variable is accepted by this package.

## Run

```bash
npm install
npm run build
node dist/index.js
```

The MCP server communicates over stdio. A wallet or application integration must authorize and
submit any prepared wallet transaction through its own custody boundary.

## Smoke test

```bash
npm run build && node smoke.mjs
```
