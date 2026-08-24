# OpenRails

**Programmable clearing and settlement for work, commerce, and agentic services.**

OpenRails connects a commercial request to the conditions under which it may be performed, the
evidence that it was performed, and the value that should settle. It gives people, businesses,
creators, applications, and agents one bounded lifecycle for coordinating work and moving USDC.

```text
Workspace -> authority -> terms -> proof -> payment -> receipt
```

OpenRails is the coordination, clearing, and settlement layer. It is not a wallet, an AI agent,
a bridge, or a generic collaboration product. Wallets, agents, applications, and Circle services
connect to the OpenRails lifecycle.

## Product model

| Object | Purpose |
| :--- | :--- |
| **Workspace** | Durable context for a commercial relationship or operating environment. |
| **Party or agent** | A participant that can be registered and given bounded responsibility. |
| **Path** | The capability and authority limit assigned to a participant. |
| **Intent and proposal** | The requested action and the terms submitted for evaluation. |
| **Pact** | The accepted terms that bind the workflow. |
| **Proof** | Evidence that the agreed work or usage occurred. |
| **Payment** | A direct transfer or a stream that releases value over time or usage. |
| **Receipt** | The verifiable record of what cleared and settled. |
| **Gaia case** | The path for an exception that cannot close through the normal lifecycle. |

The vocabulary is deliberately plain at the application layer. The SDK, REST interface, and MCP
surface expose the same model through stable protocol types.

## Workspace to settlement

1. Connect an authorizing wallet and initialize a Workspace.
2. Register the people, businesses, applications, or agents that may participate.
3. Create and activate a Path with explicit capabilities and limits.
4. Record an Intent, evaluate a Proposal, and accept the terms in a Pact.
5. Submit and verify Proof for the covered work or usage.
6. Fund the payer and execute a direct payment or a stream.
7. Reconcile the Arc transaction, Vault state, and OpenRails Receipt.

The Runtime stores signed coordination records. It does not custody keys or become the financial
authority. The Arc Vault, transaction receipt, and settlement evidence remain authoritative for
what actually moved.

## Public surfaces

OpenRails is currently anchored on Arc, using USDC-native fees and settlement on chain `5042002`.

| Surface | Reference |
| :--- | :--- |
| Arc V2 canonical hub | `0x941C8029F0f912df3fAb7423890ab2359b996D0b` |
| Arc USDC | `0x3600000000000000000000000000000000000000` |
| Versioned Runtime | `https://openrails-interface-worker.microcosm.workers.dev` |
| Web application | [openrails.pages.dev](https://openrails.pages.dev) |
| SDK and CLI | [`openrails-sdk`](https://www.npmjs.com/package/openrails-sdk) |
| Agent surface | [`openrails-mcp`](https://www.npmjs.com/package/openrails-mcp) |

The public application supports wallet connection, Workspace initialization, participant and
authority setup, direct and streaming payments, and lifecycle inspection. The SDK, CLI, REST
boundary, and MCP server expose the same shared interface for applications and agents.

## Agent surface

The agent surface handles discovery, decision support, authorization handoff, preparation,
validation, and verification. An external wallet or application remains responsible for signing
and submitting financial actions.

Agents do not receive private keys, create signers, approve their own authority, open a Vault,
stream funds, or claim a payment succeeded without verifiable evidence. The MCP server provides
safe reads and preparation tools; the SDK and application provide the execution boundaries.

## Arc and Circle

Arc is the primary settlement environment for OpenRails. Its USDC-native fee model and fast
settlement support direct payments, streamed work, and agent transactions.

Circle services are integrated around the OpenRails lifecycle:

- **Modular Wallets and passkeys** provide the browser account path.
- **Circle smart-account support** connects EIP-1271 accounts to the signing boundary.
- **Circle Console** provisions the browser client key and allowed origin.
- **Gas Station** provides the sponsorship boundary for Arc UserOperations.
- **Gateway** provides funding helpers for moving USDC into Arc.
- **CCTP V2** provides the source-chain burn plan, attestation handoff, and Arc receive plan for
  Workspace-funded payments.
- **x402** provides an HTTP payment path for service access and agent-facing experiments.
- **Agent Stack patterns** connect discovery, approval, and wallet handoff to OpenRails.

OpenRails remains the authority, agreement, clearing, proof, and receipt layer above these
services. Integration evidence and verification state are maintained in
[`docs/circle-integration-status.md`](docs/circle-integration-status.md).

## Install and use

### SDK and CLI

```bash
npm install openrails-sdk
```

```ts
import { LeptonOpenRailsClient, payGasless } from "openrails-sdk/arc";
```

For the CLI:

```bash
npm install --global openrails-sdk
export OPENRAILS_PAYER_PRIVATE_KEY=0x<funded-arc-key>
openrails pay-stream --recipient 0x<recipient> --total-allocation-pool 10000 \
  --flow-velocity-per-second 1 --lifespan-seconds 3600 --execute
```

Mutating CLI commands are dry-run unless `--execute` is supplied. Keys are read from environment
variables and never from command arguments.

### MCP

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

### Local development

```bash
npm install
npm run compile
npm run test
npm run test:foundry
npm run release:check
npm run cockpit:dev
```

The release check covers the Shared Interface, Runtime, worker bundle, SDK, MCP server, and web
application build. Public HTTP routes and response authority are documented in the
[`API reference`](docs/API_REFERENCE.md).

## Repository map

- `contracts/`: Arc Vault and related contract code.
- `interface/`: schemas, manifests, operations, and validation rules.
- `packages/openrails-runtime/`: persistent Runtime behavior and storage boundary.
- `server/` and `workers/`: REST and deployed service boundaries.
- `sdk/`: JavaScript SDK, CLI, wallet adapters, and funding helpers.
- `mcp/`: safe agent tools and MCP server.
- `cockpit/`: the web application and user-facing Workspace flow.

## Authority and security

The Arc Vault is the financial boundary. It authenticates the payer, supports EOA and EIP-1271
accounts, enforces replay protection, escrows USDC, and records payment state.

The Runtime, application, SDK, CLI, indexers, and agents are replaceable interfaces around that
boundary. They describe why a payment is allowed and how it should be reconciled; they do not
replace on-chain verification.

## Documentation

- [Getting Started](GETTING_STARTED.md)
- [Documentation index](docs/README.md)
- [API reference](docs/API_REFERENCE.md)
- [Agent surface](docs/agent/README.md)
- [Circle integration status](docs/circle-integration-status.md)
- [Circle Gas Station boundary](docs/circle-gas-station-boundary.md)
- [Public Workspace settlement evidence](docs/public-workspace-runtime-settlement-evidence.md)
- [Stream indexing](docs/stream_indexing.md)
- [Harness setup](docs/harness-setup.md)
