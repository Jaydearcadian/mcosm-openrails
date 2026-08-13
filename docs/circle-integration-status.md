# Circle Integration Status

Circle is part of the current OpenRails application architecture. Circle supplies wallet,
authorization, sponsorship, and liquidity primitives. OpenRails supplies the commercial state around
those primitives: Workspace, parties, delegated authority, agreements, proof, clearing, settlement,
and receipts.

The distinction matters. A Circle SDK call can create a wallet, prepare a sponsored UserOperation, or
move USDC. It does not by itself create an OpenRails agreement or prove that work was completed. The
OpenRails Runtime and Arc contracts remain the authority for those records.

## Connected and current

### Arc and USDC

**Role in OpenRails:** Arc is the current settlement environment. Circle-issued USDC is both the
payment asset and Arc's native gas asset. OpenRails binds signed allocations and payment state to the
Arc Vault, then records the resulting receipt.

**What exists:** Arc contract addresses, USDC decimal handling, direct wallet settlement, signed
Workspace operations, and Vault-backed receipt verification are implemented and used by the public
Runtime and App paths.

**Status:** current public proof environment. This is not a temporary placeholder in the product
architecture. OpenRails may support other networks later, but Arc is the lead implementation here.

### Modular Wallets and passkeys

**Role in OpenRails:** give a browser user a passkey-backed Circle smart account that can sign and
submit the settlement calls without exposing a private key to the App.

**What exists:** the App uses Circle's Modular Wallet SDK when `VITE_CIRCLE_CLIENT_KEY`, the Console
allowed origin, and the client URL are configured. The browser path creates or unlocks the smart account,
builds the OpenRails settlement plan, and requests a UserOperation.

**Status:** integrated browser path and configuration boundary. A configured wallet is not the same as
proof that a sponsored transaction reached Arc; that requires a recorded UserOperation and transaction
receipt.

### Circle smart-account adapter

**Role in OpenRails:** let the SDK accept a Circle smart account, or another EIP-1271 account, through
the same sign-only interface used by OpenRails payment flows.

**What exists:** `circleToAccount` is shipped in the SDK. It exposes the account address and typed-data
signing while leaving transaction submission to the caller, relayer, or smart-account client.

**Status:** implemented and covered by SDK validation. The adapter does not custody keys, grant spending
authority, or replace the Hub's signature and permission checks.

### Circle Console

**Role in OpenRails:** provision the browser-facing client key and allow the deployed App origin to use
the Modular Wallet SDK.

**What exists:** the App reads the public client configuration from environment variables and validates
the browser origin and HTTPS requirements. Private Circle API credentials and entity-level operations do
not belong in browser configuration.

**Status:** configuration boundary is wired. The public client key alone does not prove Wallet, Gas
Station, or Gateway execution.

### Gas Station

**Role in OpenRails:** let a Circle smart account or relayer sponsor the Arc gas needed to submit an
authorized OpenRails settlement.

**What exists:** the SDK contains the Arc contract target, sponsorship request boundary, call-plan
construction, and evidence checks. The App prepares the `approve` and Vault paycard call sequence,
submits it as a paymaster-backed UserOperation, waits for the UserOperation and transaction receipts,
then checks the exact Paycard event and live Vault state before showing confirmation.

**Status:** execution path is implemented and ready for a credentialed run. It is not marked as fully
proven until a fresh sponsored Arc transaction is recorded and its UserOperation, transaction receipt,
Vault state, and OpenRails receipt are reconciled together. The deployed App bundle contains the
configured public client-key value, but Circle's Modular Wallet RPC returned HTTP `401` during a
controlled passkey setup attempt on 2026-08-12. No UserOperation or settlement transaction was sent.
The remaining action is to correct or re-provision the Circle Console client key and allowed origin,
then rerun the same proof harness.

### Circle Gateway

**Role in OpenRails:** fund an Arc settlement from USDC held outside Arc through Circle's Gateway
deposit and attestation flow.

**What exists:** SDK helpers for a depositor deposit, a third-party deposit, and attestation-backed mint
submission are shipped. The Arc Gateway wallet, minter, and USDC addresses are recorded in the SDK and
docs.

**Status:** a same-chain Arc Testnet attestation, mint, delayed burn, replay guard, fee, and API-balance
reconciliation is recorded in `experiments/circle-gateway-live-proof-2026-08-12.md`. A funded second
supported testnet source and a destination Arc mint remain outstanding before claiming a cross-chain
proof.

### Circle x402

**Role in OpenRails:** experiment with HTTP service payments where a buyer pays for a gated artifact or
service and a worker consumes it.

**What exists:** the x402 artifact, buyer flow, and worker flow exist in the experiments and worker
surfaces.

**Status:** a paid x402 request through Circle's Arc testnet facilitator and a separate x402-to-Paycard
Stream bridge have historical proof records in `experiments/x402-smoke/`. The proof is explicit about
the two pots: the x402 access fee and the buyer-funded OpenRails escrow are separate. This is still an
integration surface, not a replacement for the Workspace lifecycle, and it does not turn every HTTP
payment into a Workspace, Pact, Proof, or settlement receipt automatically.

## Next integration work

- **Sponsored settlement evidence:** complete the Console and server configuration, run one fresh
  sponsored Arc settlement, and reconcile the UserOperation, transaction receipt, Paycard event, Vault
  state, and OpenRails receipt.
- **Gateway evidence:** a same-chain Arc Testnet attestation, mint, delayed burn, replay guard, fee,
  and API-balance reconciliation is recorded in `experiments/circle-gateway-live-proof-2026-08-12.md`.
  A funded second supported testnet source and a destination Arc mint remain outstanding before
  claiming a cross-chain proof.
- **CCTP:** the SDK now exposes a prepare-only CCTP V2 boundary for Ethereum Sepolia and Base
  Sepolia source burns, read-only Circle attestation status, Arc Testnet destination minting, and
  Workspace funding references. The plan funds the party's Arc wallet first, then the existing
  direct or streaming OpenRails flow runs on Arc. It does not sign, broadcast, call CCTP
  automatically, or treat a source burn as a payment receipt. A funded source-chain burn, Circle
  attestation, Arc mint, and matching OpenRails receipt are still required for a live cross-chain
  proof. A direct CCTP hook into the Hub remains out of scope until the contract and replay policy
  are separately reviewed.
- **App Kits:** introduce only the kits that solve a demonstrated flow. Send is the clearest candidate
  for one-time value movement. Unified Balance can simplify funding visibility. Bridge, Swap, or a
  future RFQ or FX surface should be added only when procurement or treasury workflows require them.
- **Agent Stack:** connect agent wallet and action patterns to the MCP surface after the bounded
  Workspace, Path, Pact, Proof, and Receipt lifecycle is the enforced boundary. No autonomous agent
  claim should be made until an agent can execute that lifecycle with verifiable limits.

An integration boundary, SDK helper, or capability declaration is not the same as live external
execution. These gates strengthen the surrounding infrastructure without changing the OpenRails
payment model.
