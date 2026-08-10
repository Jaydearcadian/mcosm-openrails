# Encode Product Demo Script

## Format

- Length: 3:00 maximum.
- Track: Agentic Economy.
- Format: screen recording with voiceover. Camera is optional.
- Show one clean end-to-end flow. Do not spend time on every page or integration.
- Use an Arc Testnet wallet or passkey funded with test USDC. Never show a private key, recovery phrase, client secret, or admin token.

## Recording Gate

Record only after these checks pass:

1. The latest Cockpit build is deployed at the public URL.
2. A new Workspace initializes without HTTP 500.
3. The owner wallet can register an Actor and add a participant or agent.
4. A bounded Path can be activated and an over-limit action can be blocked.
5. A Pact, Proof, and one-time or streamed USDC settlement can be shown with a receipt.
6. The browser has no stale local Workspace selected at the beginning.

## Timeline And Voiceover

### 0:00-0:20: The problem

> OpenRails is programmable clearing and settlement infrastructure for work and commerce on Arc. Payment systems can move money, but they do not by themselves explain who was allowed to act, which terms applied, what work occurred, or why the final amount settled.

### 0:20-0:45: The model

Show the Cockpit overview and the lifecycle.

> OpenRails connects those facts into one lifecycle: Workspace, Path, Intent, Proposal, Pact, Proof, Payment, and Receipt. A Workspace holds the operating context. A Path bounds what a person, service, application, or agent may do. A Pact records accepted terms. Proof records the required work or usage. The final payment is one-time or streamed USDC settlement, and the receipt records what actually cleared.

### 0:45-1:20: Initialize and delegate

Connect the wallet, initialize a new Workspace, and show the owner Actor. Add a provider, application, or agent with a wallet address.

> I am initializing a Workspace with the connected owner wallet. Initialization creates signed Runtime records and does not move funds. I am now adding the participant who may act, without giving that participant control of the owner's wallet.

### 1:20-1:50: Bound the action

Create and activate a Path with a visible capability, ceiling, and expiry. If the flow supports it, briefly show an over-limit proposal being blocked.

> The owner activates a Path for a specific action with an amount ceiling and an expiry. The Runtime evaluates the requested action against that Path before any settlement is authorized. An action outside the limit is blocked with no financial effect.

### 1:50-2:15: Agree and prove

Create the Intent and Proposal, show the Pact acceptance, then submit and verify Proof.

> The requested work becomes an Intent and Proposal. Once the terms are accepted, the Pact freezes the commercial agreement. Proof then records that the required stage of work or usage occurred. These records explain why the payment is allowed.

### 2:15-2:40: Settle on Arc

Authorize a one-time payment or a small streamed payment. Show the pending, confirmed, or settled state and the Arc transaction receipt.

> The owner wallet authorizes the payment. Arc is the canonical settlement environment for this release, and USDC is both the settlement asset and native gas asset. OpenRails does not hold the signing key or move value on behalf of the user. It coordinates the commercial and authorization state around the wallet action.

### 2:40-3:00: Agentic Economy and product surfaces

Show the SDK, MCP, or REST documentation briefly, then return to the receipt.

> The same lifecycle is exposed through the Cockpit, the typed SDK and CLI, the versioned REST Runtime, and MCP for agent-facing reads and bounded action preparation. An agent can invoke OpenRails, while an external wallet or smart account retains signing and broadcast authority. This is the Agentic Economy track: autonomous work can be proposed and settled without turning the agent into an unrestricted custodian.

## What To Show About Circle

Only show a Circle surface if it is configured and working in the recorded build. The safe wording is:

> Circle provides the wallet, passkey, smart-account, sponsorship, and liquidity infrastructure at the boundary. OpenRails provides the authority, agreement, proof, clearing, and settlement lifecycle.

Do not claim a live App Kit or Agent Stack transaction unless the video visibly demonstrates it.

## Capture Notes

- Use a clean browser profile or clear only the OpenRails Workspace storage before recording.
- Keep the browser at a readable zoom and avoid showing terminal windows containing credentials.
- Pause briefly after each state transition so the labels and receipt remain visible.
- Record a short practice take first. The final cut should contain one successful flow, not repeated retries.
