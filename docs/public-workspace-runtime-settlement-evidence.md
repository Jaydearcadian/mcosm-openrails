# Public Workspace Runtime Settlement Evidence

**Observed:** 2026-08-10
**Network:** Arc Testnet, chain ID `5042002`
**Worker:** `https://openrails-interface-worker.microcosm.workers.dev`
**Verification run:** `npm run smoke:public-workspace-settlement`

## What was proven

The public smoke harness completed a bounded delegated Workspace lifecycle against the
Neon-backed Runtime Worker:

1. Workspace and Actor records were registered through signed Runtime transitions.
2. A wallet-attested Path was ingested and activated with bounded payment authority.
3. A delegated wallet submitted the matching Intent and Proposal.
4. The Runtime returned `ALLOWED` for the in-limit Proposal and `BLOCKED` with
   `PATH_LIMIT_EXCEEDED` for the over-limit Proposal.
5. The matching Pact was committed and its Proof was submitted and verified.
6. The owner wallet performed the Arc settlement separately from the Runtime.

The Runtime did not hold a private key, sign for a wallet, broadcast a transaction, or move
value. It is the persistent offchain authorization and lifecycle control plane. Arc remains the
financial settlement boundary.

## Runtime identifiers

| Object | Identifier |
| --- | --- |
| Workspace | `workspace:public-proof:msn14rvw` |
| Path | `path:public-proof:msn14rvw` |
| Intent | `intent:public-proof:msn14rvw` |
| Proposal | `proposal:public-proof:msn14rvw` |
| Pact | `pact:public-proof:msn14rvw` |
| Proof | `proof:public-proof:msn14rvw` |
| Delegate wallet | `0x761927924D2f1B8353dc6493c83aa6B6f9Ee0a9e` |
| Workspace state | `PREPARED` |
| Intent state | `PREPARED` |
| Allowed proposal state | `ALLOWED` |
| Pact state | `COMMITTED` |
| Proof state | `PROOF_VERIFIED` |
| Blocked proposal state | `BLOCKED` |
| Blocked reason | `PATH_LIMIT_EXCEEDED` |

## Arc receipts

The test settled `0.01` USDC on Arc Testnet:

| Object | Value |
| --- | --- |
| Paycard | `0xaae90405331893ad451b40f268768097446ffb4547592ce27d51c600941867ce` |
| Open transaction | `0x51508d5d097ac3029fefa1754b8c27211f1ae28995750d9f0988bc2cd74d6bd1` |
| Settle transaction | `0x3b21444c2877b9cc1fbfd9027adc6cfe9e5371b9c8c2215cacdbf3f0ad235c92` |
| Flush transaction | `0x40eac2c32bbac518497934f6dd5885f4e13334a5c3fd28c7cfe7a4f1e9cc25a3` |
| Final available balance | `0` |
| Final operational status | `1` |

The run also committed metadata binding:

- `metadataRef`: `workspace=workspace:public-proof:msn14rvw;path=path:public-proof:msn14rvw;pact=pact:public-proof:msn14rvw;proof=proof:public-proof:msn14rvw`
- `metadataHash`: `0xac93da3bb6e3a2600eb88130bfc4b525f2666a536ef3536a4032c0584eba540e`

This is Arc Testnet evidence. It does not claim production security, mainnet readiness, Circle
sponsorship, or chain-native Workspace state. The Cockpit currently uses the Runtime as its write
boundary and retains a browser cache for its local projection.

## Fresh delegated Workspace-to-settlement proof

**Observed:** 2026-08-13

The public smoke harness completed a new delegated lifecycle against the deployed Neon-backed
Runtime and the Arc V2 Hub:

| Stage | Result |
| --- | --- |
| Workspace registration | `PREPARED` |
| Intent preparation | `PREPARED` |
| Proposal evaluation | `ALLOWED` |
| Pact signing | `COMMITTED` |
| Proof verification | `PROOF_VERIFIED` |
| Over-limit proposal | `BLOCKED` with `PATH_LIMIT_EXCEEDED` |
| Arc open | `0xb272f1f219b963f7dd06a9bb9c35264ff7a241f582e9db93749e8b69d9fa9c49` |
| Arc settlement | `0x8bb8ca85414afdd0daf33d61379dede9fa307f9276df65726b0cd2f2c80879cc` |
| Residual flush | `0xc5f120f0a7b26231fec361cc099ec1e3d98b19f6a61a9d470fb8cf24bd420f20` |
| Final Vault balance | `0` |

The run used Workspace `workspace:public-proof:msqrg8m2`, Path
`path:public-proof:msqrg8m2`, Pact `pact:public-proof:msqrg8m2`, and Proof
`proof:public-proof:msqrg8m2`. The settlement metadata committed all four references and
reconciled the final Arc Vault row after settlement and residual return.

This is the current public proof of the delegated Workspace-to-settlement lifecycle. The separate
Circle Gas Station UserOperation proof and a funded cross-chain CCTP proof remain outstanding.

## Fresh public Runtime probe

**Observed:** 2026-08-12

A fresh wallet registered and discovered a new Workspace through the deployed versioned Runtime:

| Field | Value |
| --- | --- |
| Workspace | `workspace:runtime-probe:msqmly87` |
| Register response | `PREPARED` |
| Discovery response | one wallet-authorized Workspace |
| Persistence | Neon-backed Runtime |

This probe confirms public Runtime registration and wallet-scoped discovery. It is non-financial:
it does not open, settle, or claim an Arc Paycard.
