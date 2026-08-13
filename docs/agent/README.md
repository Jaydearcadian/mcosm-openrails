# OpenRails Agent SDK

`openrails-sdk/agent` is the application layer for agent-facing payment surfaces. It is separate
from the root `openrails-sdk` export so the core package stays focused on payment primitives:
signed intents, links, metadata, receipts, nonce lanes, relays, and wallet adapters.

The agent layer is for discovery, compatibility checks, and provider policy around those
primitives. It does not introduce a second settlement model and it does not custody funds.

The stdio MCP surface builds on this package. It exposes discovery and approval-aware planning,
then prepares and verifies the signed Runtime lifecycle: Workspace, Actor, Path, Intent, Proposal,
Pact, Proof, and Receipt references. It never signs or broadcasts. A provider can use the SDK
middleware to fail closed when a payable session is absent or unverified.

## What It Contains

- `chains`: the OpenRails chain allowlist and supported deployment metadata.
- `manifest`: validation for provider surface manifests.
- `discovery`: marketplace index, discovery event, and notification payload helpers.
- `provider`: middleware for checking a provider manifest before exposing an agent surface.
- `conformance`: deterministic fixtures for manifests, signed intents, RailsCards, receipts, nonce
  lanes, and marketplace tool payloads.

## Boundary

Use `openrails-sdk/arc` for the legacy Arc payment actions:

- build and sign EIP-712 permission envelopes
- create RailsFlow and RailsCard links
- submit or relay opens and claims
- read paycards, nonces, balances, receipts, and proofs

Use `openrails-sdk/agent` when an agent or marketplace needs to decide whether a provider surface
is compatible with OpenRails before it attempts a payment.

## Rules

- The Vault remains the source of truth.
- A manifest is discovery metadata, not payment authority.
- A provider policy can constrain what an agent is allowed to do, but the signed intent still
  defines what the Hub can execute.
- Conformance fixtures should be deterministic so agents, providers, and marketplaces can compare
  behavior across implementations.

## Import

```ts
import {
  assertOpenRailsSurfaceManifest,
  buildOpenRailsMarketplaceIndex,
  buildOpenRailsConformanceFixture,
} from "openrails-sdk/agent";
```
