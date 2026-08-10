# Circle Gas Station Boundary

Circle documents Arc Testnet as supporting Circle Wallet smart contract accounts and Gas Station
sponsorship. The documented Arc Testnet Gas Station contract address is
`0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25`. Circle's Wallets flow requires an SCA account for
EVM gasless contract execution.

OpenRails exposes the prepared handoff boundary in `sdk/src/circle-gas-station.ts`. The boundary
accepts a Circle Wallet id, SCA address, Arc Testnet chain, target contract, calldata, and value.
It produces a Shared Interface external-wallet handoff. It never receives a private key and it has
no direct submit or broadcast method.

The Cockpit now also contains one optional official Modular Wallet path in
`cockpit/src/lib/circleModularWallet.tsx`. It uses the browser-safe Circle client key and client URL
with `toPasskeyTransport`, `toWebAuthnCredential`, `toWebAuthnAccount`, `toCircleSmartAccount`,
and a modular transport for Arc Testnet. The Privy and ordinary wagmi path remains unchanged.

That path is intentionally narrower than the generic handoff adapter. It creates or logs in to a
user-controlled passkey, prepares one RailsFlow `SettlementIntent`, submits an exact USDC
`approve(hub, amount)` plus `openPaycardChannel` batch through `sendUserOperation` with
`paymaster: true`, then waits for `waitForUserOperationReceipt`. It only reports confirmation after
the exact transaction receipt is successful, the expected `PaycardProvisioned` event matches, and
the live Hub registry row matches the Circle smart-account payer and every settlement term.

The host supplies two explicit facts:

1. `credentialsPresent` is true only when real Circle Console credentials are resolved outside the
   SDK.
2. `CircleGasStationRuntime.prepareContractCall` is an adapter to the official Circle Wallets API
   or SDK. The repository does not invent or hardcode a Circle request client.

Without both facts, the capability is `UNAVAILABLE`. With both facts, it is `DEMONSTRATION` until a
real Arc transaction, exact event evidence, and Vault reconciliation are recorded. The adapter
never reports live execution on the basis of configuration alone.

The browser Modular Wallet path is also configuration-gated. `VITE_CIRCLE_CLIENT_KEY` and
`VITE_CIRCLE_CLIENT_URL` are public Circle browser configuration only. API keys, entity secrets,
private keys, mnemonics, and signing credentials are not accepted by the Cockpit, tests, or docs.
The live proof remains unproven until a user completes a real passkey ceremony with Circle Console
configuration and the exact receipt and Vault checks pass.

The legacy server-side Circle placeholders in `server/circle.ts` fail closed and are not an
execution path.

Circle Gas Station is separate from the existing OpenRails keeper relay. The keeper remains the
legacy fallback for application flows that already use it. Circle evidence can be bound to a
Shared Interface Receipt and Canonical Record settlement references. If evidence is appended after
typed record signatures, the record must be re-signed because the commitment changes.

References:

- [Circle Modular Wallet create flow](https://developers.circle.com/wallets/modular/create-a-modular-wallet)
- [Circle Modular Wallet transfer and sponsorship flow](https://developers.circle.com/wallets/modular/transfer-tokens)
- [Circle Modular Wallet Console setup](https://developers.circle.com/wallets/modular/console-setup)
- [Circle supported blockchains](https://developers.circle.com/wallets/supported-blockchains)
- [Circle Gas Station contract addresses](https://developers.circle.com/wallets/gas-station/contract-addresses)
