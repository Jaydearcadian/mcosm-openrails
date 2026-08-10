# OpenRails Shared Interface

Private PR2 package for the OpenRails Shared Interface 1.2.0 contract.

The package is owned by the `Jaydearcadian/mcosm-OpenRails` implementation target. JSON Schema 2020-12 is the portable canonical contract. `src/generated.ts` is deterministic output derived from the schemas and is not an independent source of truth.

## Scope

The contract package provides:

- reusable schemas for OpenRails objects, profiles, proofs, payments, receipts, errors, transactions, manifests, and operation envelopes;
- explicit direct wallet-authorized and delegated Runtime reference rules;
- machine-readable lifecycle and transaction outcome rules;
- a complete registry for the 45 capabilities in Product Foundry Shared Interface 1.2.0;
- signed runtime control-plane transitions for Workspace bootstrap, Actor registration, Path activation and revocation, Intent preparation, Proposal evaluation and submission, Pact acceptance, and Proof submission and verification;
- an Arc Testnet manifest grounded in repository constants;
- generated TypeScript types, fixtures, and focused contract tests.

This candidate freezes and implements the backend contract boundary for the SDK, MCP, REST safe routes, and private Runtime package. The generated schema, registry, and manifest artifacts are embedded in the package so the validator can run in filesystem-free edge runtimes such as Cloudflare Workers. The public Worker now proves a Neon-backed offchain Runtime control-plane deployment, while this package does not claim a chain-native Workspace Runtime, cockpit, webapp, GIWA, X Layer, MidiumOR, GoalSession, or sidecar integration. Cross-network parity is not claimed.

## Commands

Run commands from this directory:

```bash
npm install
npm run schemas:validate
npm run generate
npm run generate:check
npm test
npm run typecheck
npm run build
npm run pack:check
```

`npm test` validates every schema and reference, checks deterministic generated output, type-checks the generated type fixture, then runs the fixture tests. `npm run typecheck` also checks that fixture. `npm run generate:check` exits non-zero when `src/generated.ts` differs from generated output. `npm run pack:check` performs an npm pack dry run and imports the packed API in a clean consumer prefix.

The built package exports `resolveOperation`, `validateOperation`, and `assertValidOperation` from `dist/index.js`. Resolve an operation by operation ID or capability, then validate the request or response wrapper and the registry-selected exact payload schema. Validation also checks operation ID and capability equality, registry authorization class, allowed execution profile, signed payload hash, reference equality, and successful transition state. Runtime signature helpers export the canonical payload hash, typed-data message, digest, and EOA recovery contract. AJV, canonicalize, and ethers are runtime dependencies, and `pack:check` imports the packed API in a clean consumer prefix.

Operation responses always contain `data`. Successful and non-terminal responses require non-null data matching the registry-selected response payload. `FAILED` and `BLOCKED` responses require structured errors; `CANCELLED`, `FAILED`, and `BLOCKED` responses may use `data: null`. The operation validator skips the success payload validator only for those terminal null outcomes. Blocked responses cannot include a Pact or financial effect.

## Contract boundaries

Wallet authorization and financial broadcast remain user boundaries. A transaction in `SUBMITTED`, `PENDING_CONFIRMATION`, or `CONFIRMED` state is not financial success by itself. A financial success claim requires an exact verified receipt, chain identity, transaction lifecycle, provenance, and reconciliation with the per-network Vault canonical state.

Direct flows may omit Workspace, Path, Pact, and Proof when the wallet authorizes the exact action. Delegated Runtime operations require Workspace, Path, Intent, Proposal, Baphomet Decision, and Pact references after bootstrap. `workspace.register` creates the first Workspace without prior references. `actor.register` requires that Workspace but no Path. Owner-signed Path activation and revocation establish the bounded authority window. Intent preparation, Proposal evaluation, Pact acceptance, and Proof submission or verification then use the exact reference chain. A blocked delegated Proposal has no Pact, wallet action, Paycard, or value movement. Proof is conditional and is inserted immediately before the transition selected by its signed policy.

Payment Request is the user-facing name for RailsFlow request-to-pay. Claimable Payment is the user-facing name for RailsCard, which may be bearer or recipient-bound. Paycard Stream is funded Vault state. One-time and streamed settlement shapes are independent from the access mode. RailsFlow and RailsCard remain the protocol names used by integrations.

Contract-bound replay nonces are unsigned decimal strings and may start at `0`. Payment amount, streamed velocity, and streamed lifespan are positive semantic quantities. A one-time payment omits velocity and lifespan. Paycard IDs, transaction hashes, and block hashes are 32-byte hashes. Confirmed transaction identity is owned by `transaction`; exact event evidence retains event index, contract address, event name, event signature, and observed values hash. Arc authorization and claim mappings both use `PaycardProvisioned`; claim verification additionally requires operation, signature, recipient, and observed event context.

## Status

The package is private PR2 implementation evidence. The schema interface version is `1.2.0`; the package version is `0.3.0`. Interface 1.2 is additive over the 1.1 operation set. The version schema accepts both `1.1.0` and `1.2.0`, and all existing prepare, read, wallet-handoff, and financial operation contracts remain present. The Arc manifest uses `LIVE`, `VERIFIED`, `RECORDED`, `PLANNED`, and `UNAVAILABLE` only where repository evidence supports the label. The signed Runtime transitions are still `UNAVAILABLE` in this package because it contains no deployment state.

Signed runtime transitions are offchain control-plane envelopes. The existing registry operation IDs are reused; no parallel product API or new interface version was introduced. Lifecycle payloads accept caller-supplied authorization evidence binding the operation ID and payload hash. The Runtime requires that evidence for execution, while existing safe prepare and read routes remain compatible. A response echoes the verified request binding where the operation defines it and does not represent a Runtime attestation. The contract contains no private keys, signer secrets, custody authority, transaction broadcast, or financial asset movement. A valid schema or fixture is not evidence of a live Arc capability.

### Runtime signature contract

Runtime transition authorization uses EIP-712 with primary type `OpenRailsRuntimeTransition`. The domain fields are `name`, `version`, `chainId`, and `salt`. The Arc Testnet domain is published in `manifests/arc-testnet.json`. `signaturePurpose` is a separate manifest and signed-message field. The domain salt binds the interface, purpose, and network. The domain deliberately has no `verifyingContract` because the signature is verified by the offchain Runtime, not by the Arc Hub.

The typed message fields and Solidity types, in order, are:

```text
operationId     string
payloadHash     bytes32
signer          address
nonce           uint256
issuedAt        string
expiresAt       string
signaturePurpose string
anchorContract  address
```

`payloadHash` is `keccak256` of RFC 8785 JSON Canonicalization Scheme bytes for the operation request `data` object after omitting its top-level `signatureBinding`. The Runtime must reject a binding when the operation ID differs from the registry operation, the payload hash differs, wrapper references differ from the signed payload references, the binding and domain chain IDs differ, the domain differs from the network manifest, the anchor contract differs from the manifest, or the current time is outside the inclusive `issuedAt` and exclusive `expiresAt` interval.

Replay nonces are consumed globally for the tuple `(domain salt, chainId, anchorContract, signer, nonce)`, not per operation. A successful transition consumes the nonce atomically with its state write. A failed validation does not consume it. The Runtime must reject a previously consumed nonce before applying any state change.

Workspace bootstrap binds the `workspace.register` signer as the initial wallet authority for `workspace.ownerActorRef`. Registering that owner Actor requires the same Actor ID and signer wallet. Later Actor registration requires the current Workspace authority. Proposal submission requires the signer to resolve to an active delegate authorized by the referenced Path. Pact signing requires the signer to resolve to an authorized Pact party, the Proposal chain to match, and the referenced Baphomet Decision to be `ALLOW`. These are Runtime authorization requirements in addition to schema validation.

The Arc Hub address is an anchor that binds authorization to the current OpenRails deployment. It does not verify the Runtime transition signature. EOA signatures are verified by EIP-712 address recovery. Contract-wallet signatures are verified against the signer account through EIP-1271 `isValidSignature` using the same typed-data digest. Implementations must call the registry-bound `validateOperation` or `assertValidOperation`; validating only the broad request, response, or legacy operation-envelope schema is insufficient.

## Extension and versioning

Interface versioning follows the Product Foundry policy: breaking changes require a major version, additive compatible changes require a minor version, and fixes or evidence-only changes require a patch version. Every schema keeps a stable `$id` for its interface version. Public objects reject unknown properties. Additive caller-owned data must be placed under an `extensions` object with `x-` property names.

`ExtensionData` is generated as an `x-*` template-literal index type, while JSON Schema and AJV enforce the complete property-name pattern and permit any JSON value for each extension value.

Schema changes require regenerated types, updated fixtures, targeted tests, and a compatibility note. Never add private keys, seed phrases, RPC credentials, or bearer secrets to a schema, fixture, manifest, or generated type.

## Package layout

```text
schemas/       JSON Schema 2020-12 source and stable schema aliases
manifests/     network and capability declarations
registries/    operation and lifecycle rules
fixtures/      valid and invalid contract examples
src/           generated TypeScript types and package entrypoint
scripts/       validation and deterministic generation tools
test/          focused contract tests
```
