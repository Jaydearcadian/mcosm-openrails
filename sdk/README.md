# openrails-sdk

SDK + `openrails` CLI for **OpenRails**: intent-driven clearing & settlement for streamed USDC
work on **Arc**. Sign an intent → clear it into a bounded onchain Vault → settle value as work
is performed → recover residual. Usable by humans or agents.

> Arc testnet: chain `5042002`, Hub `0x941C8029F0f912df3fAb7423890ab2359b996D0b`,
> USDC `0x3600000000000000000000000000000000000000`.

## Install
```bash
npm i openrails-sdk        # library + the `openrails` CLI
```

## 1.1 release candidate

`1.1.0-rc.2` makes the package root the Shared Interface 1.2 safe surface. It exports canonical
types, the Arc capability manifest, operation envelopes, receipts, errors, and external-wallet
`WalletHandoff` helpers. It also supports the four signed runtime operation shapes: workspace
registration, actor registration, proposal submission, and Pact signing. The root prepares,
reads, records, validates, and verifies. It does not accept private keys, create signers, or
broadcast transactions.

```ts
import { prepareWalletHandoff, verifyWalletHandoff } from "openrails-sdk";
```

Canonical Records are optional per Pact policy. The SDK can create and structurally verify
encrypted or public record envelopes, bind them to Pact parties and settlement references, and
leave cryptographic actor verification to an application-provided verifier. The canonical
schemas and operation registry are generated from the repository `interface/` contract.

Runtime signatures use the canonical `OpenRailsRuntimeTransition` EIP-712 primary type, RFC 8785
payload hashing, the 1.2 domain, and explicit `decisionRef` binding where required. The SDK can
prepare and validate these shapes and recover an external signature. An external wallet remains
responsible for signing.

For signed runtime operations, `createOperationRequest` derives the signer subject, Arc network,
signed references, fixed configuration-only provenance, and wrapper timestamp. The wrapper states
that the external signature is present but unverified. Caller context cannot replace these fields;
exact duplicates are accepted only for compatibility.

The Circle Gas Station subpath prepares a credential-gated Arc Testnet SCA handoff without
custody of keys or direct transaction broadcast. It reports configuration or runtime evidence
without claiming live sponsorship until a real Circle transaction is independently reconciled.

```ts
import { CircleGasStationAdapter } from "openrails-sdk/circle-gas-station";
import { createCanonicalRecord, verifyCanonicalRecord } from "openrails-sdk/canonical-record";
```

Existing 0.1.3 Arc APIs remain available from `openrails-sdk/arc`. The Arc examples below use that
compatibility subpath. See [`MIGRATION.md`](MIGRATION.md) for the migration boundary and RC status.

## Library
```ts
import {
  LeptonOpenRailsClient,
  hashOpenRailsMetadata,
  buildMetadataBoundPaycardId,
  submitOpenPaycardWithSigner,
  submitSettleWithSigner,
  submitFlushWithSigner,
  approveOpenRailsSpend,
  readNonce,
} from "openrails-sdk/arc";

// 1) sign an EIP-712 permission envelope for a Paycard Stream
const client = new LeptonOpenRailsClient(privateKey, hubAddress, chainId);
const envelopeToken = await client.signPermissionEnvelope(intent, { mode: "railsflow", metadata });

// 2) open it (the signer self-submits; escrow is pulled from the signer's USDC: non-custodial)
await submitOpenPaycardWithSigner(signer, hubAddress, envelopeToken, "railsflow");

// 3) settle (drip) and 4) recover residual
await submitSettleWithSigner(signer, hubAddress, paycardId);   // processDripSettle
await submitFlushWithSigner(signer, hubAddress, paycardId);    // flushResidualDelta
```

These Arc transaction modules are exported from `openrails-sdk/arc`, not from the safe package
root. The compatibility surface includes `client`, `wallet`, `metadata`, `links`, `receipts`,
`nonce`, `proof`, `policy`, and `access`.

## Signer abstraction & gasless

OpenRails authenticates the **signature, not the transaction sender**. The V2 Hub supports EOA and
EIP-1271 signatures, so submission can be sponsored when the account can sign the intent.

```ts
import { LeptonOpenRailsClient, payGasless, claimGasless, RelayClient, signUsdcPermit } from "openrails-sdk/arc";
import { ethersToSubmitter } from "openrails-sdk/adapters/ethers";

// Any OpenRailsAccount works: no raw private key required.
const account = ethersToSubmitter(anyEthersSigner);              // or privyToAccount / turnkeyToAccount
const client  = await LeptonOpenRailsClient.fromAccount(account, hubAddress, chainId);

// Gasless: the payer signs an intent (+ an EIP-2612 permit) and a relayer submits it.
const relay  = new RelayClient({ baseUrl: RELAY_URL });
const permit = await signUsdcPermit(account, { token: usdc, spender: hubAddress, value, chainId, provider });
await payGasless({ client, relay, intent, options: { mode: "railsflow", metadata }, permit });

// Claim a RailsCard gaslessly (the payer already signed; the claimer needs no gas).
await claimGasless({ relay, envelopeToken, claimRecipient });
```

- **Accounts:** `OpenRailsAccount` (sign-only) / `OpenRailsSubmitter` (also self-submits). An
  `ethers.Signer` satisfies the latter. The `privateKey` constructor still works unchanged.
- **Adapters (subpath exports):** `openrails-sdk/adapters/ethers` · `.../adapters/privy` (humans) ·
  `.../adapters/turnkey` (agents / server wallets). `@privy-io/react-auth` and `@turnkey/ethers` are
  **optional peers**: the core imports neither, so a plain `import` pulls nothing extra.
- **Permit:** `signUsdcPermit` is for an immediate RailsFlow open. The relay submits it before its
  deadline, so the payer does not send an approval transaction.
- **Deferred RailsCards:** call `reserveRailsCardAllowance` when issuing the card. Do not embed a
  permit for later use. Permits expire and share one token nonce, which makes deferred execution
  unreliable.

## RailsCard issuance

Each deferred RailsCard should use an independent nonce lane and reserve cumulative Hub allowance
before the link is shared:

```ts
import {
  randomRailsCardNonceChannel,
  reserveRailsCardAllowance,
  readNonce,
} from "openrails-sdk/arc";

const nonceChannel = randomRailsCardNonceChannel();
const nonceValue = await readNonce(provider, hubAddress, payer, nonceChannel);
const reservation = await reserveRailsCardAllowance(
  submitter,
  provider,
  usdc,
  hubAddress,
  allocation,
);
// Build and sign the RailsCard intent with nonceChannel and nonceValue after authorization.
```

The approval is made at issuance. Claiming can still be sponsored, and the relay checks the card's
nonce, payer balance, and Hub allowance before spending keeper gas. Existing legacy cards remain
claimable when their current allowance covers the allocation or their embedded permit is still
valid. An expired legacy permit with insufficient allowance must be reissued by the sender.

### Privy embedded wallets (humans)

A Privy embedded wallet exposes a standard EIP-1193 provider: bridge it into an
`OpenRailsAccount` with `privyToAccount`, then drive the same gasless flow above:

```tsx
import { useWallets } from "@privy-io/react-auth";
import { privyToAccount } from "openrails-sdk/adapters/privy";
import { LeptonOpenRailsClient, payGasless, RelayClient } from "openrails-sdk/arc";

const { wallets } = useWallets();
const embedded = wallets.find(
  (w) => w.walletClientType === "privy" || w.walletClientType === "privy-v2",
);

const provider = await embedded.getEthereumProvider();
const account  = privyToAccount({ address: embedded.address, provider });
const client   = await LeptonOpenRailsClient.fromAccount(account, hubAddress, chainId);

const relay = new RelayClient({ baseUrl: RELAY_URL });
await payGasless({ client, relay, intent, options: { mode: "railsflow", metadata } });
```

For immediate RailsFlow payments and RailsCard claims, the embedded wallet only signs because
`payGasless` and `claimGasless` route through the relay. Issuing a deferred RailsCard requires the
allowance reservation transaction described above. `walletClientType` is Privy's own field for
distinguishing its embedded wallet (`"privy"` or the newer `"privy-v2"`) from an injected/external
one. This snippet is checked against the installed `@privy-io/react-auth` types but isn't
execution-tested here (that needs a real browser + Privy session): `test/PrivyAdapter.test.ts`
in this repo proves the signing math end to end with a mock EIP-1193 provider instead.

For an agent-facing surface over these, see the companion **`openrails-mcp`** MCP server.

## CLI
```bash
npx openrails --help
npx openrails request-stream …     # build an unsigned RailsFlow request link
npx openrails pay-stream --execute --approve …   # sign + open a Paycard Stream
npx openrails settle  --execute …  # processDripSettle
npx openrails close   --execute --ack-irrevocable-close …   # flushResidualDelta
```

**Safety:** asset-affecting commands are **dry-run by default** (`--execute` to act); `close`
also needs `--ack-irrevocable-close`. **Private keys via env only** (`OPENRAILS_PAYER_PRIVATE_KEY`
or `--signer-env <NAME>`): never on argv.

## Vocabulary
**Paycard Stream** (onchain Vault row) · **RailsFlow** (request link) · **RailsCard** (claimable
value link) · **Nonce Lane** (replay/concurrency) · **Receipts** (proof artifacts).

Peer dep: `ethers` v6. License: MIT.
