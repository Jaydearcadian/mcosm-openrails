# OpenRails V1: Circle CLI Discovery & Integration

This document logs the confirmation, version details, and command specs of the globally installed **Circle CLI** tool (referred to as the Canteen Arc CLI) for verification and testing on the Arc Network.

> [!NOTE]
> Planning and analysis note. Confirm current implementation before treating any item as shipped.

---

## 1. Executable Details & Status

We verified the installation and successfully queried the CLI tool:
* **Command Name:** `circle`
* **Global Executable Path:** `/home/jay/.nvm/versions/node/v22.22.2/bin/circle`
* **Installed Version:** `0.0.3`
* **Status:** Verified and responding to queries.

---

## 2. Supported Blockchain Networks

Running `circle blockchain list` returns the following EVM chain configurations, including the primary deployment target for OpenRails:

* **Target Network:** `ARC-TESTNET` (Arc Testnet)
* **EVM Chain ID:** `5042002`
* **Public RPC Endpoint:** `https://rpc.testnet.arc.io`

Other supported networks include Ethereum, Polygon (Amoy), Arbitrum (Sepolia), Avalanche (Fuji), Optimism (Sepolia), Base (Sepolia), Unichain (Sepolia), and Monad Testnet.

---

## 3. Key Integration Commands for OpenRails

The `circle` CLI provides native commands for stablecoin-native development, CCTP bridging, and x402 API payments that can be used next to OpenRails:

### A. Wallet Management & Faucet Funding
* **Fund Testnet Address:** Fund a wallet with gas/tokens on testnet:
  ```bash
  circle wallet fund --blockchain ARC-TESTNET --address <wallet_address>
  ```
* **Read Balances:** Show token balances (including USDC native gas balances on Arc):
  ```bash
  circle wallet balance --blockchain ARC-TESTNET --address <wallet_address>
  ```

### B. Gateway Nanopayments (x402 Integration)
* **Read Gateway Balance:** Query the active Circle Gateway nanopayments balance:
  ```bash
  circle gateway balance
  ```
* **Deposit stablecoins:** Deposit USDC into the gateway pool to fund micro-settlements:
  ```bash
  circle gateway deposit --amount <amount_in_usdc>
  ```

### C. Direct Smart Contract Query
* **Read-only Contract Calls:** Query smart contracts (such as checking nonce lanes on `ArcOpenRailsHubV1` directly via RPC):
  ```bash
  circle contract query --blockchain ARC-TESTNET --address <hub_address> --method "accountNonceTracks" --args '["<payer_address>", 0]'
  ```
