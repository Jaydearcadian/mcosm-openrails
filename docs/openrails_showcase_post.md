# OpenRails on Arc: a non-custodial rail for streamed & one-time USDC payments

*Draft for manual posting. On-chain traffic to date is self-run dogfooding/load-testing, not organic users: stated plainly below.*

---

## What it is

**OpenRails V1** is intent-driven clearing & settlement infrastructure for streamed (and one-time) work on **Arc**, settling in native USDC. A payer signs an EIP-712 **SettlementIntent**; funds clear into a bounded per-channel Vault; value settles as work is performed via a reactive drip engine; unspent **residual always returns to the payer**. It is **non-custodial end to end**: wallets self-submit directly to the Hub, and no operator can move funds beyond what a signed intent authorizes.

- **Network:** Arc Testnet: chainId `5042002`, RPC `https://rpc.testnet.arc.io`
- **Hub (`ArcOpenRailsHubV1`):** `0x01EC54846524D043fD808152D41596beF603381d`
- **USDC (streaming escrow):** `0x3600000000000000000000000000000000000000`
- **Explorer:** https://testnet.arcscan.app
- **Hosted app:** https://openrails.pages.dev
- **SDK:** `openrails-sdk` (TypeScript)

## Core primitives

- **Paycard Stream**: one Vault row, two shapes: `lifespanSeconds == 0` = **one-time** (full amount unlocks on the first settle), `> 0` = **linear streaming** drip (`flowVelocityPerSecond`). Same open/settle/flush path for both.
- **RailsFlow**: a *request* link. The recipient shares a link; whoever opens it becomes the payer, funds the escrow, and opens the channel.
- **RailsCard**: a *claimable value* link, **bearer** (claimable by whoever holds it) or **recipient-bound**. The payer pre-signs and pre-authorizes; the holder just claims.
- **Nonce Lanes**: 2D `(channel, value)` nonce space so independent intents from one payer never head-of-line block each other.
- **STN-Delta residual**: precise variance sweep back to the payer on closure.

## What works today

**1. Sign → clear → settle, non-custodially.** The wallet calls `openPaycardChannel` / `processDripSettle` / `flushResidualDelta` directly on the Hub. The Vault is the source of truth; every projection is labeled as such.

**2. Shareable links that actually open a payable page.** A RailsFlow/RailsCard link opens a hosted landing (`/openrails/flow`, `/openrails/card`), shows the terms in plain words, gates on connect-wallet, and pays/claims by self-submit. Deep links resolve on a static host (no backend required: telemetry is read client-side from chain logs + registry).

**3. Gasless RailsCard claims.** A permissionless keeper exposes `POST /relay-claim`: it decodes the signed envelope, `staticCall`-prechecks (so it never spends gas on an already-claimed or expired card), then submits the claim as `msg.sender`. Because the Hub binds the recipient as a **parameter** (not `msg.sender`) and pulls escrow from the **payer** who signed, this is non-custodial and the claimant needs **zero gas**. Verified: a freshly generated address with a 0 balance received a real bearer card, funds pulled from the payer, gas paid by the keeper.

**4. Permissionless settler keeper.** A cron worker enumerates active rails from chain logs and `processDripSettle`s them: streaming rails past a dust threshold, one-time rails once. It **only settles**; opening and closure stay with the payer/recipient. Non-custodial (keeper pays gas only). `processDripSettle` remains gated to payer/recipient, so the keeper can't be griefed into settling arbitrary channels.

**5. SDK for integrators.** Build, sign, and submit intents in a few lines:

```ts
import { LeptonOpenRailsClient, createRailsCardIntent } from "openrails-sdk";

const client = new LeptonOpenRailsClient(PRIVATE_KEY, HUB_ADDRESS, 5042002);

// A bearer RailsCard: pre-signed, pre-authorized, claimable by whoever holds the link.
const intent = createRailsCardIntent({
  paycardId, metadataHash,
  totalAllocationPool: "2000",        // 0.002 USDC (6dp)
  flowVelocityPerSecond: "0",
  genesisTimestamp: Math.floor(Date.now() / 1000),
  lifespanSeconds: 0,                 // one-time
  residualDeltaRecipient: payer,
  nonceChannel: 0, nonceValue,
});
const token = await client.signPermissionEnvelope(intent, { mode: "railscard_bearer", metadata });
// → drop `token` into a share link; the holder claims (gas sponsored) or self-submits.
```

**6. x402 integration.** Smoke paths turn a paid HTTP request (x402) into an OpenRails stream: pay-per-call metering that settles on the same rail.

## Honest status

The on-chain volume so far is **self-run simulation / load-testing / dogfooding** across a small fleet of funded test wallets: used to prove the open → settle → claim loop and the keeper, **not organic users**. Everything above is verifiable on testnet.arcscan.app against the Hub address.

## What's next

- Publish `openrails-sdk` to npm.
- Gateway indexer as a drop-in for unbounded history + richer telemetry (the cockpit already prefers it when configured, else reads chain directly).
- V2: workflow-NFT / factory surfaces for agent & creator verticals (the genuinely future-facing part).
