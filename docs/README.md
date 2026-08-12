# OpenRails Documentation

Start with the root [Getting Started guide](../GETTING_STARTED.md) for the Cockpit, SDK, CLI, and
MCP paths.

## Product and API

- [API Reference](API_REFERENCE.md): HTTP routes, worker boundaries, and response authority.
- [Agent SDK](agent/README.md): discovery and provider compatibility helpers.
- [Stream Indexing](stream_indexing.md): non-authoritative projections and reconciliation semantics.

## Runtime and integrations

- [Harness Setup](harness-setup.md): local configuration and non-destructive preflight.
- [Circle Gas Station Boundary](circle-gas-station-boundary.md): credential and custody limits.
- [Circle Modular Wallet Arc Proof](circle-modular-gas-station-arc-proof.md): the browser integration
  and evidence requirements.
- [Circle integration status](circle-integration-status.md): the current Circle stack, what is wired
  into the App and SDK, and the remaining end-to-end work.
- [Public Workspace Settlement Evidence](public-workspace-runtime-settlement-evidence.md): the
  deployed Runtime-to-Arc verification record.

The on-chain Vault and transaction receipts remain authoritative for financial state. Planning
notes and historical release material are kept out of this public documentation surface.
