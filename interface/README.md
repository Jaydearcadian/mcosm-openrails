# OpenRails Shared Interface

Private PR1 package for the OpenRails Shared Interface 1.0.1 contract.

The package is owned by the `Jaydearcadian/mcosm-OpenRails` implementation target. JSON Schema 2020-12 is the portable canonical contract. `src/generated.ts` is deterministic output derived from the schemas and is not an independent source of truth.

## Scope

PR1 provides:

- reusable schemas for OpenRails objects, profiles, proofs, payments, receipts, errors, transactions, manifests, and operation envelopes;
- explicit direct wallet-authorized and delegated Runtime reference rules;
- machine-readable lifecycle and transaction outcome rules;
- a complete registry for the 38 capabilities in Product Foundry Shared Interface 1.0.1;
- an Arc Testnet manifest grounded in repository constants;
- generated TypeScript types, fixtures, and focused contract tests.

PR1 does not integrate the SDK, MCP, REST, Runtime, worker, cockpit, webapp, GIWA, X Layer, MidiumOR, GoalSession, or sidecars. Workspace Runtime is not live on Arc. Shared Interface is not live and cross-network parity is not claimed.

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

The built package exports `resolveOperation`, `validateOperation`, and `assertValidOperation` from `dist/index.js`. Resolve an operation by operation ID or capability, then validate the request or response wrapper and the registry-selected exact payload schema. Validation also checks operation ID and capability equality, registry authorization class, and the allowed execution profile. AJV is a runtime dependency and `pack:check` imports the packed API in a clean consumer prefix.

Operation responses always contain `data`. Successful and non-terminal responses require non-null data matching the registry-selected response payload. `FAILED` and `BLOCKED` responses require structured errors; `CANCELLED`, `FAILED`, and `BLOCKED` responses may use `data: null`. The operation validator skips the success payload validator only for those terminal null outcomes. Blocked responses cannot include a Pact or financial effect.

## Contract boundaries

Wallet authorization and financial broadcast remain user boundaries. A transaction in `SUBMITTED`, `PENDING_CONFIRMATION`, or `CONFIRMED` state is not financial success by itself. A financial success claim requires an exact verified receipt, chain identity, transaction lifecycle, provenance, and reconciliation with the per-network Vault canonical state.

Direct flows may omit Workspace, Path, Pact, and Proof when the wallet authorizes the exact action. Delegated Runtime operations require Workspace, Path, Intent, Proposal, Baphomet Decision, and Pact references. A blocked delegated Proposal has no Pact, wallet action, Paycard, or value movement. Proof is conditional and is inserted immediately before the transition selected by its signed policy.

RailsFlow is request-to-pay. RailsCard is payer-signed claimable value and is either bearer or recipient-bound. Paycard Stream is funded Vault state. One-time and streamed settlement shapes are independent from the access mode.

Contract-bound replay nonces are unsigned decimal strings and may start at `0`. Payment amount, streamed velocity, and streamed lifespan are positive semantic quantities. A one-time payment omits velocity and lifespan. Paycard IDs, transaction hashes, and block hashes are 32-byte hashes. Confirmed transaction identity is owned by `transaction`; exact event evidence retains event index, contract address, event name, event signature, and observed values hash. Arc authorization and claim mappings both use `PaycardProvisioned`; claim verification additionally requires operation, signature, recipient, and observed event context.

## Status

The package is private PR1 implementation evidence. The schema interface version is `1.0.1`; the package version is `0.1.0` until a reviewed release line is established. The Arc manifest uses `LIVE`, `VERIFIED`, `RECORDED`, `PLANNED`, and `UNAVAILABLE` only where repository evidence supports the label. It does not mark Workspace Runtime live.

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
