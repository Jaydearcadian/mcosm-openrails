# Security

This package is a private release candidate. It is an offchain control-plane runtime, not a custody system and not a financial settlement executor.

## Boundaries

- The runtime accepts the ten signed Shared Interface 1.2 control-plane transitions: `workspace.register`, `actor.register`, `path.activate`, `path.revoke`, `intent.prepare`, `proposal.evaluate`, `proposal.submit`, `pact.sign`, `proof.submit`, and `proof.verify`.
- Shared Interface registry-bound validation runs before runtime logic, state access, or provider calls.
- Arc Testnet is the only configured network. The runtime verifies the exact manifest network, EIP-712 domain, signature purpose, and anchor contract.
- EOAs are checked with EIP-712 recovery. Contract accounts are checked with EIP-1271 `isValidSignature(bytes32,bytes)`.
- Stored authorization objects are validated against their exact Shared Interface 1.2 schemas before use. Invalid persisted objects fail as stale or unauthorized state.
- A Path must enter through `Runtime.ingestPath` with a caller-supplied `PathAttestor`. The attestor receives the schema-validated Path and returns valid Shared Interface Provenance.
- The runtime rejects missing, malformed, configuration-only, or previously authenticated Path records with mismatched content. It stores the attestor result as Path provenance and persists an exact accepted Path snapshot before the Path can authorize proposal or Pact transitions.
- A Path is bounded by its active status, Workspace issuer authority, Arc settlement domain and anchor, current signature-binding time window, capabilities, applicable asset limits, amount, optional per-transaction amount, and optional stream velocity and lifespan.
- Every matching Path limit is enforced. Per-period transaction count and cumulative amount reservations share the same atomic transaction as the Proposal and replay nonce.
- The runtime has no private-key, signing, custody, transaction-submission, or broadcast API.
- A successful transition changes control-plane state only. It is not evidence of a transaction, receipt, asset movement, or financial success.
- `proposal.evaluate` returns an explicit `ALLOW` or `BLOCK` Decision. A block records no Pact, wallet action, Paycard, or value movement and carries `financialEffect: NONE` and `transactionState: NOT_REQUESTED`.
- `pact.sign` may bind a Canonical Record according to the Pact policy. Runtime validates the envelope commitment and bilateral actor coverage, but does not recover or cryptographically verify the record's EIP-712 signature bytes.

## Replay and failure behavior

Replay scope is `(domain salt, chain ID, anchor contract, signer, nonce)`. Nonce insertion and state mutation occur in the same store transaction. A failed validation, signature check, authorization check, or state write rolls back nonce insertion. A concurrent duplicate is rejected by the in-memory serialization boundary or the Postgres primary-key constraint.

Path usage periods use fixed Unix-time buckets. Each key includes the Path ID, normalized asset, limit index, period length, and bucket start. Multiple limits for one asset therefore reserve independently, while the row lock or in-memory serializer prevents concurrent proposals from crossing count or cumulative-amount boundaries.

Shared Interface 1.2 does not publish a canonical Path digest or universal Path signature primary type. The runtime does not invent either one and does not claim universal cryptographic Path verification. The supplied PathAttestor is the authenticated application boundary and is responsible for the verification or approval appropriate to the Path source. Runtime authorization only trusts the provenance and exact snapshot produced by that boundary.

## Operational requirements

- Keep the runtime private until the package, interface, and deployment have completed independent security review.
- Use a Postgres role limited to the runtime tables and migration operations required by deployment.
- Treat RPC errors, malformed provider responses, invalid signatures, stale state, and nonce conflicts as failures. Do not retry a financial action from this package because this package does not initiate financial actions.
- Do not expose the runtime directly to an untrusted network without an authenticated application boundary, request limits, structured logging, and replay-aware request tracing.
- Run `npm run test:integration` with `TEST_DATABASE_URL` against a disposable database. The harness tests rollback, replay conflict, and concurrent Path count and amount enforcement; without that variable the integration tests are skipped.

The Arc Testnet manifest still marks Workspace Runtime as `NOT_LIVE`. This package must not be described as deployed or live until separate deployment evidence exists.
