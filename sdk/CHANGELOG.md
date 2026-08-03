# Changelog

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
