import { ethers } from "ethers";
import { createArcProvider, safeRpcError } from "../../shared/rpc";

const HUB_ABI = [
  "function openPaycardChannel(bytes32 paycardId, bytes32 metadataHash, address recipient, uint256 totalAllocationPool, uint256 flowVelocityPerSecond, uint256 genesisTimestamp, uint256 lifespanSeconds, address residualDeltaRecipient, bytes envelopeSignature, uint256 nonceChannel, uint256 nonceValue, address payer) external",
  "function accountNonceTracks(address account, uint256 channel) external view returns (uint256)"
] as const;

export interface OpenSessionParams {
  hubAddress: string;
  rpcUrl: string;
  canteenRpcUrl?: string;
  fallbackRpcUrl?: string;
  chainId?: number;
  relayerPrivateKey: string; // The sidecar's own key for gas
  listenerAddress: string;
  artistWallet: string;
  budgetUsdcBaseUnits: bigint;
  velocityPerSecond: bigint;
  lifespanSeconds: bigint;
  // Optional envelope token representing the listener's non-custodial signature
  envelopeToken?: string;
}

const OPENRAILS_EIP712_TYPES = {
  SettlementIntent: [
    { name: "paycardId", type: "bytes32" },
    { name: "metadataHash", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "totalAllocationPool", type: "uint256" },
    { name: "flowVelocityPerSecond", type: "uint256" },
    { name: "genesisTimestamp", type: "uint256" },
    { name: "lifespanSeconds", type: "uint256" },
    { name: "residualDeltaRecipient", type: "address" },
    { name: "nonceChannel", type: "uint256" },
    { name: "nonceValue", type: "uint256" },
  ],
};

function decodeEnvelope(token: string) {
  let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  b64 += "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

export async function openListeningSession(params: OpenSessionParams) {
  const provider = createArcProvider({
    ARC_CANTEEN_RPC_URL: params.canteenRpcUrl,
    ARC_RPC_URL: params.rpcUrl,
    ARC_RPC_FALLBACK_URL: params.fallbackRpcUrl,
    ARC_CHAIN_ID: params.chainId?.toString(),
  });
  const relayerWallet = new ethers.Wallet(params.relayerPrivateKey, provider);
  const hub = new ethers.Contract(params.hubAddress, HUB_ABI, relayerWallet);

  let paycardId: string;
  let metadataHash: string;
  let genesisTimestamp: bigint;
  let envelopeSignature: string;
  let nonceChannel: bigint;
  let nonceValue: bigint;
  let payer: string;
  let recipient: string;
  let totalAllocationPool: bigint;
  let flowVelocityPerSecond: bigint;
  let lifespanSeconds: bigint;
  let residualDeltaRecipient: string;

  if (params.envelopeToken) {
    // -------------------------------------------------------------------------
    // Path (b): Non-Custodial Signature Strategy (Production Ready)
    // -------------------------------------------------------------------------
    // Decode the client/listener pre-signed envelope
    const envelope = decodeEnvelope(params.envelopeToken);
    const intent = envelope.intent;

    if (!intent || !envelope.envelopeSignature || !envelope.payerAddress) {
      throw new Error("Invalid cryptographic envelope: missing intent, signature, or payerAddress");
    }

    payer = ethers.getAddress(envelope.payerAddress);
    recipient = ethers.getAddress(intent.recipient);
    totalAllocationPool = BigInt(intent.totalAllocationPool);
    flowVelocityPerSecond = BigInt(intent.flowVelocityPerSecond);
    genesisTimestamp = BigInt(intent.genesisTimestamp);
    lifespanSeconds = BigInt(intent.lifespanSeconds);
    residualDeltaRecipient = ethers.getAddress(intent.residualDeltaRecipient);
    nonceChannel = BigInt(intent.nonceChannel);
    nonceValue = BigInt(intent.nonceValue);
    envelopeSignature = envelope.envelopeSignature;
    paycardId = intent.paycardId;
    metadataHash = intent.metadataHash;

    // Security Verifications:
    // 1. Recover the signer address from the typed data signature to verify authenticity
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const domain = {
      name: "OpenRails Network",
      version: "2.0.0",
      chainId,
      verifyingContract: params.hubAddress,
    };

    // Construct exactly matching intent values for signature verification
    const verificationIntent = {
      paycardId: intent.paycardId,
      metadataHash: intent.metadataHash,
      recipient: intent.recipient,
      totalAllocationPool: intent.totalAllocationPool.toString(),
      flowVelocityPerSecond: intent.flowVelocityPerSecond.toString(),
      genesisTimestamp: Number(intent.genesisTimestamp),
      lifespanSeconds: Number(intent.lifespanSeconds),
      residualDeltaRecipient: intent.residualDeltaRecipient,
      nonceChannel: Number(intent.nonceChannel),
      nonceValue: Number(intent.nonceValue),
    };

    const recoveredSigner = ethers.verifyTypedData(domain, OPENRAILS_EIP712_TYPES, verificationIntent, envelopeSignature);
    if (recoveredSigner.toLowerCase() !== payer.toLowerCase()) {
      throw new Error(`Signature verification failed: recovered ${recoveredSigner} does not match payer ${payer}`);
    }

    // 2. Validate listener address matches payer
    if (payer.toLowerCase() !== params.listenerAddress.toLowerCase()) {
      throw new Error(`Listener address mismatch: envelope payer ${payer} does not match request listener ${params.listenerAddress}`);
    }

    // 3. Validate recipient matches the registered artist wallet
    if (recipient.toLowerCase() !== params.artistWallet.toLowerCase()) {
      throw new Error(`Artist wallet mismatch: envelope recipient ${recipient} does not match registered artist wallet ${params.artistWallet}`);
    }

    // 4. Validate budget parameters
    if (totalAllocationPool !== params.budgetUsdcBaseUnits) {
      throw new Error(`Budget mismatch: envelope pool ${totalAllocationPool} does not match requested budget ${params.budgetUsdcBaseUnits}`);
    }

    console.log(`[openSession] Validated non-custodial envelope signature for listener ${payer}`);
  } else {
    // -------------------------------------------------------------------------
    // Path (a): Relayer Self-Funded Fallback Strategy (Demo Simplification)
    // -------------------------------------------------------------------------
    // In this mode, the relayer itself signs as the payer, acting as a self-funded
    // budget for the demo listener session.
    console.warn("[openSession] WARNING: Using self-funded relayer fallback (demo-only simplification). " +
      "Production deployment requires client-signed envelopeToken to ensure non-custodial invariants.");

    payer = relayerWallet.address;
    recipient = ethers.getAddress(params.artistWallet);
    totalAllocationPool = params.budgetUsdcBaseUnits;
    flowVelocityPerSecond = params.velocityPerSecond;
    genesisTimestamp = BigInt(Math.floor(Date.now() / 1000));
    lifespanSeconds = params.lifespanSeconds;
    residualDeltaRecipient = relayerWallet.address;
    nonceChannel = 0n; // Default channel

    // Query next expected nonce from the Hub contract for the relayer (payer)
    nonceValue = await hub.accountNonceTracks(payer, nonceChannel);

    // Build the metadata hash
    const rawMetadata = {
      version: "openrails-metadata-v1",
      mode: "railsflow",
      originator: payer,
      recipient,
      token: "0x3600000000000000000000000000000000000000",
      amount: totalAllocationPool.toString(),
      flowVelocityPerSecond: flowVelocityPerSecond.toString(),
      lifespanSeconds: Number(lifespanSeconds),
      metadataRef: "openrails-scrobble-sidecar-demo",
    };
    const metadataJson = JSON.stringify(rawMetadata);
    metadataHash = ethers.keccak256(ethers.toUtf8Bytes(metadataJson));

    // Construct the metadata-bound paycardId
    paycardId = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256", "bytes32"],
      [payer, nonceChannel, nonceValue, metadataHash]
    );

    // Build intent for Relayer (payer) signature
    const intent = {
      paycardId,
      metadataHash,
      recipient,
      totalAllocationPool: totalAllocationPool.toString(),
      flowVelocityPerSecond: flowVelocityPerSecond.toString(),
      genesisTimestamp: Number(genesisTimestamp),
      lifespanSeconds: Number(lifespanSeconds),
      residualDeltaRecipient,
      nonceChannel: Number(nonceChannel),
      nonceValue: Number(nonceValue),
    };

    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const domain = {
      name: "OpenRails Network",
      version: "2.0.0",
      chainId,
      verifyingContract: params.hubAddress,
    };

    envelopeSignature = await relayerWallet.signTypedData(domain, OPENRAILS_EIP712_TYPES, intent);
    console.log(`[openSession] Self-signed demo envelope as payer ${payer}`);
  }

  // ---------------------------------------------------------------------------
  // Relay Open to Clearinghouse
  // ---------------------------------------------------------------------------
  const args = [
    paycardId,
    metadataHash,
    recipient,
    totalAllocationPool,
    flowVelocityPerSecond,
    genesisTimestamp,
    lifespanSeconds,
    residualDeltaRecipient,
    envelopeSignature,
    nonceChannel,
    nonceValue,
    payer,
  ];

  try {
    // Perform dry-run on-chain precheck to catch revert reasons before submitting transaction
    await hub.openPaycardChannel.staticCall(...args);
  } catch (err) {
    throw new Error(`On-chain precheck failed for openPaycardChannel: ${safeRpcError(err)}`);
  }

  const tx = await hub.openPaycardChannel(...args);
  await tx.wait();

  return {
    paycardId,
    vaultAddress: params.hubAddress,
    txHash: tx.hash,
    mode: params.envelopeToken ? "non-custodial" : "self-funded-fallback"
  };
}
