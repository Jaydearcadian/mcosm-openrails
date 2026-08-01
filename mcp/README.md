# openrails-mcp

MCP server that lets an agent transact on the OpenRails USDC rail (Arc) over stdio. Opens and
claims are **gasless by default** through the keeper relay. The server is
**non-custodial**: it signs with its own configured account and never holds anyone else's keys.

## Tools

| Tool | Purpose |
|---|---|
| `openrails_config` | Network config, the server signer address, and its USDC balance. Read-only. |
| `pay_link` | Pay an OpenRails link: a RailsFlow request (the signer becomes the payer, gasless open) or a RailsCard (claimed to the signer). Returns the tx hash. |
| `create_request_link` | Create a RailsFlow request link to **receive** payment. No signing/tx. |
| `issue_railscard` | Reserve Hub allowance and issue a claimable RailsCard on its own nonce lane. Returns the claim link, paycardId, and approval transaction hash when approval was needed. |
| `paycard_status` | Read a paycard/stream state from chain by id. |

## Configuration (env)

| Var | Default | Notes |
|---|---|---|
| `OPENRAILS_MCP_SIGNER_KEY` | none | Dev signer (raw key). Omit for read-only. For prod, wire a Turnkey/Privy account via `openrails-sdk/adapters` (see below). |
| `OPENRAILS_RPC_URL` | `https://rpc.testnet.arc.io` | Public Arc RPC. |
| `OPENRAILS_CHAIN_ID` | `5042002` | |
| `OPENRAILS_HUB_ADDRESS` | `0x941C…6D0b` | Canonical V2 Hub. |
| `OPENRAILS_USDC_ADDRESS` | `0x3600…0000` | |
| `OPENRAILS_RELAY_URL` | deployed keeper | Sponsors gas for opens/claims. |
| `OPENRAILS_APP_BASE_URL` | `https://openrails.pages.dev` | Base for generated links. |
| `OPENRAILS_EXPLORER_BASE_URL` | `https://testnet.arcscan.app` | |

## Run

```bash
npm install && npm run build
OPENRAILS_MCP_SIGNER_KEY=0x... node dist/index.js   # stdio server
```

Register with an MCP client (e.g. Claude Desktop `mcpServers`):

```json
{
  "openrails": {
    "command": "npx",
    "args": ["openrails-mcp"],
    "env": { "OPENRAILS_MCP_SIGNER_KEY": "0x..." }
  }
}
```

Smoke test: `OPENRAILS_MCP_SIGNER_KEY=0x... node smoke.mjs [paycardId]`.

`issue_railscard` sends an approval transaction when additional Hub allowance is required. The
configured signer must have enough Arc testnet USDC for the card allocation and transaction gas.
The card itself is claimed through the sponsored relay.

## Signer is pluggable

The server builds its signer via the SDK account abstraction (`openrails-sdk`). Dev uses a raw key
(`ethersToSubmitter`); for production swap in `turnkeyToAccount` (server wallets / agents) or
`privyToAccount` (humans) from `openrails-sdk/adapters/*` in `src/context.ts`. Because the OpenRails
Hub authenticates the signature (not `msg.sender`), any EOA-backed account works with no contract
change.
