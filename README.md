# OpenRails

**Pay for exactly what you use.**

**OpenRails is intent-driven clearing and settlement infrastructure for streamed work on Arc.**

In plain terms it's a payment rail: a payer signs a **bounded intent**, it **clears** into a
non-custodial on-chain Vault, value **settles** to the recipient as work is performed, and unused
residual **returns** to the payer when the stream ends: usable by **humans or AI agents**. Arc
provides fast, low-cost, USDC-native settlement; OpenRails provides the intent, escrow, streaming,
receipt, and recovery layer on top.

> Two properties make it work: the Vault authenticates the **signature, not the sender** (so
> payments can be relayed and gas-sponsored), and escrow is **bounded by construction** (a bug, a bad
> actor, or a runaway agent can never move more than was signed for).

**Core primitives** *(vocabulary is fixed: do not rename):*

| Primitive | Meaning |
| :--- | :--- |
| **RailsFlow** | A link to *ask* to be paid: invoice / paywall / usage bill. |
| **RailsCard** | A link to *send* pre-authorized value to claim: gift card / payout / agent budget (bearer or recipient-bound). |
| **Paycard Stream** | The on-chain Vault row that escrows funds and meters settlement. |
| **Nonce Lane** | Replay/concurrency protection for parallel agent payments (`nonceChannel` / `nonceValue`). |
| **Receipts** | Verifiable proof of every open, settlement, and residual return. |

The agent economy and the creator economy are the flagship verticals; the rail itself is
vertical-agnostic.

---

## Status

**Live on Arc testnet (chain `5042002`). Unaudited: test funds only.** V2 is deployed; V1 is frozen
to new opens and left to drain.

| | Address / package |
| :--- | :--- |
| **V2 canonical hub** (default) | `0x941C8029F0f912df3fAb7423890ab2359b996D0b` |
| V2 factory · master logic | see `deployments/openrails-v2-addresses.local.json` after deploy |
| V1 hub (frozen/legacy) | `0x01EC54846524D043fD808152D41596beF603381d` |
| USDC (native gas token) | `0x3600000000000000000000000000000000000000` |
| SDK + CLI | [`openrails-sdk`](https://www.npmjs.com/package/openrails-sdk) (npm) |
| Agent server | [`openrails-mcp`](https://www.npmjs.com/package/openrails-mcp) (npm) |

**What's shipped:** EIP-1271 **smart accounts** *and* EOAs (humans via embedded wallets, agents via
server wallets); **gasless** relaying via the keeper worker; streaming + instant settlement; automatic
residual return; on-chain receipts; published 0.1.x SDK/CLI and MCP packages; and a deployed cockpit at
[openrails.pages.dev](https://openrails.pages.dev). The Shared Interface 1.1 SDK and safe MCP are
release candidates in this branch, pending npm publication. Test baseline: **84 Hardhat + 9 Foundry** passing.

**Not yet:** mainnet, a security audit, session keys, a live Circle Gas Station transaction, Canonical
Record storage and cryptographic actor verification, and Arc Workspace Runtime. The contract accepts
EIP-1271 today; the Circle-specific handoff is an adapter boundary until real Circle evidence exists.
See [`HANDOFF.md`](HANDOFF.md) for the full roadmap.

---

## Quick start

The fastest paths need no repo checkout: the packages default to Arc-testnet-V2. Full walkthrough in
[`GETTING_STARTED.md`](GETTING_STARTED.md).

**CLI (one command to a first payment):**
```bash
npm i -g openrails-sdk
export OPENRAILS_PAYER_PRIVATE_KEY=0x<funded-arc-testnet-key>
openrails pay-stream --recipient 0x… --total-allocation-pool 10000 \
  --flow-velocity-per-second 1 --lifespan-seconds 3600 --execute
```
Network config (chain / RPC / hub / USDC) is defaulted; the paycard id, nonce, and metadata hash are
auto-derived. Mutating commands are dry-run until `--execute`; keys come from env, never argv.

**SDK (library):**
```bash
npm install openrails-sdk
```
```ts
import { LeptonOpenRailsClient, payGasless } from "openrails-sdk/arc";
// the safe Shared Interface surface is exported from "openrails-sdk"
// pluggable signers: openrails-sdk/adapters/{ethers,privy,turnkey}
```

**Agent (MCP):** register with an MCP client (e.g. Claude Desktop):
```json
{ "mcpServers": { "openrails": {
  "command": "npx", "args": ["openrails-mcp"] } }
```
The release candidate exposes safe-only `openrails_capabilities`, `openrails_prepare`,
`openrails_validate`, `openrails_verify`, and `openrails_read` tools. It does not accept signer keys,
sign, relay, or broadcast.

**Cockpit (no install):** [openrails.pages.dev](https://openrails.pages.dev): connect a wallet,
create/pay a link, issue/claim a RailsCard.

---

## The suite

```
Surface   RailsFlow & RailsCard : links/QR: ask to be paid, or send value to claim
Accounts  whoever signs         : embedded wallets, EIP-1271 smart accounts, agents
Rail      intent → vault → stream → residual : non-custodial clearing & settlement
Build     SDK · CLI · MCP       : one command / one tool-call to transact
Settle    on Arc                : USDC-native, fast, low-cost finality
```

- **Contracts** (`contracts/`): `ArcOpenRailsHubV1.sol` (V1, frozen); `contracts/v2-factory/`
 : `ArcOpenRailsHubV2Initializable.sol` (master logic), `ArcOpenRailsFactoryV1.sol` (ERC-1167
  clone factory). The **canonical default hub is a governance-owned clone** of the master; enterprise
  tenants can mint their own isolated clones. V2 verifies signatures via OpenZeppelin
  `SignatureChecker` (EOA + EIP-1271) with an explicit `payer` argument; EIP-712 domain version
  `2.0.0`.
- **SDK + CLI** (`sdk/`): a safe Shared Interface root for preparation, validation, receipts,
  Canonical Records, and wallet handoffs; the legacy Arc transaction surface under `openrails-sdk/arc`;
  pluggable-signer `adapters/*`; and the `openrails` CLI.
- **Keeper** (`workers/reconciliation-worker/`): a Cloudflare Worker that cron-settles active streams
  and sponsors gas for opens/claims (`/relay-open`, `/relay-claim`).
- **Cockpit** (`cockpit/`): the React/Vite product surface.

---

## Core mechanics

**Vault-centered security.** The SDK, cockpit, keeper, and links are convenience layers; the security
boundary is the on-chain Vault. It verifies the EIP-712 signature for the claimed `payer`, enforces
the Nonce Lane, blocks `paycardId` reuse, escrows USDC, and stores the isolated `PaycardRegistry` row.
Non-custodial: nothing but the Vault ever holds the funds.

**Smart accounts (EIP-1271).** The open path takes an explicit `payer` and verifies via
`SignatureChecker.isValidSignatureNow`: transparently accepting both EOAs (ECDSA) and contract
accounts (Circle Smart Accounts, EIP-1271). Domain separation (`verifyingContract` + version `2.0.0`)
makes cross-version replay impossible.

**RailsFlow & RailsCard.** RailsFlow is a merchant-created request the payer reviews and signs.
RailsCard is a payer-signed value link: **bearer** (first valid claimant binds, first-holder-wins) or
**recipient-bound**. Fixed-recipient envelopes cannot be redirected after signing. Both produce
links/QR encoded as URL fragments (`#or=…`) so payloads never hit HTTP servers as query strings.

**Streaming & instant settlement.** `processDripSettle` uses block clock-math so a recipient claims
exactly what's earned to the current block; `lifespanSeconds == 0` is explicit instant mode (full
release on first settle). Off-chain projections are non-authoritative; balances change only on-chain.

**STN-Delta residual recovery.** Payers over-provision (allocation = realized invoice + safety
buffer). On `flushResidualDelta`, the Vault settles accrued value first, then returns the unspent
residual to the payer's recovery address in the same transaction.

**Metadata integrity & receipts.** Every intent commits a `metadataHash` (bound to the invoice/card
terms), signed and emitted so indexers and proofs connect on-chain events to exact off-chain terms.
Receipts distinguish open, settlement, residual return, and workflow timelines.

---

## Develop

```bash
npm install
npm run compile          # Hardhat compile (viaIR)
npm run test             # Hardhat: 74 passing
npm run test:foundry     # Foundry fuzz/invariant: 9 passing
npm run build:sdk        # tsc build of the SDK + CLI
npm --prefix cockpit run build
```

**Deploy V2 to a network** (`scripts/deploy-v2-core.ts`): deploys master → factory → a
governance-owned canonical clone and writes an address registry. Requires `.env` (see `.env.example`)
with `ARC_USDC_ADDRESS` + a funded `DEPLOYER_PRIVATE_KEY`. Note: on Arc the deploy script's
governance signer path assumes `governance == deployer`; a separate governance multisig needs a
key env or a deploy-then-`transferOwnership` handoff (tracked for mainnet).

---

## Limitations & honesty

- **Testnet, unaudited, test funds only.** Not production software; do not handle non-demo funds.
- Non-custodial and bounded by design: but a mainnet **audit** is the gate before real value.
- **Bearer RailsCard** links are first-holder-wins until claimed; treat unclaimed links as sensitive.
- On Arc, USDC is the native gas token: a USDC holder inherently has gas; `transferFrom` cannot move
  a holder's *entire* balance, so over-fund the payer.
- The legacy Express server (`server/index.ts`) and dashboard remain on V1 and are superseded by the
  cockpit + keeper + SDK path.
- Never commit secrets, private keys, private RPC URLs, or local registry files (`.env`,
  `.bot-wallets/`, and `deployments/*.local.json` are gitignored).

---

**OpenRails** // *Intent-driven clearing & settlement infrastructure for streamed work on Arc.*
