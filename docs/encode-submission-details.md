# Encode Submission Details

**Track: Agentic Economy**

OpenRails is programmable clearing and settlement infrastructure for work and commerce on Arc.

We built an Arc-led MVP that connects the full economic lifecycle around a payment: operating context, bounded authority, accepted commercial terms, proof of work or usage, one-time or streamed USDC settlement, and an exact receipt.

The central product flow is:

```text
Workspace -> Path -> Intent -> Proposal -> Pact -> Proof -> Payment -> Receipt
```

A Workspace gives a person or organisation durable operating context. Participants can be people, businesses, applications, services, or agents. A Path defines what a participant may do, for how long, and within which spending and action limits. An Intent expresses the desired action. The Runtime evaluates the Proposal against the active Path. An allowed Proposal can form a Pact containing accepted commercial terms. Proof records the evidence required by that Pact. The owner wallet then authorizes a direct or Workspace-scoped payment, and Arc provides the canonical settlement receipt.

The first vertical is delegated procurement and service delivery. A business can authorize a provider or agent to perform a bounded task without handing over the owner's wallet. A proposal that exceeds its Path ceiling is blocked before a Pact forms and before value moves. The same model extends to agent services, creator work, merchant operations, asynchronous invoicing, recurring services, and usage-based settlement.

The implementation includes:

- Arc Testnet contracts for direct, one-time, and streamed USDC settlement.
- A versioned Shared Interface 1.2 REST boundary.
- A Neon-backed Runtime for signed Workspace, Actor, Path, Proposal, Pact, and Proof transitions.
- A unified Cockpit for Workspace operations, direct payment, Workspace-scoped payment, and settlement inspection.
- An SDK and CLI for typed integrations, wallet adapters, Arc settlement helpers, and receipts.
- An MCP server for safe agent-facing reads, preparation, validation, verification, and explicit execution handoff.
- Circle integration surfaces for Console configuration, Modular Wallets, passkeys, smart accounts, sponsorship, and liquidity movement. These are integration boundaries in the Cockpit and SDK; the submission does not present an unrecorded Circle transaction as public proof.

Arc is the canonical settlement environment for this submission. USDC is the settlement and native gas asset. Circle provides wallet, sponsorship, and liquidity infrastructure at the boundary, while OpenRails owns the economic lifecycle, authority model, agreement semantics, proof gates, clearing decisions, and receipt interpretation.

The demonstrated core products are Arc and USDC. The OpenRails SDK, REST Runtime, and MCP server are the integration surfaces used to coordinate the lifecycle. MCP is the agent-facing boundary: an agent can read state, prepare a bounded action, and invoke the same interface while an external wallet or smart account retains signing and broadcast authority. App Kits and Agent Stack are not claimed as a live transaction path unless the recorded demo explicitly shows that path.

The process was deliberately split into two boundaries. The Runtime handles signed, persistent control-plane transitions without holding keys, signing for users, broadcasting transactions, or moving value. The external wallet or smart account authorizes the financial action. Arc then provides the final financial evidence through the Vault state and transaction receipt.

The submission demonstrates the product direction through the Cockpit, the public REST boundary, the SDK, the MCP surface, and the Arc settlement proof. The immediate post-submission integration step is MCP execution, where an agent invokes the same bounded lifecycle while an external wallet or smart account retains signing and broadcast authority.

The final browser validation gate is to show a newly initialized Workspace, a bounded Path, an accepted Pact, verified Proof, and the resulting one-time or streamed settlement in the public Cockpit. The presentation should be submitted as a Google Slides or Google Docs link with viewer access. The PDF and PPTX exports are working copies for upload or conversion, not the required hosted presentation link.
