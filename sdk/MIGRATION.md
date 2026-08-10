# Migrating to `openrails-sdk@1.1.0`

`1.1.0` is the reviewed OpenRails Shared Interface 1.2 SDK release. Existing `openrails-sdk@0.1.3` installations remain valid Arc-line releases, while new Shared Interface integrations should use the safe package root.

## Safe root surface

The package root now exports canonical Shared Interface schemas and types, the Arc capability manifest, operation request and response helpers, receipts, errors, and the `WalletHandoff` flow.

The 1.2 surface adds `workspace.register`, `actor.register`, `proposal.submit`, and `pact.sign` as signed runtime operation shapes. The root also exposes canonical payload hashing, EIP-712 domain and message construction, transition hashing, and external signer recovery. Operation contexts now carry `decisionRef` for Pact-bound decisions.

For these four signed runtime operations, `createOperationRequest` derives `delegated-runtime`, the
signer subject, Arc network, signed references, configuration-only unverified provenance, and
`createdAt` from the signed binding. Caller context cannot replace those values. Existing callers
may repeat derived context only when every supplied field matches exactly.

The root does not accept private keys, create signers, sign wallet requests, or broadcast transactions. It prepares transaction context and records or verifies externally observed wallet and network results.

```ts
import {
  prepareWalletHandoff,
  recordWalletAuthorization,
  recordWalletSubmission,
  recordWalletReceiptVerification,
  verifyWalletHandoff,
} from "openrails-sdk";
```

The expected flow is:

1. Prepare a canonical `WalletHandoff` with operation, correlation, network, request, and expiry context.
2. Give `preparedRequest` to the user's external wallet.
3. Record the wallet-provided signature and submitted transaction state.
4. Verify the canonical receipt and Vault reconciliation before claiming financial success.

Signing and submission remain explicit external-wallet responsibilities.

## Arc compatibility

Imports from the pre-1.0 Arc-specific root move to the explicit compatibility subpath:

```ts
import {
  LeptonOpenRailsClient,
  RelayClient,
  signPermissionEnvelopeWithSigner,
} from "openrails-sdk/arc";
```

The compatibility subpath preserves the existing 0.x signer, relay, and transaction helpers. New Shared Interface integrations should use the safe package root. Existing adapter, gateway, CLI, and package subpaths retain their existing names.

## Release status

This release passed package build, tests, packed clean-consumer loading, and dependency review before publication.
