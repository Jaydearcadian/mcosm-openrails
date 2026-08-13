# openrails-mcp 0.3.1

Safe-only MCP server for the OpenRails Shared Interface 1.2 surface over stdio. The server can
read the bundled Arc Testnet manifest, prepare operation envelopes, validate envelopes, and verify
Pact-declared Canonical Record bindings. It supports the complete signed Runtime transition set:
`workspace.register`, `actor.register`, `path.activate`, `path.revoke`, `intent.prepare`,
`proposal.evaluate`, `proposal.submit`, `pact.sign`, `proof.submit`, and `proof.verify`.

The MCP process does not create signers, accept keys, custody assets, sign wallet requests, submit
transactions, relay requests, or autonomously execute financial actions. Runtime operation
preparation accepts caller-supplied external signature evidence and derives only the required
1.2 references. The external wallet or application remains responsible for authorization and
submission.

The agent-facing tools add discovery and planning on top of the same boundary. They validate a
payable surface manifest, choose a compatible OpenRails primitive, and produce an inspect, quote,
negotiate, ignore, or mute task. Negotiation and muting are approval-bound. None of these tools
creates a signer, authorizes payment, or claims financial success. After explicit approval, an
external wallet can use `openrails_prepare`, `openrails_validate`, and `openrails_verify` for the
bounded Workspace, Path, Pact, Proof, and Receipt lifecycle.

## Agent lifecycle

The agent surface is a decision and handoff layer. A provider publishes a validated surface
manifest. An agent can discover it, inspect or quote it, and produce a negotiation or mute task
that requires approval. After approval, an external wallet or application supplies the signed
Workspace, Path, Intent, Proposal, Pact, or Proof payload to `openrails_prepare`. MCP then validates
and verifies the envelope, while the public Runtime persists the offchain lifecycle and Arc verifies
the eventual financial receipt.

The MCP does not turn an agent into a custodian. It cannot create a wallet, select a private key,
sign a Runtime transition, call CCTP, open a Vault row, stream funds, or claim a payment. The
external authorization boundary and the resulting receipt are both required.

## Tools

| Tool | Purpose |
|---|---|
| `openrails_capabilities` | Report Shared Interface capabilities and safe-only execution limits. |
| `openrails_agent_discover` | Validate a payable surface manifest and return a marketplace/discovery event. |
| `openrails_agent_plan` | Turn a discovery event into an approval-aware agent task. |
| `openrails_prepare` | Prepare a request envelope for an external wallet or runtime. |
| `openrails_validate` | Validate a request or response envelope against the registry. |
| `openrails_verify` | Verify an envelope and optional Canonical Record binding without claiming financial success. |
| `openrails_read` | Read the bundled network manifest or capability declarations. Other objects need an indexer adapter. |

`openrails_prepare` can prepare a signed runtime operation shape when the payload already contains
an externally produced `signatureBinding`. It never creates or invokes a signer. The prepared
request uses `delegated-runtime` and preserves `workspaceRef`, `pathRef`, `intentRef`,
`proposalRef`, `decisionRef`, and `pactRef` bindings from the payload.

For signed runtime operations, the SDK derives and enforces the subject, execution profile, Arc
network, bound references, configuration-only unverified provenance, and timestamp. MCP does not
duplicate that authority logic. Caller context cannot replace any wrapper truth, including
`provenance` or `createdAt`. Exact duplicate context remains accepted for compatibility.

Canonical Records are optional. A Pact may omit them, allow them, or require them. When present,
the SDK validates the bilateral typed actor signature commitment, Pact party and encrypted key
coverage, exposure policy, and settlement references. Cryptographic actor verification requires an
application verifier. Vault state remains the canonical financial state.

## Configuration

| Var | Default | Notes |
|---|---|---|
| `OPENRAILS_NETWORK_MODE` | `arc-testnet` | Network manifest selected by the safe context. |
| `OPENRAILS_RPC_URL` | `https://rpc.testnet.arc.io` | Displayed configuration only. The MCP does not create an RPC signer or broadcast. |
| `OPENRAILS_CHAIN_ID` | `5042002` | Arc Testnet chain id. |
| `OPENRAILS_HUB_ADDRESS` | `0x941C...6D0b` | Canonical OpenRails Hub configuration. |
| `OPENRAILS_USDC_ADDRESS` | `0x3600...0000` | Arc USDC configuration. |
| `OPENRAILS_APP_BASE_URL` | `https://openrails.pages.dev` | Application reference. |
| `OPENRAILS_EXPLORER_BASE_URL` | `https://testnet.arcscan.app` | Explorer reference. |

No signer, key, relay, or transaction-submission environment variable is accepted by this package.

## Run

```bash
npm install
npm run build
node dist/index.js
```

The MCP server communicates over stdio. A wallet or application integration must authorize and
submit any prepared wallet transaction through its own custody boundary.

## Smoke test

```bash
npm run build && node smoke.mjs
```
