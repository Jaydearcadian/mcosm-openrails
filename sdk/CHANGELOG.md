# Changelog

## [1.1.2] - 2026-08-12

- Added the prepare-only `openrails-sdk/cctp` boundary for CCTP V2 source burns, Arc destination
  minting, read-only attestation status, and Workspace funding references for direct or streaming
  settlement.
- Kept CCTP funding separate from OpenRails agreement, Vault, streaming, and receipt authority;
  no signer, broadcast, attestation polling, or live cross-chain proof is claimed.

## [1.1.1] - 2026-08-10

- Published the `openrails-sdk/agent` export for agent discovery and provider policy helpers.
- Added `proofFromReceipt` for converting settlement receipts into verifiable proof objects.
- Added optional Gateway wallet and minter address overrides for local and test deployments; live
  Arc defaults remain unchanged.
- Improved command-specific CLI help for `close` and `pay-stream`.

## [1.1.0] - 2026-08-10

- Promoted the reviewed Shared Interface 1.2 surface from the `1.1.0-rc.2` release candidate to
  the stable SDK release.

## [1.1.0-rc.2] - 2026-08-08

- Centralized signed runtime request derivation and enforcement in `createOperationRequest` so all
  SDK consumers receive the same signer, Arc network, signed references, provenance, and timestamp.
- Fixed runtime wrapper provenance as configuration-only and explicitly unverified, with
  `createdAt` derived from the signed `signatureBinding.issuedAt` value.
- Rejected caller overrides for runtime authority, references, provenance, timestamps, and unsigned
  wrapper fields while accepting exact duplicate context for compatibility.
- Added clean packed-consumer loading for the Canonical Record and Circle Gas Station subpaths.
- Included the complete Apache License, Version 2.0 text and prominent modification attribution
  for the adapted `canonicalize` 3.0.0 implementation.

## [1.1.0-rc.1] - 2026-08-08

- Updated the safe root and generated artifacts to OpenRails Shared Interface 1.2.
- Added generated canonical schemas, types, operation registry, Arc Testnet manifest, runtime
  validator, and runtime signature helpers with no private interface package dependency.
- Added signed runtime operation support for workspace registration, actor registration, proposal
  submission, and Pact signing, including `decisionRef` context binding.
- Preserved the existing `openrails-sdk/arc` signer, relay, CLI, adapter, gateway, and financial
  APIs under their existing compatibility paths.
- Added packed-consumer coverage for the self-contained CommonJS SDK and exact runtime EIP-712
  behavior.
## [1.0.0-rc.1] - 2026-08-03

- Added the OpenRails Shared Interface 1.1 safe root with canonical types, schemas, Arc capability
  manifest, operation envelopes, receipts, errors, and external-wallet `WalletHandoff` helpers.
- Moved every existing 0.1.3 root export to the explicit `openrails-sdk/arc` compatibility
  subpath without renaming those APIs. Existing adapter and gateway subpaths are unchanged.
- Kept signing and transaction submission outside the safe root. External wallets remain
  responsible for authorization and broadcast, while the SDK prepares, records, and verifies.
- Added optional Pact-declared Canonical Record envelopes with commitment, exposure, counterparty,
  settlement-reference, and structural signature checks.
- Added a credential-gated Circle Gas Station SCA handoff boundary for Arc Testnet. This release
  candidate does not claim live Circle sponsorship.
- Made the SDK package self-contained with generated interface artifacts and registry-only
  dependencies. This version remains a release candidate pending publication review.
