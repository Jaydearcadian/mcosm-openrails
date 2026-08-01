# Implementation Plan: Subsonic Scrobble Sidecar & MusicBrainz Payee Registry

This document outlines the implementation plan for deploying the MusicBrainz Payee Registry and the Subsonic Scrobble Sidecar to enable automated, listener-to-artist streaming royalties.

---

## 1. Smart Contract Design: `MusicBrainzRegistry.sol`

A lightweight directory contract deployed to the Arc Network that maps MusicBrainz Artist IDs (MBIDs) to recipient payout addresses.

### Contract Code Structure
Place this in `contracts/MusicBrainzRegistry.sol`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract MusicBrainzRegistry {
    // Owner of the registry (can update mappings or delegate to validators)
    address public owner;
    
    // Mapping: Keccak256 hash of MBID string => EVM Wallet Address
    mapping(bytes32 => address) private _mbidToWallet;
    // Reverse mapping: wallet => MBID string representation
    mapping(address => string) private _walletToMbid;

    event ArtistWalletRegistered(string indexed mbid, bytes32 indexed mbidHash, address indexed wallet);
    event ArtistWalletRevoked(string indexed mbid, bytes32 indexed mbidHash, address indexed wallet);

    modifier onlyOwner() {
        require(msg.sender == owner, "Registry: caller is not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Registers or updates the wallet destination for a given MusicBrainz ID.
     */
    function registerArtist(string calldata mbid, address wallet) external {
        // In production, require signature authorization from the artist, or restrict to owner
        require(msg.sender == owner || msg.sender == wallet, "Registry: unauthorized");
        require(wallet != address(0), "Registry: invalid wallet");
        
        bytes32 mbidHash = keccak256(abi.encodePacked(mbid));
        _mbidToWallet[mbidHash] = wallet;
        _walletToMbid[wallet] = mbid;

        emit ArtistWalletRegistered(mbid, mbidHash, wallet);
    }

    /**
     * @notice Resolves the recipient wallet address for a given MBID string.
     */
    function resolveArtist(string calldata mbid) external view returns (address) {
        bytes32 mbidHash = keccak256(abi.encodePacked(mbid));
        address wallet = _mbidToWallet[mbidHash];
        require(wallet != address(0), "Registry: artist not registered");
        return wallet;
    }
    
    /**
     * @notice Reverse lookup for checking registered artist ID.
     */
    function getArtistMbid(address wallet) external view returns (string memory) {
        return _walletToMbid[wallet];
    }
}
```

---

## 2. Off-Chain Sidecar Architecture

The **Subsonic Scrobble Sidecar** is a lightweight daemon that sits alongside a Subsonic-compatible server (e.g. Navidrome, Feishin, Koel, or Gonic).

```
┌───────────────────┐               ┌────────────────────────┐               ┌─────────────────────────┐
│  Subsonic Server  │ ──(Scrobble)─►│    Scrobble Sidecar    │ ──(Lookup)───►│  MusicBrainz Registry   │
│ (Navidrome/Gonic) │               │   (Daemon Listener)    │ ◄──(Wallet)───│   (Smart Contract)      │
└───────────────────┘               └───────────┬────────────┘               └─────────────────────────┘
                                                │
                                                ▼ (Drip / Instant Settle)
                                    [ ArcOpenRailsHubV1 ]
                                    - Escrow stream opened 
                                    - Settled per scrobble
```

### Components

#### 1. Event Listener (Scrobble Hook)
* Listens to the `/api/scrobbles` event queue or acts as a proxy intercepting standard Subsonic API `scrobble` requests (which clients submit when 50% of a track has played).
* Parses metadata out of the scrobble payload: `artist_mbid`, `track_mbid`, `artist_name`, `track_name`.

#### 2. Resolution Worker
* Checks if `artist_mbid` has a registered wallet via the on-chain `MusicBrainzRegistry`.
* Falls back to a local database/cache for mapping. If no wallet is registered, payments are accumulated in an "unclaimed pending pool" linked to the MBID.

#### 3. Payment Handler (OpenRails SDK Integration)
* Uses the `LeptonOpenRailsClient` to sign or relay settlement intents.
* **Payment Mode**: Can use **Instant Settlement Mode** (`lifespanSeconds == 0`) to pay a fixed micro-amount (e.g. 0.001 USDC) immediately upon scrobble confirmation.
* **Nonce Lane Isolation**: Reserves a dedicated lane (e.g., `nonceChannel = 101`) to isolate music streaming transactions from standard API/dashboard payments.

---

## 3. Spending Caps & Balance Protection

To prevent a listener's wallet from being drained in case of server bugs, loops, or malicious activity, the sidecar enforces three security gates:

1. **Per-Song Cap**: A maximum payment limit per scrobble (e.g., capped at `0.005 USDC`).
2. **Daily Spending Limit**: A local database tracks the cumulative sum of payments signed within the last 24 hours. Once the threshold (e.g., `1.00 USDC/day`) is breached, the sidecar enters a circuit-breaker state and ceases automated payments.
3. **Payer-Defined Expiration**: Opened paycard channels use short `lifespanSeconds` settings (e.g. 1 hour) to ensure any unused allocation sweeps back to the payer's wallet quickly.

---

## 4. Configuration Schema

The sidecar runs with the following environment variables:

```bash
# Subsonic Credentials
SUBSONIC_SERVER_URL=http://localhost:4533
SUBSONIC_USER=listener
SUBSONIC_PASS_HEX=3d2f9b8c...

# OpenRails Web3 Registry
ARC_RPC_URL=https://rpc.testnet.arc.io
OPENRAILS_HUB_ADDRESS=0x01EC54846524D043fD808152D41596beF603381d
MUSICBRAINZ_REGISTRY_ADDRESS=0x...
OPENRAILS_PAYER_PRIVATE_KEY=0x...

# Spending Constraints
PAYMENT_PER_LISTEN_USDC=0.001
DAILY_MAX_USDC_CAP=0.50
SUBSONIC_NONCE_LANE=101
```

---

## 5. Verification Plan

### Stage 1: Unit & Integration Tests
* Write Mock Subsonic API requests containing valid and invalid MBID payloads.
* Test that `MusicBrainzRegistry.sol` successfully associates and resolves MBIDs to addresses.
* Test that the sidecar rejects payment calls when the daily cap is exceeded.

### Stage 2: Sandbox Dry-Run
1. Start local Hardhat node and deploy `MusicBrainzRegistry`.
2. Register a mock artist wallet for MBID `83d91836-ad2d-4568-a73c-7e6189e4b7b2`.
3. Spin up the sidecar daemon.
4. Send a simulated scrobble request via curl.
5. Verify on-chain that the Vault receives the escrow and processes the payout.
