# x402 → Paycard Stream Bridge: Results (non-custodial)

Status date: 2026-06-28. Proven on Arc testnet: a paid x402 request culminates in a **real
OpenRails Vault escrow stream**, opened **non-custodially** from the buyer's own USDC and
**bound to the x402 settlement**. Run via `npm run smoke:x402:stream`
(`experiments/x402-smoke/x402-to-stream.ts`).

## What this proves (and what it does not)

- ✅ Money flows **through the OpenRails rail**: 0.05 USDC of the buyer's own funds is escrowed
  in the Vault (`ArcOpenRailsHubV1`) as a live Paycard Stream.
- ✅ **Non-custodial**: the on-chain `payer` is the buyer; escrow is pulled from the buyer's
  balance via their EIP-712 intent signature; the buyer self-submits `openPaycardChannel`. No
  intermediary ever holds the funds.
- ✅ **Bound to x402**: the stream's off-chain metadata sets
  `metadataRef = circle-x402:<settlementId>`, and `hashOpenRailsMetadata(metadata)` equals the
  on-chain `metadataHash`. Verifiable chain: settlement UUID → metadata → metadataHash → Vault row.
- ⚠️ The x402 **fee** (0.01 USDC) and the **stream escrow** (0.05 USDC) are **separate pots**:
  the fee settles to the seller via Circle; the escrow is the buyer's own funds. This is the
  non-custodial tradeoff. Making the literal x402 dollars become the escrow would require a
  custodial bridge (out of scope, pending custody review).

## Run (2026-06-28)

**x402 leg** (Circle facilitator):
```json
{ "settlementId": "2f03bb36-e873-4913-81d4-aff303771518", "status": "received",
  "fromAddress": "0x1a76…473c", "toAddress": "0x933a…9682", "amount": "10000",
  "sendingNetwork": "eip155:5042002", "facilitatorUrl": "https://gateway-api-testnet.circle.com" }
```

**Stream leg**: real `openPaycardChannel` on Arc testnet:
- `openTxHash`: `0x3693d7a92ef1e712ff37682c769ec7d7805477be416565694fb15ce61738fc0f` (block 49187374)
- `paycardId`: `0xa051ff27822cba6d05e6d4b754d4a2aac1b161a21d4579aa07440b3b52df49a5`

**Authoritative on-chain Vault row** (`GET /api/paycard/:id`, direct RPC: the source of truth):
```json
{ "paycardId": "0xa051ff27822cba6d05e6d4b754d4a2aac1b161a21d4579aa07440b3b52df49a5",
  "payer": "0x1A76BFE6bF7A4BfD854b16C19Dd870e0DE56473C",
  "recipient": "0x933a2405F84c224BE1EF373ba16E992e1F459682",
  "metadataHash": "0x10757ec36011c95de6117d6ffa1b0113801c5574baa2503bd81f6e44e4e815f4",
  "totalAllocationPool": "50000", "availableBalance": "50000",
  "flowVelocityPerSecond": "10", "lifespanSeconds": 3600,
  "residualDeltaRecipient": "0x1A76BFE6bF7A4BfD854b16C19Dd870e0DE56473C",
  "operationalStatus": "Active" }
```

**Binding metadata** (hashes to the on-chain `metadataHash`):
```json
{ "version": "openrails-metadata-v1", "mode": "railsflow",
  "originator": "0x1A76…473c", "recipient": "0x933a…9682",
  "token": "0x3600000000000000000000000000000000000000",
  "amount": "50000", "flowVelocityPerSecond": "10", "lifespanSeconds": 3600,
  "metadataRef": "circle-x402:2f03bb36-e873-4913-81d4-aff303771518" }
```

## Full lifecycle: PROVEN end to end (2026-06-29)

The bridged stream was driven through its **entire** lifecycle on Arc testnet, not just opened:

1. **Drip settlement**: `processDripSettle` (permissionless), tx
   `0x96e1b1ab6459325ad130e69105cd7e8162efc0b3ec00c8feb9ebdf52926f42ad` (block 49254633).
   Past lifespan, so earned capped at `velocity×lifespan = 10×3600 = 36000` (0.036 USDC):
   Vault `availableBalance` 50000 → **14000**; the 0.036 USDC streamed to recipient `0x933a…`.
2. **Residual recovery**: `flushResidualDelta` (payer/recipient only; called by the payer/buyer),
   tx `0x4bc3bdeca43c7b9d165b7c31951ce380092b4c50a653e11135f5c1d45b9633b8` (block 49254695).
   `availableBalance` 14000 → **0**; residual 0.014 USDC returned to `residualDeltaRecipient`
   (the buyer `0x1A76…`); stream **Terminated**.

So of the 0.05 USDC the buyer escrowed: **0.036 streamed to the provider, 0.014 recovered by
the buyer**: a complete bounded, streaming, recoverable payment opened by an x402 request.

**Indexed event timeline** (`GET /api/streams/:paycardId/history`, `authoritative: false`,
status `Terminated`):

| # | event | block | tx |
| :- | :--- | :--- | :--- |
| 1 | `PaycardProvisioned` | 49187374 | `0x3693d7a9…` |
| 2 | `SettlementFlushed` | 49254633 | `0x96e1b1ab…` |
| 3 | `ResidualDeltaReclaimed` | 49254695 | `0x4bc3bdec…` |

`GET /api/transactions/0x4bc3bdec…` → `ResidualDeltaReclaimed` + the resolved stream. The
gateway backfilled the settle/close events from a recent start block (the public Arc RPC caps
`eth_getLogs` at 10,000 blocks, so backfill windows must stay under that).

_Note: recipient/buyer wallet-level deltas are approximate (both addresses have other activity -
the recipient is also the x402 demo seller); the Vault `availableBalance` accounting above is
the authoritative measure._

## Reproduce

```bash
# server (arc-testnet): Terminal A, as in x402-smoke-results.md
# then:
X402_BUYER_PRIVATE_KEY=0x<funded buyer> \
X402_SMOKE_URL=http://localhost:3001/api/x402/openrails-artifact \
ARC_RPC_URL=https://rpc.testnet.arc.io \
npm run smoke:x402:stream
```
Optional tuning: `X402_STREAM_ALLOCATION` (base units, default 50000), `X402_STREAM_VELOCITY`,
`X402_STREAM_LIFESPAN`, `X402_STREAM_RECIPIENT`, `X402_STREAM_NONCE_CHANNEL`.
