# Shared Interface 1.1 Integration

OpenRails Shared Interface 1.1 is the contract for Workspace, Path, Pact, Gaia, settlement,
receipt, wallet handoff, and Canonical Record references. The interface does not replace the Vault.
The Vault remains canonical for balances, escrow, settlement, and residual state.

## Compatibility

The SDK root is safe preparation and verification. The legacy Arc transaction surface remains under
`openrails-sdk/arc`, including signer, permit, relay, link, receipt, and client helpers. Existing
agent modules remain available through the SDK compatibility export.

The MCP release candidate exposes only `openrails_capabilities`, `openrails_prepare`,
`openrails_validate`, `openrails_verify`, and `openrails_read`. It does not create or custody
signers, accept private keys, sign, call the keeper relay, or broadcast.

The REST boundary provides:

- `GET /api/interface/capabilities`
- `POST /api/interface/prepare`
- `POST /api/interface/validate`
- `POST /api/interface/verify`
- `GET /api/interface/read` and typed read routes

Preparation is not authorization. A wallet or separately trusted runtime must sign and submit. A
submitted or confirmed transaction is not financial success without exact receipt verification and
Vault reconciliation.

## Canonical Record policy

Canonical Records are optional per Pact. The Pact policy has three modes: `omitted`, `optional`, and
`required`. It also declares `encrypted` or `public` exposure. The default SDK policy is omitted,
so records are not silently introduced into existing Pacts.

When a Pact includes a record, the envelope binds:

- Pact reference and sequence
- previous commitment, plaintext commitment, and ciphertext hash
- encrypted keys for both counterparties when exposure is encrypted
- storage locators
- bilateral typed actor signatures over the same envelope commitment
- transaction, event, receipt, and Vault settlement references

Encrypted exposure uses an explicit algorithm, key agreement, and one encrypted key per
counterparty. Public exposure uses `none` for both encryption fields and carries no encrypted keys.
Record references can be attached to receipts and operation envelopes without making the record
the financial ledger.

## Evidence

The SDK validates schema shape, policy alignment, nonempty signatures, Pact counterparty coverage,
encrypted key counterparties, and commitment equality. Cryptographic actor verification is
explicit: applications provide a verifier that resolves each Actor and checks its EIP-712
signature, including EIP-1271 validation where the signer is a smart account. Structural validation
does not claim that a signature is cryptographically verified. The SDK does not infer actor identity
from an arbitrary string, claim live financial success from a prepared envelope, or require one
indexer implementation.
