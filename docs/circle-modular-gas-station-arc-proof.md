# Circle Modular Gas Station Arc Proof

This is the one approved Circle extension. It is an optional browser path in the Cockpit and does
not replace the existing Privy or wagmi wallet flow.

## Circle Console setup

Create a Circle Modular Wallet client for Arc Testnet. Configure the exact Cockpit origin as an
allowed domain for the client key. Circle's Console setup requires the client key domain to match
the passkey relying-party domain. For local development, use the Console's localhost rule and do
not add a port to the allowed domain.

The browser receives only these public Circle configuration values:

```text
VITE_CIRCLE_CLIENT_KEY=<public Circle browser client key>
VITE_CIRCLE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
```

Do not place an API key, entity secret, private key, mnemonic, or signing credential in Cockpit
source, browser variables, logs, tests, or documentation.

## Behavior

The user creates or logs in to a passkey through Circle's passkey transport. The official Circle
Modular Wallet SDK derives the Circle smart-account address on Arc Testnet. The existing Privy
wallet remains independent.

The Circle settlement control supports one RailsFlow request. It reads the smart-account nonce and
USDC balance, prepares the OpenRails `SettlementIntent`, and signs it with the Circle smart
account. The sponsored UserOperation contains exactly two calls:

1. `USDC.approve(openRailsHub, exactAmount)`
2. `openPaycardChannel(..., envelopeSignature, ..., payer)`

The call is sent with `sendUserOperation({ paymaster: true })`. The UI stays pending through
`waitForUserOperationReceipt`, the exact transaction receipt, the expected `PaycardProvisioned`
event, and a live Hub registry read. Confirmation requires the final payer, recipient, metadata
hash, amount, velocity, lifespan, and residual recipient to match the prepared intent. A receipt
or Vault mismatch is a verification failure, not a success.

The existing SDK wallet-handoff boundary remains the single-transaction handoff model. A bundled
Circle UserOperation is not represented as that model because doing so would lose the exact
approval-plus-settlement authorization boundary. The existing `circleToAccount` adapter remains
the generic SDK typed-data boundary; this browser path uses the same smart-account signing shape
directly at the official SDK boundary.

## Local validation

Run the focused local checks from the repository:

```bash
cd cockpit
npm run typecheck
node --experimental-strip-types --test test/circleModular.test.ts
npm run build
```

## Live proof gate

The proof runner requires a running Cockpit, Circle Console browser configuration, a recipient, and
a real user passkey ceremony. It never accepts server credentials or a private key.

The repository does not claim a live proof when the optional Playwright runner is unavailable. In a
separate proof environment with Playwright installed, start the Cockpit with the public Circle
variables and run:

```bash
CIRCLE_MODULAR_LIVE_PROOF=1 \
VITE_CIRCLE_CLIENT_KEY="$VITE_CIRCLE_CLIENT_KEY" \
VITE_CIRCLE_CLIENT_URL="https://modular-sdk.circle.com/v1/rpc/w3s/buidl" \
CIRCLE_PROOF_URL="http://localhost:5173" \
CIRCLE_PROOF_USERNAME="openrails-proof" \
CIRCLE_PROOF_RECIPIENT="0xYourRecipient" \
CIRCLE_PROOF_AMOUNT_USDC="0.000001" \
node experiments/circle-modular-gas-station-arc-proof/prove.mjs
```

The runner opens a visible browser, waits for the user-controlled passkey ceremony, fills one
RailsFlow settlement, and prints PASS only after the Cockpit reports the exact transaction hash and
Circle smart-account payer following receipt and live Vault verification. A missing client key,
wrong Console domain, missing Playwright, rejected passkey, denied sponsorship, RPC failure,
reverted transaction, or verification mismatch is a blocker. Existing generic EIP-1271 and
low-level Gateway evidence do not count as this Circle proof.

References:

- [Circle create a Modular Wallet](https://developers.circle.com/wallets/modular/create-a-modular-wallet)
- [Circle transfer tokens and sponsor a UserOperation](https://developers.circle.com/wallets/modular/transfer-tokens)
- [Circle Console setup](https://developers.circle.com/wallets/modular/console-setup)
- [Circle supported blockchains](https://developers.circle.com/wallets/supported-blockchains)
