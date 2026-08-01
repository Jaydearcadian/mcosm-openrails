# Developer Guide: Extensibility & Programmatic Possibilities in OpenRails

This document maps out the architectural primitives, underutilized hooks, and extensibility points within the OpenRails codebase. It outlines how external developers can leverage these structures to build custom payment applications, developer tools, and DeFi integrations.

---

## 1. The Core Extension Interfaces (The Codebase Matrix)

```
                            [ OPENRAILS CODEBASE ]
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
  1. WORKFLOW NFTs             2. PAYMENT RECEIPTS         3. PROXY FACTORIES
  (DeFi Stream Trading)       (Offline Auth Gates)       (Sovereign Media Hubs)
```

The codebase is structured around three highly reusable, modular layers:

| Layer / File | Primitive | Extensibility Opportunity |
| :--- | :--- | :--- |
| **[WorkflowNFT.sol](file:///home/jay/codex/lepton/contracts/v2-factory/WorkflowNFT.sol)** | ERC-721 Token | Trade, collateralize, or transfer rights to future payment streams. |
| **[receipts.ts](file:///home/jay/codex/lepton/sdk/src/receipts.ts)** | Cryptographic Proofs | Build offline gatekeepers (paywalls) verified by wallet signatures. |
| **[ArcOpenRailsFactoryV1.sol](file:///home/jay/codex/lepton/contracts/v2-factory/ArcOpenRailsFactoryV1.sol)** | Minimal Proxy Clones | Let companies deploy isolated vault instances in one transaction. |

---

## 2. On-Chain Extensibility: Streaming DeFi (Workflow NFTs)

An underutilized primitive in the codebase is the **`WorkflowNFT.sol`** contract. When a user opens a payment stream, the vault can mint an ERC-721 token representing that stream's payout rights.

### The Possibility: Stream Financialization
Because stream ownership is mapped to a standard ERC-721 NFT, developers can build:
* **Collateralized Streaming Loans**: An artist or service provider can lock up their "Active Payout NFT" (which has a guaranteed inflow of USDC/second) as collateral to borrow immediate liquidity.
* **Secondary Market Subscriptions**: Users can sell or transfer their active subscription streams to other addresses, creating a tradeable license market.
* **Payout Redirection**: By calling the contract's `redirectPayout()` function, developers can dynamically re-route stream destinations without having to cancel, reopen, or re-sign the original envelope.

---

## 3. Off-Chain Extensibility: Gateways & Auth (Receipt Proofs)

The SDK implements structured receipt generation in **`receipts.ts`** and metadata hashing in **`metadata.ts`**. 

### The Possibility: Cryptographic Auth Gates (Paywalls)
Developers can use OpenRails' off-chain receipts to build **decentralized gatekeepers** for premium web content or APIs.

```
[ User Wallet ] ──(Presents Signed Receipt)──► [ Web Gateway API ] ──(Validates)──► [ Access Granted ]
```

* **How to build it**:
  1. The client signs a payment intent and gets a cryptographic receipt containing a `metadataHash` representing a specific resource.
  2. The client submits this receipt in their HTTP headers when querying a server:
     `Authorization: OpenRails <receipt_signature>`
  3. The target server imports the OpenRails SDK and calls `verifyReceipt(receipt)` offline. 
  4. If valid, access is granted instantly-**requiring zero database checks or on-chain reads on the gateway server**, achieving sub-millisecond verification latency.

---

## 4. Middleware Extensibility: Web2 Daemon Hooks (Sidecars)

Our sidecar daemon model (currently emulating the ListenBrainz scrobbling webhook API) demonstrates how to monetize legacy software without modifying its internal codebase.

### The Possibility: The Universal Webhook Translator
Developers can clone our daemon architecture to bridge *any* webhook-capable Web2 application into a real-time Web3 micro-payment terminal:
* **GitHub Actions Billing**: Charge developer teams per second of continuous integration (CI) run-time.
* **Serverless Compute Tolls**: Let serverless functions ping the sidecar to pay for execution time dynamically.
* **Plex/Jellyfin Private Shares**: Intercept media stream progress webhooks to execute micro-metered tip drops.

---

## 5. How to Get Started: Integration Template

Here is a boilerplate template showing how an external developer imports the OpenRails SDK [client.ts](file:///home/jay/codex/lepton/sdk/src/client.ts) to establish a custom payment stream:

```typescript
import { LeptonOpenRailsClient } from 'openrails-sdk';
import { ethers } from 'ethers';

async function setupCustomStream() {
  const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.io");
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  
  // Initialize the OpenRails client targeting the Arc Hub
  const client = new LeptonOpenRailsClient(
    wallet,
    "0x01EC54846524D043fD808152D41596beF603381d" // Arc OpenRails Hub V1
  );

  console.log("Opening custom utility payment stream...");

  // Generate and sign payment intent
  const intent = await client.preparePaymentIntent({
    recipient: "0xRecipientAddress...",
    amount: ethers.parseUnits("5.00", 6), // $5.00 USDC budget cap
    velocity: 500,                       // 0.0005 USDC per second
    lifespan: 3600                       // 1 hour stream window
  });

  // Submit to the Relayer Gateway gaslessly
  const response = await fetch("https://gateway.openrails.net/api/paycards/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent)
  });

  const { paycardId } = await response.json();
  console.log(`Stream established! Paycard ID: ${paycardId}`);
}
```
