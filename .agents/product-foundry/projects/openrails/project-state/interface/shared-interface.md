# OpenRails Shared Interface

**Version:** 1.0.1
**Status:** Canonical specification, not yet live
**Typed implementation package:** `interface/`, private `@openrails/shared-interface@0.1.0`, validated against schema version 1.0.1
**Product Truth:** 2.0.1
**Implementation target:** `Jaydearcadian/mcosm-OpenRails`
**Brand, design, and webapp source:** `cooke-dev/mcosm-OpenRails`
**Default narrative and network:** Arc

## Purpose

Shared Interface 1.0 projects one OpenRails lifecycle across the Arc-led unified webapp, SDK, MCP, REST, MidiumOR, GoalSession, creator sidecars, and Arc, GIWA, and X Layer adapters.

The target repository remains explicit about its foundation:

> Intent-driven clearing and settlement infrastructure for streamed and one-time work.

GIWA's Workspace, Path, Pact, Proof, and Gaia model extends that rail into an operating and accountability environment. Cooke's webapp and design system supply the unified appearance. Jayde's repository owns the implementation and release.

## Layer Model

```text
Product Truth 2.0
-> Canonical objects and lifecycle
-> Capabilities, states, errors, and receipts
-> Arc-led web / SDK / MCP / REST
-> MidiumOR / GoalSession / Sidecars
-> Arc default adapter / GIWA adapter / X Layer adapter
```

Arc is the default product configuration and strongest opening narrative. Arc, GIWA, and X Layer retain peer authority over their own deployments. Arc anchoring is not required for launch.

## Execution Profiles

Shared Interface 1.0 supports two conformant profiles.

The direct wallet-authorized profile preserves two Arc payment branches:

```text
RailsFlow request
-> optional AUTHORIZATION-gated Proof
-> wallet review and SettlementIntent authorization
-> Paycard Stream funding
-> optional CHECKPOINT-gated or FINAL_SETTLEMENT-gated Proof at the selected phase
-> checkpoint or settlement
-> Receipt

RailsCard preparation
-> optional AUTHORIZATION-gated Proof
-> payer wallet signature and RailsCard issuance
-> optional CLAIM-gated Proof
-> recipient claim
-> Paycard Stream funding
-> optional CHECKPOINT-gated or FINAL_SETTLEMENT-gated Proof at the selected phase
-> checkpoint or settlement
-> Receipt
```

The delegated Runtime profile adds `Workspace -> Path -> Proposal -> Baphomet -> Pact` before financial authorization and may add Gaia resolution after settlement. Workspace, Path, and Pact references are required for delegated operations and optional for direct wallet-authorized operations.

A blocked Proposal creates no Pact, requests no financial wallet action, opens no Paycard, and moves no value.

A Paycard may be funded before work begins. Proof is conditional and has no universal fixed position. Signed Pact or SettlementIntent terms must state whether Proof is not required or is inserted immediately before authorization, claim, checkpoint, or final settlement.

## Payment Vocabulary

- RailsFlow is a request-to-pay artifact.
- RailsCard is payer-signed claimable value, bearer or recipient-bound.
- Paycard Stream is the funded Vault state created by payment or claim.
- One-time or streamed is settlement shape and is independent of RailsFlow versus RailsCard.

These semantics must remain identical across UI copy, SDK types, MCP tools, REST, schemas, and receipts.

## Interface Envelope

Every public operation identifies its interface version, execution profile, operation ID, capability, lifecycle state, authorization class, subject, network, object references, transaction state, receipts, errors, provenance, and timestamps.

Transaction submission is not financial success. Success requires confirmation, exact receipt verification, and agreement with live Vault state.

The YAML artifact remains the semantic vocabulary contract. PR1 now provides the versioned JSON Schema 2020-12 package, deterministic TypeScript output, conditional profile requirements, transition rules, operation registry, operation-bound runtime validation, receipt and error schemas, and the Arc capability manifest under `interface/`. SDK, MCP, REST, Runtime, worker, and frontend consumers are not integrated by PR1.

## Network Contract

Every adapter publishes a typed manifest for chain identity, RPC and explorer configuration, assets, contracts, EIP-712 domains, capabilities, finality, receipt mappings, and provenance.

Capabilities are `VERIFIED`, `LIVE`, `RECORDED`, `DEMONSTRATION`, `PLANNED`, or `UNAVAILABLE`. The Arc default must not hide unavailable GIWA or X Layer behavior or claim false parity.

## Vertical Profiles

- **Agent:** GoalSession, provider, tool or service, and usage references.
- **Creator:** creator, work, playback or usage, and distribution references.
- **Institutional:** organisation, department, vendor or merchant, invoice or order, and approval-policy references.

Profiles add fields and starting workflows. They do not replace Workspace, Path, Pact, Proof, rails, wallet authorization, or Vault authority.

## Client Boundaries

- MidiumOR reads, prepares, explains, and hands off to a wallet. It does not hold user keys.
- GoalSession orchestrates goals and providers. It is not Workspace or Path and cannot sign or broadcast as OpenRails Runtime.
- Creator sidecars observe usage, prepare Intents, and submit evidence. They do not make playback logs canonical settlement state.
- MCP remains read, prepare, and verify only. It accepts no private key and performs no autonomous financial broadcast.

## Package Authority

`Jaydearcadian/mcosm-OpenRails` owns the target `openrails-sdk@1.0.0` and `openrails-mcp@1.0.0` release line.

PR1's private shared package is `@openrails/shared-interface@0.1.0` under `interface/`. It is a contract artifact, not a public consumer release.

The package keeps AJV as a declared runtime dependency and verifies that the packed artifact can import the built operation API in a clean consumer prefix. This validates package portability, not Shared Interface go-live.

The existing `openrails-sdk@0.1.3` and `openrails-mcp@0.1.2` remain valid Arc-line releases. Version `1.0.0` is not published until shared schemas, adapter manifests, compatibility fixtures, migration notes, security review, and package tests pass.

## Web Projection

The unified webapp will be implemented and released from Jayde's repository. It will absorb Cooke's brand, design tokens, layout, route patterns, and selected GIWA components while retaining Arc's product foundation and operational capabilities.

```text
/
/system
/workspaces
/rails
/network
/build
/docs
```

The homepage leads with Arc's intent-driven clearing and streamed-work language, then introduces Workspace authority, agreements, proof, verticals, and peer networks. Network is an operating context, not a separate visual product.

## Go-Live Definition

Shared Interface 1.0 is live as an Arc-led interface release only when:

- implementation schemas validate and public capabilities use the same typed objects, states, transitions, errors, and receipts;
- Arc publishes a verified capability manifest and GIWA and X Layer publish honest manifests that may declare capabilities `UNAVAILABLE`;
- one successful and one blocked or failed Arc operation pass through the same contract;
- wallet, signature, nonce, expiry, and replay tests pass;
- SDK, MCP, and REST contract tests pass;
- Cooke's design migration is reviewed inside the Arc-led target app;
- security review has no unresolved critical finding;
- staged deployment and rollback are documented and tested.

Until those gates pass, this is a canonical specification and must not be described as live.

MidiumOR, GoalSession, creator sidecar, GIWA behavior, and X Layer behavior become separately verified integrations when their conformance tests pass. They are not launch dependencies when their manifests honestly declare unavailable capabilities, and the Arc-led release must not imply ecosystem-wide conformance.

## Implementation Order

1. Keep the validated PR1 typed implementation schemas, transition rules, operation contracts, receipt and error payloads, and Arc capability manifest in Jayde's repository.
2. Add GIWA and X Layer adapter manifests plus conformance fixtures.
3. Migrate SDK and MCP to the shared contract.
4. Expose the contract through REST.
5. Bring Cooke's brand, design system, route structure, and selected web components into the Arc-led target app.
6. Integrate MidiumOR and GoalSession.
7. Harden one creator sidecar without user-key custody.
8. Run interface, security, package, web, and rollback gates.
9. Publish `1.0.0` packages and deploy the unified webapp only after approval.
