# Implementation Specification: Navidrome & MusicBrainz OpenRails Sidecar (Arc Testnet Deployment)

This document specifies the technical implementation plan for building a native **OpenRails Webhook Sidecar** for Navidrome media servers by emulating the ListenBrainz API, combined with a **MusicBrainz Payee Registry** smart contract deployed on the public **Arc Testnet** (Chain ID: `5042002`).

---

## 1. Navidrome Integration Strategy

Navidrome includes native support for scrobbling to ListenBrainz. By utilizing the `ND_LISTENBRAINZ_BASEURL` environment variable, we redirect scrobble requests to our local OpenRails Sidecar.

### Navidrome Environment Configuration
When running Navidrome (e.g., via Docker Compose), configure these environment variables:

```yaml
services:
  navidrome:
    image: deluan/navidrome:latest
    ports:
      - "4533:4533"
    environment:
      ND_LISTENBRAINZ_ENABLED: "true"
      ND_LISTENBRAINZ_BASEURL: "http://host.docker.internal:3002/apis/listenbrainz/"
```

*Note: The user must still toggle "Scrobble to ListenBrainz" to **On** inside the Navidrome WebUI (Settings > Personal) and enter a mock API Token.*

---

## 2. API Endpoint Emulation (`POST /1/submit-listens`)

The sidecar acts as a mock ListenBrainz server. It must listen on port `3002` and handle incoming JSON payloads sent by Navidrome.

### Received Payload Schema
Navidrome will submit a `POST` request to `/apis/listenbrainz/1/submit-listens` with the following format:

```json
{
  "listen_type": "single",
  "payload": [
    {
      "listened_at": 1715432100,
      "track_metadata": {
        "artist_name": "Daft Punk",
        "track_name": "Get Lucky",
        "release_name": "Random Access Memories",
        "additional_info": {
          "artist_mbids": ["e12de7b9-ee26-47e1-884b-a7f4fa1dae68"],
          "recording_mbid": "fa21684c-35d2-430b-99d9-76811234bc5a"
        }
      }
    }
  ]
}
```

* **`listen_type: "playing_now"`**: Sent when a track starts playing. **Ignored** by the sidecar (no payment).
* **`listen_type: "single"`**: Sent when the track is successfully scrobbled (usually 50% played). **Processed** by the sidecar.

---

## 3. Smart Contract Design: `MusicBrainzRegistry.sol`

A lookup registry on the Arc Testnet mapping the MusicBrainz Artist ID (MBID) to the artist's payout address.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract MusicBrainzRegistry {
    address public owner;
    
    // Keccak256 hash of MBID string => EVM Wallet Address
    mapping(bytes32 => address) private _mbidToWallet;
    
    event ArtistWalletRegistered(string indexed mbid, bytes32 indexed mbidHash, address indexed wallet);

    modifier onlyOwner() {
        require(msg.sender == owner, "Registry: caller is not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function registerArtist(string calldata mbid, address wallet) external onlyOwner {
        require(wallet != address(0), "Registry: invalid wallet");
        bytes32 mbidHash = keccak256(abi.encodePacked(mbid));
        _mbidToWallet[mbidHash] = wallet;
        emit ArtistWalletRegistered(mbid, mbidHash, wallet);
    }

    function resolveArtist(string calldata mbid) external view returns (address) {
        bytes32 mbidHash = keccak256(abi.encodePacked(mbid));
        address wallet = _mbidToWallet[mbidHash];
        require(wallet != address(0), "Registry: artist not registered");
        return wallet;
    }
}
```

---

## 4. Sidecar Implementation Skeleton (TypeScript)

### A. Webhook Endpoint (`src/index.ts`)
```typescript
import express from 'express';
import { handleScrobble } from './payment';

const app = express();
app.use(express.json());

// Emulate the ListenBrainz submit endpoint
app.post('/apis/listenbrainz/1/submit-listens', async (req, res) => {
  const { listen_type, payload } = req.body;

  // We only charge on complete scrobbles ("single")
  if (listen_type === 'single' && payload && payload.length > 0) {
    const listenData = payload[0];
    const artistName = listenData.track_metadata.artist_name;
    const trackName = listenData.track_metadata.track_name;
    const mbid = listenData.track_metadata.additional_info?.artist_mbids?.[0];

    if (mbid) {
      console.log(`Processing scrobble: ${artistName} - ${trackName} (MBID: ${mbid})`);
      try {
        await handleScrobble(mbid, artistName, trackName);
      } catch (err) {
        console.error(`Payment failed for ${artistName}:`, err);
      }
    }
  }

  // Always return success to Navidrome so scrobbling queue doesn't block
  res.status(200).json({ status: 'ok' });
});

app.listen(3002, () => {
  console.log('OpenRails Subsonic Sidecar running on port 3002');
});
```

### B. Budget Cap Enforcement (`src/budget.ts`)
```typescript
import fs from 'fs';
import path from 'path';

interface DailyBudget {
  date: string;
  spent: number;
}

const BUDGET_FILE = path.join(__dirname, '../data/budget.json');
const DAILY_CAP_USDC = 0.50; // Max spent per 24 hours

export function checkAndUpdateBudget(paymentAmount: number): boolean {
  const today = new Date().toISOString().split('T')[0];
  let budget: DailyBudget = { date: today, spent: 0 };

  if (fs.existsSync(BUDGET_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
      if (parsed.date === today) {
        budget = parsed;
      }
    } catch (e) {
      console.error('Failed to parse budget file, resetting.');
    }
  }

  if (budget.spent + paymentAmount > DAILY_CAP_USDC) {
    console.warn(`[BUDGET EXCEEDED] Daily limit of ${DAILY_CAP_USDC} USDC reached. Current: ${budget.spent} USDC.`);
    return false;
  }

  budget.spent += paymentAmount;
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2));
  return true;
}
```

### C. Payment Orchestration (`src/payment.ts`)
```typescript
import { ethers } from 'ethers';
import { LeptonOpenRailsClient } from '../../sdk/src/client';
import { checkAndUpdateBudget } from './budget';

const PROVIDER_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io';
const PAYER_KEY = process.env.OPENRAILS_PAYER_PRIVATE_KEY!;
const HUB_ADDRESS = process.env.ARC_OPENRAILS_HUB_ADDRESS || '0x01EC54846524D043fD808152D41596beF603381d';
const REGISTRY_ADDRESS = process.env.MUSICBRAINZ_REGISTRY_ADDRESS!;
const LISTEN_PAYMENT_USDC = 0.001; // $0.001 per listen

const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const signer = new ethers.Wallet(PAYER_KEY, provider);

// OpenRails Client targeted directly at Arc Testnet (Chain ID: 5042002)
const client = new LeptonOpenRailsClient(PAYER_KEY, HUB_ADDRESS, 5042002);

const REGISTRY_ABI = [
  "function resolveArtist(string mbid) external view returns (address)"
];

async function resolveArtistWallet(mbid: string): Promise<string | null> {
  const contract = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
  try {
    return await contract.resolveArtist(mbid);
  } catch (err) {
    console.warn(`MBID ${mbid} not registered on-chain.`);
    return null;
  }
}

export async function handleScrobble(mbid: string, artist: string, track: string) {
  // 1. Check budget limits
  if (!checkAndUpdateBudget(LISTEN_PAYMENT_USDC)) {
    return;
  }

  // 2. Resolve artist payout address on Arc Testnet
  const recipientWallet = await resolveArtistWallet(mbid);
  if (!recipientWallet) {
    console.log(`Listen recorded for ${artist} but no payee registered.`);
    return;
  }

  console.log(`Directing ${LISTEN_PAYMENT_USDC} USDC to ${artist} (${recipientWallet})`);

  // 3. Trigger Instant OpenRails Payment (lifespanSeconds == 0)
  const paycardId = ethers.keccak256(ethers.toUtf8Bytes(`${mbid}-${Date.now()}`));
  const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
    version: 'openrails-metadata-v1',
    mode: 'railsflow',
    originator: signer.address,
    recipient: recipientWallet,
    amount: LISTEN_PAYMENT_USDC.toString(),
    trackName: track
  })));

  // Generate and sign the envelope
  const envelope = await client.signPermissionEnvelope(
    paycardId,
    metadataHash,
    recipientWallet,
    ethers.parseUnits(LISTEN_PAYMENT_USDC.toString(), 6), // 6 decimals for USDC
    0, // flowVelocityPerSecond (instant mode)
    0, // lifespanSeconds (instant mode)
    signer.address, // residualDeltaRecipient (recovery)
    {
      nonceChannel: 101, // Reserved Subsonic Lane
      nonceValue: 0      // In production, fetch next nonce from contract
    }
  );

  // Broadcast through Arc Testnet Relayer / Gateway
  const response = await fetch('http://localhost:3001/api/paycards/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope)
  });

  if (response.ok) {
    console.log(`Payment confirmed on Arc Testnet for: ${artist} - ${track}`);
  } else {
    throw new Error(`Gateway returned status: ${response.status}`);
  }
}
```

---

## 5. Arc Testnet Showcase & Verification Steps

### Step 1: Start Relayer Gateway Server in Arc Testnet Mode
Configure the server environment to point to the public Arc Testnet registry:
```bash
OPENRAILS_DASHBOARD_MODE=arc-testnet \
OPENRAILS_DEPLOYMENT_REGISTRY_PATH=deployments/openrails-addresses.local.json \
npm run server
```
*Expected: Gateway launches on port `3001` querying the verifying contract `0x01EC54846524D043fD808152D41596beF603381d` and token `0x3600000000000000000000000000000000000000` (USDC) on Arc Testnet.*

### Step 2: Deploy Registry to Arc Testnet
Deploy the registry contract using your deployer private key:
```bash
npx hardhat run scripts/deploy-registry.ts --network arcTestnet
```
*Keep track of the returned registry contract address.*

### Step 3: Register Artist
Register a test artist's MBID to a test wallet on the real registry:
```bash
npx hardhat run scripts/register-artist.ts --network arcTestnet
```
*(E.g. registers `e12de7b9-ee26-47e1-884b-a7f4fa1dae68` to your target artist wallet).*

### Step 4: Run the Sidecar Server
Launch the sidecar on port `3002` pre-loaded with your funded Arc Testnet test key:
```bash
ARC_RPC_URL=https://rpc.testnet.arc.io \
ARC_OPENRAILS_HUB_ADDRESS=0x01EC54846524D043fD808152D41596beF603381d \
MUSICBRAINZ_REGISTRY_ADDRESS=<your-deployed-registry-address> \
OPENRAILS_PAYER_PRIVATE_KEY=<your-funded-testnet-wallet-key> \
node dist/index.js
```

### Step 5: Trigger a Playback Scrobble
Simulate a Navidrome scrobble webhook delivery:
```bash
curl -X POST http://localhost:3002/apis/listenbrainz/1/submit-listens \
  -H "Content-Type: application/json" \
  -d '{
    "listen_type": "single",
    "payload": [
      {
        "track_metadata": {
          "artist_name": "Daft Punk",
          "track_name": "Get Lucky",
          "additional_info": {
            "artist_mbids": ["e12de7b9-ee26-47e1-884b-a7f4fa1dae68"]
          }
        }
      }
    ]
  }'
```

### Expected Output
```
Processing scrobble: Daft Punk - Get Lucky (MBID: e12de7b9-ee26-47e1-884b-a7f4fa1dae68)
Directing 0.001 USDC to Daft Punk (0x70997970C51812dc3A010C7d01b50e0d17dc79C8)
Payment confirmed on Arc Testnet for: Daft Punk - Get Lucky
```
*(Verify the transaction on the ArcScan explorer).*
