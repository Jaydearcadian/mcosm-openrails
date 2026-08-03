# Migrating to `openrails-sdk@1.0.0-rc.1`

`1.0.0-rc.1` is a release candidate for the OpenRails Shared Interface 1.1 SDK. It is intended for review and integration testing and is not a final stable release. Existing `openrails-sdk@0.1.3` installations remain valid Arc-line releases until the reviewed migration release is published.

## Safe root surface

The package root now exports canonical Shared Interface schemas and types, the Arc capability manifest, operation request and response helpers, receipts, errors, and the `WalletHandoff` flow.

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

This release candidate must pass package build, tests, packed clean-consumer loading, and dependency audit before publication. It must not be treated as published or stable until that review is complete.
