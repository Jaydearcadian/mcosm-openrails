# Circle Gateway live Arc proof

Date: 2026-08-12

This is a same-chain Arc Testnet proof of the Circle Gateway API, Gateway Minter,
and Gateway Wallet reconciliation path. It is not a cross-chain proof.

## Evidence

- Network: Arc Testnet, chain ID `5042002`
- Gateway domain: `26`
- Depositor and recipient: `0x1A76BFE6bF7A4BfD854b16C19Dd870e0DE56473C`
- Gateway Wallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- Gateway Minter: `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`
- USDC: `0x3600000000000000000000000000000000000000`
- Transfer amount: `0.001000 USDC` (`1000` base units)
- Transfer-spec hash: `0xe2d6e3e6284d980909e217cfcc1b43b9fe775804454a6a027e9de2ce8f223d98`
- Gateway Minter transaction: `0xb48fda46920399dbee4717ee6ef21e410ed2858bc681e7c2caf98276a57a0c9f`
- Gateway Minter block: `0x3600180`
- Gateway Minter receipt: successful (`status 0x1`)
- Minter event: `AttestationUsed`, value `1000`, source domain `26`, recipient and source signer match the depositor
- Transfer-spec replay guard: `isTransferSpecHashUsed(hash)` returned `true`
- Gateway Wallet burn transaction: `0xa63ac1aa9f04d1d4b6ca92f9082315c98a9598a5ccb8ba6df746cba4f4be204`
- Gateway Wallet event: `GatewayBurned`, value `1000`, fee `3500`, from available `4500`
- Circle Gateway API balance after reconciliation: `0.085500 USDC`, `pendingBatch: 0`

The prior Circle Gateway API balance was `0.090000 USDC`. The resulting decrease
of `0.004500 USDC` is the `0.001000 USDC` same-chain transfer plus the `0.003500
USDC` Gateway fee recorded by `GatewayBurned`.

## Boundary

This proves Gateway attestation use, Arc minting, delayed source burn, and
reconciliation of the shared transfer-spec hash. It does not prove a source-chain
deposit from another network. The next Gateway evidence gate is a funded second
supported testnet source and a destination Arc mint with the same reconciliation
checks.
