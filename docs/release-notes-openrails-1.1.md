# OpenRails 1.1 Review Notes

- Reconciled Shared Interface 1.1 and SDK release-candidate artifacts while retaining the legacy
  Arc API under an explicit compatibility surface.
- Added optional Pact-declared Canonical Record policy, encrypted or public envelope commitments,
  bilateral signature commitment and Pact-party checks, and receipt settlement references.
- Added safe-only MCP and REST prepare, validate, verify, read, and capability surfaces.
- Added a Circle Wallets Gas Station SCA handoff boundary for Arc Testnet. No live Circle execution
  is claimed without Console credentials, an injected runtime, transaction evidence, and Vault
  reconciliation.
- Preserved the existing recipient-bound RailsCard, permit expiry, nonce lane, RPC fallback, keeper
  relay, and self-funded paths and re-ran their targeted tests.

Known limits: Arc Testnet live proof requires network access, funded test assets, deployed contract
addresses, and real Circle Console credentials. The safe MCP cannot autonomously sign or broadcast.
