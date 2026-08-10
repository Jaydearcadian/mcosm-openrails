# Circle/x402 Smoke: Results & Status

Status date: 2026-06-28. This records exactly what was and was not proven, so no claim
outruns the evidence.

> **Going further:** the paid x402 request can now be redeemed into a **real, non-custodial
> OpenRails Vault stream**: see [`x402-stream-bridge-results.md`](./x402-stream-bridge-results.md)
> (`npm run smoke:x402:stream`).

## Summary

| Check | Status | Evidence |
| :--- | :--- | :--- |
| HTTP 402 protocol mechanics (challenge → resolve → 200 + settlement id) | **PASS** | `x402-smoke-harness.ts` run, below |
| Real artifact endpoint field contract + escrow boundary | **VERIFIED (by inspection)** | `server/index.ts` `/api/x402/openrails-artifact` |
| Live **paid** settlement via Circle facilitator on Arc testnet | **PASS** (2026-06-28) | settlement `da31fc33-d57a-4d3c-a5e3-36d966baa867`; see "Paid run" below |

## What is proven

### 1. Protocol mechanics (mock harness)

`npx ts-node experiments/x402-smoke/x402-smoke-harness.ts` passes end to end:

- Attempt 1 (no headers) → `402 Payment Required` with `WWW-Authenticate: OpenRails payment-challenge-v1`
  and `X-OpenRails-Price-Per-Call: 100000`.
- Attempt 2 (with `X-OpenRails-Paycard-Id` + signed `X-OpenRails-Proof`) → `200 OK`, balance
  deducted, `X-OpenRails-Settlement-Id` returned.

This proves the 402 metered-access loop. It is a **mock**: balances are in-memory and no Circle
facilitator or onchain settlement is involved.

### 2. Real artifact endpoint contract (by inspection)

`GET /api/x402/openrails-artifact` (`server/index.ts`) already returns every field required by the
Phase 4 roadmap exit criteria, and keeps x402 payment proof strictly separate from Vault escrow:

- `x402`: `payer`, `amount`, `network`, `settlementId`, `facilitatorUrl`
- `openrails`: `chainId`, `vaultAddress`, `tokenAddress`, `serviceOrigin`, `scope`, `metadata`,
  `metadataHash`, and **`vaultEscrowClaimed: false`** with `openRailsSettlementStage: "metadata_only"`.

The endpoint is gated by `requireArcX402Mode` (Arc testnet mode only) and Circle's
`createGatewayMiddleware(...).require(price)`. In local mode it does not activate, so it cannot
falsely report a paid settlement.

### 3. Live paid settlement (Arc testnet): **PROVEN 2026-06-28**

A real paid x402 settlement was executed against the live Circle facilitator on Arc testnet
via the real buyer `x402-paid-buyer.ts` (`npm run smoke:x402:paid`):

- Server ran in `OPENRAILS_DASHBOARD_MODE=arc-testnet` (chainId 5042002), demo seller
  `0x933a…`, price `$0.01`.
- Buyer = `0x1A76…473C`; the Circle Gateway model debits a **deposited Gateway balance**, so
  0.1 USDC was first deposited (approval `0x83750a8f…`, deposit `0x64a9f6aa…`).
- `pay()` signed a gasless `TransferWithAuthorization`; the facilitator accepted it and the
  endpoint returned **HTTP 200** with the OpenRails artifact and `vaultEscrowClaimed: false`.

**Proofs:**
- Facilitator settlement record (`GET /v1/x402/transfers/da31fc33-d57a-4d3c-a5e3-36d966baa867`):
  `status: received`, `fromAddress 0x1a76…473c`, `toAddress 0x933a…9682`, `amount 10000`
  (0.01 USDC), `sendingNetwork eip155:5042002`.
- Gateway balance debited 0.10 → 0.09 USDC (the $0.01 was spent).
- Artifact kept `vaultEscrowClaimed: false` / `openRailsSettlementStage: "metadata_only"` -
  x402 payment proof is **not** Vault escrow proof.

This satisfies the Phase 4 roadmap exit criterion: *paid x402 smoke passes end to end.* The
captured artifact is recorded under "Paid run: Arc testnet" below.

## Runbook: real paid smoke (Arc testnet)

A real buyer now exists: `experiments/x402-smoke/x402-paid-buyer.ts`
(`npm run smoke:x402:paid`). It pays the live endpoint via Circle's Gateway facilitator with a
gasless `TransferWithAuthorization`, then validates the artifact and prints a capture-ready block.
x402 is **gasless for the buyer**: the funded wallet needs **test USDC only**, no native gas.

**Terminal A: server in Arc testnet mode** (default seller `0x933a…`, default price `$0.01`):
```bash
OPENRAILS_DASHBOARD_MODE=arc-testnet \
ARC_RPC_URL=https://rpc.testnet.arc.io \
OPENRAILS_DEPLOYMENT_REGISTRY_PATH=deployments/openrails-addresses.local.json \
npm run server
```

**Terminal B: buyer** (key via env only, never on argv; here the funded deployer `0x1A76…473C`):
```bash
X402_BUYER_PRIVATE_KEY=0x<deployer key> \
X402_SMOKE_URL=http://localhost:3001/api/x402/openrails-artifact \
npm run smoke:x402:paid
```

On `200`, the buyer prints a `PAID RUN RESULT` JSON block. Paste it into the **Paid run** section
below and flip the status-table row from NOT EXECUTED → PASS. Settlement batches on-chain in
~minutes; decode the batch later with `circle-agent/decode-batch.ts` if desired.

### Required / optional env

```bash
# Server (Terminal A)
OPENRAILS_DASHBOARD_MODE=arc-testnet                 # required: enables the x402 endpoint
ARC_RPC_URL=https://rpc.testnet.arc.io          # required: non-loopback Arc RPC
OPENRAILS_DEPLOYMENT_REGISTRY_PATH=deployments/openrails-addresses.local.json
# Optional overrides (defaults shown):
# OPENRAILS_X402_SELLER_ADDRESS=0x933a2405f84c224be1ef373ba16e992e1f459682
# OPENRAILS_X402_FACILITATOR_URL=https://gateway-api-testnet.circle.com
# OPENRAILS_X402_PRICE=$0.01

# Buyer (Terminal B)
X402_BUYER_PRIVATE_KEY=0x...                          # funded Arc-testnet wallet; env only
X402_SMOKE_URL=http://localhost:3001/api/x402/openrails-artifact
```

## Paid run: Arc testnet

**Executed 2026-06-28. Status: PASS.** Captured `PAID RUN RESULT` from `npm run smoke:x402:paid`:

```json
{
  "httpStatus": 200,
  "paidAmountUsdc": "0.01",
  "x402": {
    "payer": "0x1a76bfe6bf7a4bfd854b16c19dd870e0de56473c",
    "amount": "10000",
    "network": "eip155:5042002",
    "settlementId": "da31fc33-d57a-4d3c-a5e3-36d966baa867",
    "facilitatorUrl": "https://gateway-api-testnet.circle.com"
  },
  "openrails": {
    "chainId": 5042002,
    "vaultAddress": "0x01EC54846524D043fD808152D41596beF603381d",
    "tokenAddress": "0x3600000000000000000000000000000000000000",
    "serviceOrigin": "http://localhost:3001",
    "scope": "GET /api/x402/openrails-artifact",
    "metadataHash": "0x4964bec1d0934b7c1a2353761d4a121bb167e487058598170c87c3048c46af41",
    "vaultEscrowClaimed": false,
    "openRailsSettlementStage": "metadata_only"
  }
}
```

**Facilitator settlement record** (`GET /v1/x402/transfers/da31fc33-d57a-4d3c-a5e3-36d966baa867`):

```json
{
  "id": "da31fc33-d57a-4d3c-a5e3-36d966baa867",
  "status": "received",
  "token": "USDC",
  "sendingNetwork": "eip155:5042002",
  "recipientNetwork": "eip155:5042002",
  "fromAddress": "0x1a76bfe6bf7a4bfd854b16c19dd870e0de56473c",
  "toAddress": "0x933a2405f84c224be1ef373ba16e992e1f459682",
  "amount": "10000",
  "createdAt": "2026-06-28T19:37:10.596Z"
}
```

**Gateway funding/debit proof:**
- Deposit approval tx: `0x83750a8fce8a358b20b6834c7e7ff21c484d65f7a453580113136c4121c3aa65`
- Deposit tx: `0x64a9f6aa23ecb719174664ad054c71a0c8b499a250225c960ab15aa3825fcaa6` (0.1 USDC)
- Gateway available balance: 0.10 → **0.09 USDC** after the $0.01 payment.
- Settlement batches on-chain shortly after `received`; decode the `submitBatch` tx later with
  `circle-agent/decode-batch.ts` once it lands.
