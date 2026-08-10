# Arc Workspace Settlement Evidence

**Observed:** 2026-08-09
**Network:** Arc Testnet, chain ID `5042002`
**Scope:** local bounded Workspace control-plane transitions followed by live OpenRails V2 settlement

## Result

The proof harness completed one bounded Workspace-to-settlement lifecycle:

1. The owner registered a Workspace and two Actors.
2. The application authenticated a Path with bounded action, amount, velocity, lifespan, transaction-count, expiry, network, and anchor limits.
3. A delegated Actor submitted a Proposal and committed the matching Pact through signed Runtime transitions.
4. The owner wallet approved the exact allocation, signed the chain-bound SettlementIntent, and submitted the financial operations.
5. The Arc V2 Hub opened, settled, and flushed the Paycard Stream.
6. The final Vault row reported zero available balance and operational status `1`.

The Runtime did not hold a private key, sign for the owner, submit a transaction, or move value. The owner wallet remained the financial signer.

## Identifiers

| Object | Value |
| --- | --- |
| Workspace | `workspace:arc-proof:msm9xiw2` |
| Path | `path:arc-proof:msm9xiw2` |
| Intent | `intent:arc-proof:msm9xiw2` |
| Proposal | `proposal:arc-proof:msm9xiw2` |
| Pact | `pact:arc-proof:msm9xiw2` |
| Paycard | `0xfd62e292ef61784e346e1aab9103e6885a8801f575dc4f46b632f1ce1b0a0cd3` |

## Arc Receipts

| Operation | Transaction |
| --- | --- |
| Open | `0xcd459e82fac5fe20ad7aab2dbd1002d31f8ef719fcb2f49ff17109f963afedce` |
| Settle | `0xbf7d82b3e9ae8f5a240f0128b8cd8c910d7bbe46cbb662784bc93d4cbbddc918` |
| Flush | `0x41ff26d0eb9a8b542134fa9ee442f3c66757bd299549cb3c75c1ab7c729ffb34` |

All three receipts succeeded. This is Arc Testnet evidence only. It does not prove public Runtime deployment, Circle sponsorship, production security, or mainnet readiness.
