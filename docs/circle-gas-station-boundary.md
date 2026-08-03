# Circle Gas Station Boundary

Circle documents Arc Testnet as supporting Circle Wallet smart contract accounts and Gas Station
sponsorship. The documented Arc Testnet Gas Station contract address is
`0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25`. Circle's Wallets flow requires an SCA account for
EVM gasless contract execution.

OpenRails exposes this as an adaptable SDK boundary in
`sdk/src/circle-gas-station.ts`. The boundary accepts a Circle Wallet id, SCA address, Arc Testnet
chain, target contract, calldata, and value. It produces a Shared Interface external-wallet
handoff. It never receives a private key and it has no direct submit or broadcast method.

The host supplies two explicit facts:

1. `credentialsPresent` is true only when real Circle Console credentials are resolved outside the
   SDK.
2. `CircleGasStationRuntime.prepareContractCall` is an adapter to the official Circle Wallets API
   or SDK. The repository does not invent or hardcode a Circle request client.

Without both facts, the capability is `UNAVAILABLE`. With both facts, it is `DEMONSTRATION` until a
real Arc transaction, exact event evidence, and Vault reconciliation are recorded. The adapter
never reports live execution on the basis of configuration alone.

Circle Gas Station is separate from the existing OpenRails keeper relay. The keeper remains the
legacy fallback for application flows that already use it. Circle evidence can be bound to a
Shared Interface Receipt and Canonical Record settlement references. If evidence is appended after
typed record signatures, the record must be re-signed because the commitment changes.

References:

- [Circle Gas Station](https://developers.circle.com/wallets/gas-station)
- [Circle gasless transaction guide](https://developers.circle.com/wallets/gas-station/send-a-gasless-transaction)
- [Circle Gas Station contract addresses](https://developers.circle.com/wallets/gas-station/contract-addresses)
