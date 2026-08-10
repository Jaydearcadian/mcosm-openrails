# OpenRails Runtime

Private headless runtime implementation for Shared Interface 1.2 control-plane transitions on Arc Testnet.

The runtime accepts these signed control-plane transitions:

1. `workspace.register` creates the first Workspace authority record.
2. `actor.register` registers the Workspace owner Actor or a later Actor under Workspace authority.
3. `path.activate` and `path.revoke` apply owner-signed Path state changes.
4. `intent.prepare` records a Workspace and Path-bound Intent under owner authority.
5. `proposal.evaluate` runs bounded Baphomet policy and records an `ALLOW` or `BLOCK` Decision.
6. `proposal.submit` preserves the existing delegated Proposal path and atomic period usage behavior.
7. `pact.sign` accepts an allowed Pact, activates it, and optionally binds a Canonical Record.
8. `proof.submit` records proof immediately before its Pact policy gate, and `proof.verify` records bilateral-party verification.

These transitions close the offchain control-plane lifecycle only. They do not create a wallet action,
Paycard, transaction, receipt, or value movement. Existing direct RailsFlow and RailsCard operations
remain outside this Runtime and continue to use their registry-selected direct wallet or relay paths.

Every request is passed to `@openrails/shared-interface` `validateOperation` first. Before a stored Workspace, Actor, Path, Intent, Proposal, Baphomet Decision, or Pact can be used as an authorization fact, the runtime validates it with `assertValidSchema` and its exact Shared Interface 1.2 schema ID. Malformed stored authorization state fails closed and the surrounding transaction rolls back.

The runtime then enforces the Arc manifest domain and network, the `offchain-runtime` signature purpose, the bounded transition-signature lifetime, EIP-712 EOA recovery or EIP-1271 contract-wallet verification, delegated reference truth, and replay protection. A Path must be active, currently within its generic signature-binding window, bound to the Arc settlement typed-data domain and anchor, issued by the active Workspace authority, and include the Intent action in its capabilities.

Every Path limit matching the payment asset is enforced. The amount must fit `maxAmount` and optional `maxAmountPerTransaction`. Streamed terms must fit optional velocity and lifespan bounds. Proposal submission also reserves transaction count and cumulative amount under every applicable limit in the same transaction as the proposal and replay nonce. The deterministic period bucket is `floor(currentUnixSeconds / periodSeconds) * periodSeconds`. Its key includes the Path ID, normalized asset, limit index, period length, and bucket start, so overlapping limits remain independent.

## Path ingestion

Path records must pass an application-supplied `PathAttestor` before they can authorize a proposal or Pact transition. The attestor receives the validated Shared Interface 1.2 Path and returns a valid Shared Interface `Provenance` object. The runtime stores that provenance on the Path and stores an exact accepted Path snapshot beside it. Authorization fails closed when the attestation is missing, malformed, configuration-only, or no longer matches the stored Path.

Shared Interface 1.2 does not publish a canonical Path digest or a universal Path signature primary type. The runtime therefore does not invent a digest and does not claim universal cryptographic Path verification. The caller-supplied attestor is the authenticated application boundary and must implement the appropriate verification or operator approval for its Path source.

## API

```ts
import { MemoryRuntimeStore, Runtime } from "@openrails/runtime";

const runtime = new Runtime({
  store: new MemoryRuntimeStore(),
  provider: arcReadProvider,
  pathAttestor: applicationPathAttestor
});

const acceptedPath = await runtime.ingestPath(path);
const response = await runtime.execute(signedOperationRequest);
```

`Runtime.execute` returns an `OperationResponse` for a successful control-plane transition. A policy
block returns a structured `BLOCKED` response with an `InterfaceError`, `transaction.status` set to
`NOT_REQUESTED`, and `financialEffect` set to `NONE`. Other invalid input, wrong-network bindings,
expired signatures, provider failures, authorization failures, and nonce conflicts throw a typed
`RuntimeError`; the public Worker serializes those failures with the same no-value error contract.
No error path consumes a nonce.

`Runtime.ingestPath` does not sign, broadcast, or move value. It validates the Path and attestor result, then records the accepted Path and provenance in the configured store. An existing Path can only be re-ingested when its content is unchanged and it has no prior attestation record.

The default maximum signature lifetime is 15 minutes, with a 30 second clock-skew allowance for `issuedAt`. The EIP-712 domain and message are taken from the frozen Arc Testnet manifest and the shared-interface runtime signature helpers. The domain has `name`, `version`, `chainId`, and `salt`; it has no `verifyingContract`. The message primary type is `OpenRailsRuntimeTransition`.

## Storage

`MemoryRuntimeStore` is deterministic and serializes transactions for tests and local use. `PostgresRuntimeStore` uses a row-locked JSON state record and the migration in `migrations/001_runtime.sql`. The replay table has a composite primary key over the complete replay scope. A Postgres transaction inserts the replay row, checks and reserves Path-period usage, and updates the state record before committing. The state JSON includes accepted Path attestation snapshots. Older state rows normalize without attestation records, so those Paths cannot authorize until they are explicitly re-ingested.

The Postgres implementation accepts a small query executor boundary so the application can provide its own `pg.Pool` without making this package a server or database bootstrapper. `pg` is a development dependency used by the integration harness, not by the runtime package API. Runtime state now normalizes `proofs` and `canonicalRecords` maps in older JSON rows; no SQL migration is needed because the existing singleton state remains JSONB and the replay table is unchanged.

The normal unit suite does not require Postgres. To run the real database coverage, apply the scoped migration through the test harness and provide a disposable test database URL:

```sh
TEST_DATABASE_URL=postgres://user:password@localhost:5432/openrails_test npm run test:integration
```

The integration suite covers transaction rollback, replay conflict, and concurrent Path count and cumulative-amount enforcement. It truncates only `openrails_runtime_replay_nonces` and `openrails_runtime_state` in the database named by `TEST_DATABASE_URL`.

## Arc provider boundary

`ArcJsonRpcProvider` exposes only `eth_getCode` and `eth_call` through `ArcProvider`. It is used to distinguish EOAs from contract signers and to perform the EIP-1271 read. It has no transaction submission method. Its default endpoint is read from the frozen `@openrails/shared-interface` Arc Testnet manifest.

Runtime Path authorization validates the stored Path shape, accepted attestation snapshot, issuer relationship, Arc manifest binding, and current time window.

## Canonical Record binding

When a Pact declares Canonical Record mode `required` or `optional`, `pact.sign` validates the
record envelope, Pact reference, bilateral party coverage, signed commitment equality, and the
encrypted-key coverage or public exposure rule before storing it with the active Pact. The Runtime
does not retrieve offchain content or recover the EIP-712 signature bytes in the record. A separate
record verifier remains required before treating those signatures as cryptographic proof.

## Status

This package is private implementation evidence. Workspace Runtime remains `NOT_LIVE` in the Arc manifest. The package does not broadcast transactions, move value, or claim live deployment. A passing local or Postgres test is not deployment evidence.
