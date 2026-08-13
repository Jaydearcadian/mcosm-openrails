# OpenRails

**Programmable clearing and settlement for work, commerce, and agentic services.**

OpenRails turns a commercial request into a bounded, verifiable payment lifecycle. A Workspace
holds the durable context for the relationship. Parties and agents operate through delegated
Paths. A Pact records accepted terms. Proof confirms the work or usage. OpenRails then clears a
direct or streamed USDC payment on Arc and produces a verifiable Receipt.

```text
Workspace -> delegated authority -> agreement -> proof -> settlement -> receipt
```

OpenRails is the coordination, clearing, and settlement layer. It is not itself a wallet, an AI
agent, a bridge, or a generic collaboration product. Wallets, agents, applications, and Circle
infrastructure connect to the same OpenRails lifecycle.

## Product model

| Object | Role |
| :--- | :--- |
| **Workspace** | Persistent context for a commercial relationship or operating environment. |
| **Party or agent** | A participant that can be registered and given bounded responsibility. |
| **Path** | A defined capability and authority limit for a participant. |
| **Intent and proposal** | The requested action and the terms submitted for evaluation. |
| **Pact** | The accepted commercial terms that bind the workflow. |
| **Proof** | Evidence that the agreed work or usage occurred. |
| **Settlement** | A direct payment or a stream that releases value over time or usage. |
| **Receipt** | The verifiable record of what cleared, settled, and returned. |

The result is a shared economic lifecycle for people, businesses, creators, and agents. A payment
can be authorized once, constrained by the agreed terms, released as the underlying work occurs,
and independently checked afterward.

## Current implementation

OpenRails is currently anchored on Arc, using USDC-native settlement and the deployed V2 contract
system on chain `5042002`.

| Surface | Current reference |
| :--- | :--- |
| V2 canonical hub | `0x941C8029F0f912df3fAb7423890ab2359b996D0b` |
| Arc USDC | `0x3600000000000000000000000000000000000000` |
| Versioned Runtime | `https://openrails-interface-worker.microcosm.workers.dev` |
| Web application | [openrails.pages.dev](https://openrails.pages.dev) |
| SDK and CLI | [`openrails-sdk`](https://www.npmjs.com/package/openrails-sdk) |
| Agent surface | [`openrails-mcp`](https://www.npmjs.com/package/openrails-mcp) |

The current implementation includes:

- Persistent, wallet-signed Workspace coordination through the versioned Runtime.
- Workspace, Actor, Path, Intent, Proposal, Pact, and Proof transitions.
- Direct and streaming settlement through the Arc Vault.
- EOA and EIP-1271 smart-account signing paths.
- Relayed execution, on-chain receipts, residual recovery, and indexed reads.
- A shared SDK, CLI, REST boundary, and MCP surface.
- A fresh public Workspace-to-settlement verification record.

The public Runtime is the persistent coordination layer. It does not custody keys or become the
financial authority. Arc transaction evidence, Vault state, and the resulting Receipt remain the
source of truth for settlement.

## Workspace to settlement

1. Initialize a Workspace and register its owner.
2. Register the people, businesses, applications, or agents that may participate.
3. Activate a Path that defines what a participant may do and the limits that apply.
4. Prepare an Intent, evaluate a Proposal, and record the accepted terms in a Pact.
5. Submit and verify Proof for the work or usage covered by the Pact.
6. Fund the payer on Arc and execute a direct payment or a stream.
7. Reconcile the Arc transaction, Vault state, and Receipt.

This sequence keeps authority, agreement, proof, and money distinct while making them usable as one
workflow. Circle funding paths can supply the payer's Arc balance; they do not replace the Pact,
Proof, or OpenRails Receipt.

## Agent surface

The agent surface is the application layer for discovery, decision support, and authorization
handoff. The SDK and MCP server use the same Shared Interface as the Runtime and payment surfaces.

An agent can discover a service, inspect or quote it, plan an approval-bound action, prepare an
operation, validate the request, and verify the resulting records. An external wallet or
application remains responsible for authorization and submission. The agent surface does not
create signers, receive private keys, sign Runtime transitions, invoke CCTP, open a Vault, stream
funds, relay transactions, or claim financial success without verified evidence.

## Arc and Circle

Arc is the primary settlement environment for OpenRails. Its USDC-native fee model and fast
settlement make it a strong base for direct payments, streamed work, and agent transactions.

Circle infrastructure is integrated around the OpenRails lifecycle:

- **Modular Wallets and passkeys** provide the browser account path.
- **Circle smart-account support** connects EIP-1271 accounts to the OpenRails signing boundary.
- **Circle Console** provisions the public browser client and allowed origin.
- **Gas Station** provides the sponsorship boundary for Arc UserOperations.
- **Gateway** provides funding helpers for moving USDC into the Arc settlement environment.
- **x402** provides an HTTP payment path for service access and agent-facing experiments.
- **CCTP V2** provides the SDK funding handoff, source-chain burn plan, attestation lookup, and Arc
  destination receive plan for Workspace-funded payments.
- **Agent Stack patterns** connect agent discovery, approval, and wallet handoff to the OpenRails
  lifecycle.

OpenRails remains the authority and settlement model above these infrastructure components. The
exact execution evidence and verification state for each Circle integration is maintained in
[`docs/circle-integration-status.md`](docs/circle-integration-status.md).

## Start using OpenRails

### Web application

Open [openrails.pages.dev](https://openrails.pages.dev) to connect a wallet, initialize a Workspace,
create a payment, issue or claim value, and inspect the resulting lifecycle.

### SDK and CLI

```bash
npm install openrails-sdk
```

```ts
import { LeptonOpenRailsClient, payGasless } from "openrails-sdk/arc";
```

For a direct command-line flow:

```bash
npm install --global openrails-sdk
export OPENRAILS_PAYER_PRIVATE_KEY=0x<funded-arc-key>
openrails pay-stream --recipient 0x<recipient> --total-allocation-pool 10000 \
  --flow-velocity-per-second 1 --lifespan-seconds 3600 --execute
```

Mutating CLI commands are dry-run unless `--execute` is supplied. Keys are read from environment
variables and never from command arguments.

### MCP

Register the safe agent surface with an MCP client:

```json
{
  "mcpServers": {
    "openrails": {
      "command": "npx",
      "args": ["openrails-mcp"]
    }
  }
}
```

The MCP tools cover capabilities, discovery, planning, preparation, validation, verification,
and safe reads. They do not custody keys or submit financial transactions.

## Developer surface

```bash
npm install
npm run compile
npm run test
npm run test:foundry
npm run build:sdk
npm run release:check
```

The release gate covers the Shared Interface, public Runtime, worker bundle, SDK, MCP server, and
web application build. The full HTTP route map, auth model, and response authority are documented
in [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).

## Security and authority model

The Arc Vault is the financial boundary. It authenticates the explicit payer signature, supports
EOA and EIP-1271 accounts, enforces replay protection, escrows USDC, and records the payment state.
OpenRails coordination records describe why a payment is allowed; the Vault and transaction
receipts prove what actually moved.

The application, SDK, CLI, Runtime, keeper, indexers, and agents are replaceable interfaces around
that authority boundary. None of them should be treated as a substitute for on-chain verification.

## Documentation

- [Getting Started](GETTING_STARTED.md)
- [Documentation index](docs/README.md)
- [API reference](docs/API_REFERENCE.md)
- [Agent surface](docs/agent/README.md)
- [Circle integration status](docs/circle-integration-status.md)
- [Public Workspace settlement evidence](docs/public-workspace-runtime-settlement-evidence.md)

OpenRails provides the shared interface for turning bounded work into verifiable settlement.
