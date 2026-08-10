import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { hashSettlementIntent } from "../sdk/src/client";
import { CanonicalMetadataV1, hashOpenRailsMetadata } from "../sdk/src/metadata";
import { buildIntentProof, buildTransactionProof } from "../sdk/src/proof";
import { recoverPaycardsFromLogs } from "../sdk/src/wallet";
import {
  PersistentStreamReader,
  type StreamQueryFilter,
  type PaycardStatus,
} from "../stream-gateway/state-store";
import { createRateLimiter } from "./rate-limiter";
import {
  validateOpenPaycardRequest,
  validateOpenRailsAccessRequest,
} from "./validation";
import { registerSharedInterfaceRoutes } from "./shared-interface";
import { createArcProvider } from "../workers/shared/rpc";

const { createGatewayMiddleware } = require("@circle-fin/x402-batching/server") as {
  createGatewayMiddleware: (config: {
    sellerAddress: string;
    facilitatorUrl: string;
    networks: string[];
  }) => {
    require: (price: string) => express.RequestHandler;
  };
};

export const app = express();
app.use(cors());
app.use(express.json());
registerSharedInterfaceRoutes(app);

const PORT = process.env.PORT || 3001;
const PROVIDER_URL = process.env.PROVIDER_URL || "http://127.0.0.1:8545";
const DASHBOARD_MODE = process.env.OPENRAILS_DASHBOARD_MODE || "local";
const SERVICE_ORIGIN = `http://localhost:${PORT}`;
const PROTECTED_SCOPE = "GET /api/demo/protected-resource";
const X402_OPENRAILS_SCOPE = "GET /api/x402/openrails-artifact";
const X402_PRICE = process.env.OPENRAILS_X402_PRICE || "$0.01";
const X402_FACILITATOR_URL = process.env.OPENRAILS_X402_FACILITATOR_URL || "https://gateway-api-testnet.circle.com";
const X402_NETWORK = "eip155:5042002";
const X402_SELLER_ADDRESS =
  process.env.OPENRAILS_X402_SELLER_ADDRESS || "0x933a2405f84c224be1ef373ba16e992e1f459682";
const PAYCARD_RECOVERY_DEFAULT_LOOKBACK_BLOCKS = 50_000;
const PAYCARD_RECOVERY_MAX_BLOCK_SPAN = 250_000;
const PAYCARD_RECOVERY_CHUNK_SIZE = 5_000;
const PAYCARD_RECOVERY_MAX_LIMIT = 50;
const ARC_PUBLIC_RELAYER_ENABLED =
  DASHBOARD_MODE === "arc-testnet" && process.env.OPENRAILS_ENABLE_ARC_PUBLIC_RELAYER === "true";
const ARC_PUBLIC_RELAYER_MAX_ALLOCATION_USDC =
  process.env.OPENRAILS_PUBLIC_RELAYER_MAX_ALLOCATION_USDC || "1";
const ARC_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS = Number(
  process.env.OPENRAILS_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS || "3600",
);
const ARC_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND =
  process.env.OPENRAILS_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND || "0.1";

// Durable stream history projection. The stream-gateway writes these files; the
// server reads them (read-only) to serve non-authoritative history endpoints.
// The Vault remains the authoritative source of truth for funds.
const STREAM_STORE_DIR =
  process.env.OPENRAILS_STREAM_STORE_DIR || path.join(__dirname, "..", ".openrails-stream");
const streamReader = new PersistentStreamReader(STREAM_STORE_DIR);
const STREAM_HISTORY_DISCLAIMER =
  "Non-authoritative projection from the stream gateway. The onchain Vault is the source of truth.";

type X402PaidRequest = Request & {
  payment?: {
    verified?: boolean;
    payer: string;
    amount: string;
    network: string;
    transaction?: string;
  };
};

/**
 * Gas-fee buffer multiplier applied when estimating gas for sponsored
 * transactions.  Ethers handles the actual estimation — this constant is
 * referenced by the MempoolRejectionListener retry logic documentation.
 */
const GAS_FEE_BUFFER_MULTIPLIER = 1.15;

// Globals to store contract instances and addresses
let provider: ethers.AbstractProvider;
let relayerWallet: ethers.Signer | undefined;
let clearinghouseContract: any;
let usdcContract: any;

let clearinghouseAddress = "";
let usdcAddress = "";
let explorerBaseUrl = "";
let relayerAddress = "";
let chainId = 31337;

const READ_ONLY_ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const LOCAL_CAPABILITIES = {
  canRelayOpen: true,
  canMint: true,
  canTimeTravel: true,
  canAutoDrip: true,
  canDemoFlush: true,
  canGatewaySettle: true,
  canUsePrivateKeySigning: true,
};

const ARC_READ_ONLY_CAPABILITIES = {
  canRelayOpen: false,
  canMint: false,
  canTimeTravel: false,
  canAutoDrip: false,
  canDemoFlush: false,
  canGatewaySettle: false,
  canUsePrivateKeySigning: false,
};

const ARC_PUBLIC_RELAYER_CAPABILITIES = {
  ...ARC_READ_ONLY_CAPABILITIES,
  canRelayOpen: true,
};

function currentCapabilities() {
  if (DASHBOARD_MODE !== "arc-testnet") return LOCAL_CAPABILITIES;
  return ARC_PUBLIC_RELAYER_ENABLED ? ARC_PUBLIC_RELAYER_CAPABILITIES : ARC_READ_ONLY_CAPABILITIES;
}

function isLoopbackProviderUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(url);
}

function isLocalSandboxMode(): boolean {
  return chainId === 31337 && isLoopbackProviderUrl(PROVIDER_URL);
}

function forbiddenCapability(res: Response, capability: keyof ReturnType<typeof currentCapabilities>, action: string): boolean {
  if (currentCapabilities()[capability]) return false;
  res.status(403).json({
    error: `${action} is disabled in ${DASHBOARD_MODE} dashboard mode`,
  });
  return true;
}

function loadDeploymentRegistry(): Record<string, unknown> {
  const registryPath = process.env.OPENRAILS_DEPLOYMENT_REGISTRY_PATH;
  if (!registryPath) return {};
  const resolvedPath = path.resolve(registryPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Deployment registry not found: ${resolvedPath}`);
  }
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as Record<string, unknown>;
}

function requireAddress(value: unknown, name: string): string {
  const address = String(value || "");
  if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
    throw new Error(`${name} must be a non-zero EVM address`);
  }
  return address;
}

const x402SellerAddress = requireAddress(X402_SELLER_ADDRESS, "OPENRAILS_X402_SELLER_ADDRESS");
const x402Gateway = createGatewayMiddleware({
  sellerAddress: x402SellerAddress,
  facilitatorUrl: X402_FACILITATOR_URL,
  networks: [X402_NETWORK],
});

function buildFlushAuthorizationMessage(paycardId: string): string {
  return [
    "OpenRails flush authorization",
    `chainId:${chainId}`,
    `hub:${clearinghouseAddress}`,
    `paycardId:${paycardId}`,
  ].join("\n");
}

function extractVaultEventAmount(receipt: any, eventName: string, amountField: string): string {
  let total = 0n;
  for (const log of receipt.logs || []) {
    if (String(log.address).toLowerCase() !== clearinghouseAddress.toLowerCase()) continue;
    try {
      const parsed = clearinghouseContract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        total += BigInt(parsed.args[amountField].toString());
      }
    } catch {
      // Ignore ERC-20 and unrelated logs in the same transaction receipt.
    }
  }
  return total.toString();
}

function parseRecoveryBlockParam(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} is too large`);
  }
  return parsed;
}

function parseRecoveryLimitParam(value: unknown): number {
  if (value === undefined) return 20;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error("limit must be a positive integer");
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > PAYCARD_RECOVERY_MAX_LIMIT) {
    throw new Error(`limit must be between 1 and ${PAYCARD_RECOVERY_MAX_LIMIT}`);
  }
  return parsed;
}

function publicRelayerCaps() {
  const maxAllocationBase = parsePublicRelayerUnits(
    ARC_PUBLIC_RELAYER_MAX_ALLOCATION_USDC,
    "OPENRAILS_PUBLIC_RELAYER_MAX_ALLOCATION_USDC",
  );
  const maxVelocityBase = parsePublicRelayerUnits(
    ARC_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND,
    "OPENRAILS_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND",
  );
  return {
    maxAllocationUsdc: ARC_PUBLIC_RELAYER_MAX_ALLOCATION_USDC,
    maxAllocationBaseUnits: maxAllocationBase.toString(),
    maxLifespanSeconds: ARC_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS,
    maxVelocityUsdcPerSecond: ARC_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND,
    maxVelocityBaseUnitsPerSecond: maxVelocityBase.toString(),
  };
}

function parsePublicRelayerUnits(value: string, name: string): bigint {
  try {
    const parsed = ethers.parseUnits(value, 6);
    if (parsed <= 0n) throw new Error("non-positive");
    return parsed;
  } catch {
    throw new Error(`${name} must be a positive decimal USDC amount`);
  }
}

function assertPublicRelayerConfig(): void {
  if (!Number.isInteger(ARC_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS) || ARC_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS <= 0) {
    throw new Error("OPENRAILS_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS must be a positive integer");
  }
  parsePublicRelayerUnits(ARC_PUBLIC_RELAYER_MAX_ALLOCATION_USDC, "OPENRAILS_PUBLIC_RELAYER_MAX_ALLOCATION_USDC");
  parsePublicRelayerUnits(ARC_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND, "OPENRAILS_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND");
}

function validatePublicRelayerCaps(intent: any): string[] {
  if (!ARC_PUBLIC_RELAYER_ENABLED) return [];
  const reasons: string[] = [];
  const maxAllocationBase = parsePublicRelayerUnits(
    ARC_PUBLIC_RELAYER_MAX_ALLOCATION_USDC,
    "OPENRAILS_PUBLIC_RELAYER_MAX_ALLOCATION_USDC",
  );
  const maxVelocityBase = parsePublicRelayerUnits(
    ARC_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND,
    "OPENRAILS_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND",
  );
  const allocation = BigInt(intent.totalAllocationPool.toString());
  const velocity = BigInt(intent.flowVelocityPerSecond.toString());
  const lifespan = Number(intent.lifespanSeconds);
  if (allocation > maxAllocationBase) {
    reasons.push(`totalAllocationPool exceeds public relayer cap of ${ARC_PUBLIC_RELAYER_MAX_ALLOCATION_USDC} USDC`);
  }
  if (!Number.isInteger(lifespan) || lifespan < 0 || lifespan > ARC_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS) {
    reasons.push(`lifespanSeconds exceeds public relayer cap of ${ARC_PUBLIC_RELAYER_MAX_LIFESPAN_SECONDS}`);
  }
  if (velocity > maxVelocityBase) {
    reasons.push(`flowVelocityPerSecond exceeds public relayer cap of ${ARC_PUBLIC_RELAYER_MAX_VELOCITY_USDC_PER_SECOND} USDC/sec`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Rate Limiter — applied to mutating API routes
// ---------------------------------------------------------------------------

/** Token-bucket rate limiter: 20 burst, refills 5 tokens/sec per IP. */
const apiLimiter = createRateLimiter({ maxTokens: 20, refillRate: 5 });

// ---------------------------------------------------------------------------
// EnvelopeHeaderParser — inline middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that extracts an `Authorization: OpenRails <token>` header
 * and forwards the token into `req.body.envelopeToken` so downstream handlers
 * can consume it identically to a JSON-body submission.
 *
 * If the header is absent the request passes through unchanged.
 */
function envelopeHeaderParser(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("OpenRails ")) {
    const token = authHeader.slice("OpenRails ".length).trim();
    if (token.length > 0) {
      // Ensure req.body exists (express.json() should have run already)
      if (!req.body) {
        req.body = {};
      }
      req.body.envelopeToken = token;
    }
  }
  next();
}

function requireArcX402Mode(_req: Request, res: Response, next: NextFunction): void {
  if (DASHBOARD_MODE !== "arc-testnet" || chainId !== 5042002) {
    res.status(403).json({
      error: "Circle x402 OpenRails artifacts require Arc testnet dashboard mode",
    });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Helpers to load ABIs
// ---------------------------------------------------------------------------

function getContractAbi(contractName: string) {
  const filePath = path.join(
    __dirname,
    `../artifacts/contracts/${contractName}.sol/${contractName}.json`
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Compiled artifact for ${contractName} not found. Run "npm run compile" first.`);
  }
  const artifact = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { abi: artifact.abi, bytecode: artifact.bytecode };
}

// ---------------------------------------------------------------------------
// Contract deployment (local Hardhat node)
// ---------------------------------------------------------------------------

/** Deploy mock contracts if running on local Hardhat node. */
async function initContracts() {
  provider = new ethers.JsonRpcProvider(PROVIDER_URL);
  if (!isLoopbackProviderUrl(PROVIDER_URL)) {
    throw new Error("Local sandbox bootstrap refuses non-loopback RPC URLs. Use deployment scripts for testnet.");
  }
  
  // Use Hardhat's pre-funded JSON-RPC signers for local sandbox operations.
  const signers = await provider.listAccounts();
  if (signers.length < 3) {
    throw new Error("At least three accounts are required on the JSON-RPC node. Start 'hardhat node' first.");
  }

  relayerWallet = signers[0];
  relayerAddress = await relayerWallet.getAddress();
  
  const network = await provider.getNetwork();
  chainId = Number(network.chainId);

  console.log(`Connected to RPC. ChainId: ${chainId}, Relayer Address: ${relayerAddress}`);
  let relayerNonce = await provider.getTransactionCount(relayerAddress, "pending");

  // Deploy Mock USDC
  const mockUsdcArtifact = getContractAbi("MockUSDC");
  const usdcFactory = new ethers.ContractFactory(mockUsdcArtifact.abi, mockUsdcArtifact.bytecode, relayerWallet);
  usdcContract = await usdcFactory.deploy({ nonce: relayerNonce++ });
  await usdcContract.waitForDeployment();
  usdcAddress = await usdcContract.getAddress();
  console.log(`Mock USDC Deployed to: ${usdcAddress}`);

  // Deploy Clearinghouse (Hub)
  const clearinghouseArtifact = getContractAbi("ArcOpenRailsHubV1");
  const clearinghouseFactory = new ethers.ContractFactory(clearinghouseArtifact.abi, clearinghouseArtifact.bytecode, relayerWallet);
  clearinghouseContract = await clearinghouseFactory.deploy(usdcAddress, { nonce: relayerNonce++ });
  await clearinghouseContract.waitForDeployment();
  clearinghouseAddress = await clearinghouseContract.getAddress();
  console.log(`Clearinghouse (Hub) Deployed to: ${clearinghouseAddress}`);

  // Prepare demo agent and merchant signers (Hardhat Account #1 and #2).
  const agentWallet = signers[1];
  const merchantWallet = signers[2];

  // Mint some USDC to the agent wallet and approve clearinghouse
  // Force nonce refresh — Hardhat automining can desync ethers' internal cache
  const agentMint = ethers.parseUnits("5000", 6); // 5000 USDC
  const mintTx = await usdcContract.mint(agentWallet.address, agentMint, { nonce: relayerNonce++ });
  await mintTx.wait();

  const approveTx = await usdcContract.connect(agentWallet).approve(clearinghouseAddress, ethers.MaxUint256);
  await approveTx.wait();
  console.log(`Funded Agent: ${agentWallet.address} with 5000 USDC and approved Clearinghouse.`);
}

async function initArcTestnetReadOnly() {
  const publicRpcUrl = process.env.ARC_RPC_URL || PROVIDER_URL;
  if (!publicRpcUrl || isLoopbackProviderUrl(publicRpcUrl)) {
    throw new Error("Arc testnet dashboard mode requires a non-loopback ARC_RPC_URL or PROVIDER_URL");
  }

  const registry = loadDeploymentRegistry();
  const expectedChainId = Number(process.env.ARC_CHAIN_ID || registry.chainId || 0);
  if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
    throw new Error("ARC_CHAIN_ID or registry chainId is required for Arc testnet dashboard mode");
  }
  provider = createArcProvider({
    ARC_CANTEEN_RPC_URL: process.env.ARC_CANTEEN_RPC_URL,
    ARC_RPC_URL: publicRpcUrl,
    ARC_RPC_FALLBACK_URL: process.env.ARC_RPC_FALLBACK_URL,
    ARC_CHAIN_ID: String(expectedChainId),
  });
  const network = await provider.getNetwork();
  chainId = Number(network.chainId);
  if (chainId !== expectedChainId) {
    throw new Error(`Arc chain ID mismatch: expected ${expectedChainId}, got ${chainId}`);
  }

  usdcAddress = requireAddress(
    process.env.ARC_USDC_ADDRESS || registry.arcUsdcAddress,
    "Arc USDC address",
  );
  clearinghouseAddress = requireAddress(
    process.env.ARC_OPENRAILS_HUB_ADDRESS || registry.arcOpenRailsHubV1,
    "Arc OpenRails Hub address",
  );
  explorerBaseUrl = String(process.env.ARC_EXPLORER_BASE_URL || registry.explorerBaseUrl || "");

  const hubArtifact = getContractAbi("ArcOpenRailsHubV1");
  if (ARC_PUBLIC_RELAYER_ENABLED) {
    assertPublicRelayerConfig();
    const privateKey = process.env.OPENRAILS_RELAYER_PRIVATE_KEY;
    if (!privateKey || !/^(0x)?[0-9a-fA-F]{64}$/u.test(privateKey)) {
      throw new Error("OPENRAILS_RELAYER_PRIVATE_KEY must be a 32-byte hex key when OPENRAILS_ENABLE_ARC_PUBLIC_RELAYER=true");
    }
    relayerWallet = new ethers.Wallet(privateKey, provider);
    relayerAddress = await relayerWallet.getAddress();
    clearinghouseContract = new ethers.Contract(clearinghouseAddress, hubArtifact.abi, relayerWallet);
    console.log(`Arc public relayer enabled. Relayer address: ${relayerAddress}`);
  } else {
    clearinghouseContract = new ethers.Contract(clearinghouseAddress, hubArtifact.abi, provider);
    relayerAddress = "";
  }
  usdcContract = new ethers.Contract(usdcAddress, READ_ONLY_ERC20_ABI, provider);

  await provider.getCode(clearinghouseAddress).then((code) => {
    if (code === "0x") throw new Error("Arc OpenRails Hub address has no contract code");
  });
  await provider.getCode(usdcAddress).then((code) => {
    if (code === "0x") throw new Error("Arc USDC address has no contract code");
  });

  console.log(`Arc testnet dashboard connected. ChainId: ${chainId}`);
  console.log(`ArcOpenRailsHubV1: ${clearinghouseAddress}`);
  console.log(`USDC token: ${usdcAddress}`);
}

// ---------------------------------------------------------------------------
// MempoolRejectionListener — nonce-aware retry helper
// ---------------------------------------------------------------------------

/**
 * Detects whether an error is a nonce-related mempool rejection.
 *
 * Ethers v6 surfaces these as errors with `code === "NONCE_EXPIRED"` or
 * messages containing "nonce" heuristics from the underlying JSON-RPC node.
 */
function isNonceError(err: any): boolean {
  if (err?.code === "NONCE_EXPIRED") return true;
  const msg: string = (err?.message ?? "").toLowerCase();
  return msg.includes("nonce too low") || msg.includes("nonce has already been used");
}

// ---------------------------------------------------------------------------
// REST API Endpoints
// ---------------------------------------------------------------------------

// 1. Get system config
app.get("/api/config", (req, res) => {
  const localSandbox = isLocalSandboxMode();
  const networkMode = DASHBOARD_MODE === "arc-testnet" ? "arc-testnet" : "local";
  res.json({
    networkMode,
    chainId,
    clearinghouseAddress,
    usdcAddress,
    explorerBaseUrl,
    relayerAddress,
    relayerMode: ARC_PUBLIC_RELAYER_ENABLED ? "public-alpha" : (localSandbox ? "local-sandbox" : "read-only"),
    gasFeeBufferMultiplier: GAS_FEE_BUFFER_MULTIPLIER,
    localSandbox,
    exposesPrivateKeys: false,
    capabilities: currentCapabilities(),
    publicRelayer: {
      enabled: ARC_PUBLIC_RELAYER_ENABLED,
      closeRequiresWallet: true,
      settleRequiresWallet: true,
      caps: ARC_PUBLIC_RELAYER_ENABLED ? publicRelayerCaps() : null,
    },
    presets: {
      agentAddress: localSandbox ? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" : "", // Hardhat Account #1
      merchantAddress: localSandbox ? "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" : "", // Hardhat Account #2
      recoveryAddress: localSandbox ? "0x90F79bf6EB2c4f870365E785982E1f101E93b906" : "" // Hardhat Account #3
    }
  });
});

// 2. Query Paycard from ledger
app.get("/api/paycard/:id", async (req, res) => {
  try {
    const paycardId = req.params.id;
    const card = await clearinghouseContract.registry(paycardId);
    
    if (card.payer === ethers.ZeroAddress) {
      return res.status(404).json({ error: "Paycard not found" });
    }

    res.json({
      paycardId,
      payer: card.payer,
      recipient: card.recipient,
      metadataHash: card.metadataHash,
      totalAllocationPool: card.totalAllocationPool.toString(),
      availableBalance: card.availableBalance.toString(),
      flowVelocityPerSecond: card.flowVelocityPerSecond.toString(),
      genesisTimestamp: Number(card.genesisTimestamp),
      lifespanSeconds: Number(card.lifespanSeconds),
      lastCheckpointEpoch: Number(card.lastCheckpointEpoch),
      residualDeltaRecipient: card.residualDeltaRecipient,
      operationalStatus: Number(card.operationalStatus) === 0 ? "Active" : "Terminated",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. Durable stream history (non-authoritative projection from the gateway).
//     These read the persistent store on disk so receipts/state survive a
//     dashboard session and a gateway restart. They never override the Vault.
app.get("/api/streams", (req, res) => {
  try {
    const filter: StreamQueryFilter = {};
    const { payer, recipient, workflow, workflowId, metadataHash, status } = req.query;
    if (typeof payer === "string" && payer) filter.payer = payer;
    if (typeof recipient === "string" && recipient) filter.recipient = recipient;
    const wf = (workflow ?? workflowId);
    if (typeof wf === "string" && wf) filter.workflowId = wf;
    if (typeof metadataHash === "string" && metadataHash) {
      if (!ethers.isHexString(metadataHash, 32)) {
        return res.status(400).json({ error: "metadataHash must be a bytes32 hex string" });
      }
      filter.metadataHash = metadataHash;
    }
    if (typeof status === "string" && status) {
      const allowed: PaycardStatus[] = ["Active", "PendingSettlement", "Terminated"];
      if (!allowed.includes(status as PaycardStatus)) {
        return res.status(400).json({ error: `Invalid status; expected one of ${allowed.join(", ")}` });
      }
      filter.status = status as PaycardStatus;
    }
    const streams = streamReader.listStreams(filter);
    res.json({ authoritative: false, disclaimer: STREAM_HISTORY_DISCLAIMER, count: streams.length, streams });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/streams/:paycardId/history", (req, res) => {
  try {
    const paycardId = req.params.paycardId;
    if (!ethers.isHexString(paycardId, 32)) {
      return res.status(400).json({ error: "Invalid paycardId; expected bytes32 hex" });
    }
    const state = streamReader.getStream(paycardId);
    const events = streamReader.getStreamHistory(paycardId);
    if (!state && events.length === 0) {
      return res.status(404).json({ error: "No indexed history for this Paycard Stream", paycardId });
    }
    res.json({ authoritative: false, disclaimer: STREAM_HISTORY_DISCLAIMER, paycardId, state: state ?? null, events });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/workflows/:id", (req, res) => {
  try {
    const workflowId = req.params.id;
    if (!workflowId) {
      return res.status(400).json({ error: "Missing workflowId" });
    }
    const result = streamReader.getWorkflow(workflowId);
    res.json({ authoritative: false, disclaimer: STREAM_HISTORY_DISCLAIMER, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/transactions/:hash", (req, res) => {
  try {
    const hash = req.params.hash;
    if (!ethers.isHexString(hash, 32)) {
      return res.status(400).json({ error: "Invalid transaction hash; expected 32-byte hex" });
    }
    const result = streamReader.getByTransaction(hash);
    if (result.events.length === 0) {
      return res.status(404).json({ error: "No indexed events for this transaction", transactionHash: hash });
    }
    res.json({ authoritative: false, disclaimer: STREAM_HISTORY_DISCLAIMER, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Query ERC20 Balance
app.get("/api/balance/:address", async (req, res) => {
  try {
    const balance = await usdcContract.balanceOf(req.params.address);
    res.json({ balance: balance.toString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/allowance/:owner", async (req, res) => {
  try {
    const owner = req.params.owner;
    if (!ethers.isAddress(owner)) {
      return res.status(400).json({ error: "Invalid owner address" });
    }
    const allowance = await usdcContract.allowance(owner, clearinghouseAddress);
    res.json({
      owner,
      spender: clearinghouseAddress,
      allowance: allowance.toString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/nonce/:payer/:channel", async (req, res) => {
  try {
    const { payer, channel } = req.params;
    if (!ethers.isAddress(payer)) {
      return res.status(400).json({ error: "Invalid payer address" });
    }
    const nonce = await clearinghouseContract.accountNonceTracks(payer, channel);
    res.json({
      payer,
      channel,
      nonce: nonce.toString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/paycards/recover", apiLimiter, async (req, res) => {
  try {
    const payer = req.query.payer ? String(req.query.payer) : undefined;
    const recipient = req.query.recipient ? String(req.query.recipient) : undefined;
    const metadataHash = req.query.metadataHash ? String(req.query.metadataHash) : undefined;
    if (!payer && !recipient) {
      return res.status(400).json({ error: "payer or recipient is required" });
    }
    if (payer && !ethers.isAddress(payer)) {
      return res.status(400).json({ error: "Invalid payer address" });
    }
    if (recipient && !ethers.isAddress(recipient)) {
      return res.status(400).json({ error: "Invalid recipient address" });
    }
    if (metadataHash && !ethers.isHexString(metadataHash, 32)) {
      return res.status(400).json({ error: "metadataHash must be a bytes32 hex string" });
    }

    const latestBlock = await provider.getBlockNumber();
    const requestedFromBlock = parseRecoveryBlockParam(req.query.fromBlock, "fromBlock");
    const requestedToBlock = parseRecoveryBlockParam(req.query.toBlock, "toBlock");
    const fromBlock = requestedFromBlock ?? Math.max(0, latestBlock - PAYCARD_RECOVERY_DEFAULT_LOOKBACK_BLOCKS);
    const toBlock = requestedToBlock ?? latestBlock;
    const limit = parseRecoveryLimitParam(req.query.limit);
    if (toBlock < fromBlock) {
      return res.status(400).json({ error: "toBlock must be greater than or equal to fromBlock" });
    }
    if (toBlock - fromBlock > PAYCARD_RECOVERY_MAX_BLOCK_SPAN) {
      return res.status(400).json({
        error: `Recovery block range exceeds ${PAYCARD_RECOVERY_MAX_BLOCK_SPAN} blocks`,
      });
    }

    const results = await recoverPaycardsFromLogs(provider, clearinghouseAddress, {
      payer,
      recipient,
      metadataHash,
      fromBlock,
      toBlock,
      limit,
      chunkSize: PAYCARD_RECOVERY_CHUNK_SIZE,
    });

    res.json({
      chainId,
      clearinghouseAddress,
      filters: {
        payer: payer ? ethers.getAddress(payer) : undefined,
        recipient: recipient ? ethers.getAddress(recipient) : undefined,
        metadataHash,
      },
      fromBlock,
      toBlock,
      limit,
      results,
    });
  } catch (err: any) {
    const message = err?.message || "Paycard recovery failed";
    const status = /must be|invalid|exceeds|required/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// 4. Open Paycard Channel via local relayer
//    - Rate-limited via apiLimiter
//    - EnvelopeHeaderParser extracts Authorization header as alternative input
//    - MempoolRejectionListener: retries once on nonce-related failures
app.post("/api/paycard/open", apiLimiter, envelopeHeaderParser, async (req, res) => {
  try {
    if (forbiddenCapability(res, "canRelayOpen", "Local relayer submission")) return;
    const validation = validateOpenPaycardRequest(
      {
        ...req.body,
        openRailsPaycardId: req.header("X-OpenRails-Paycard-Id"),
        openRailsMetadataHash: req.header("X-OpenRails-Metadata-Hash"),
      },
      { tokenAddress: usdcAddress },
    );
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        ...(validation.reasons ? { reasons: validation.reasons } : {}),
      });
    }

    const {
      decoded,
      envelopeMode,
      isWildcardRailsCard,
      claimRecipient,
      workflowId,
    } = validation.value;
    const { intent, envelopeSignature } = decoded;
    const capReasons = validatePublicRelayerCaps(intent);
    if (capReasons.length) {
      return res.status(400).json({
        error: "Public relayer cap exceeded",
        reasons: capReasons,
        caps: publicRelayerCaps(),
      });
    }

    console.log(`Relayer: Received request to open paycard ${intent.paycardId}`);

    /**
     * Submit the on-chain transaction with MempoolRejectionListener retry.
     *
     * If the initial submission fails due to a stale nonce (e.g. another
     * concurrent tx was mined first), we fetch the latest nonce explicitly
     * and retry exactly once.
     */
    let tx: any;
    let retried = false;

    const submitTx = async (overrides?: { nonce: number }) => {
      const args = [
        intent.paycardId,
        intent.metadataHash,
        isWildcardRailsCard ? claimRecipient : intent.recipient,
        intent.totalAllocationPool,
        intent.flowVelocityPerSecond,
        intent.genesisTimestamp,
        intent.lifespanSeconds,
        intent.residualDeltaRecipient,
        envelopeSignature,
        intent.nonceChannel,
        intent.nonceValue,
        overrides ?? {},
      ];

      return isWildcardRailsCard
        ? clearinghouseContract.claimWildcardPaycardChannel(...args)
        : clearinghouseContract.openPaycardChannel(...args);
    };

    try {
      tx = await submitTx();
    } catch (firstErr: any) {
      if (isNonceError(firstErr)) {
        retried = true;
        console.warn(
          `Relayer [MempoolRejectionListener]: Nonce error detected — "${firstErr.message}". ` +
            "Retrying with fresh nonce…"
        );
        if (!relayerWallet) throw new Error("Relayer wallet is unavailable");
        const freshNonce = await provider.getTransactionCount(relayerAddress, "pending");
        tx = await submitTx({ nonce: freshNonce });
        console.log(`Relayer [MempoolRejectionListener]: Retry submitted with nonce ${freshNonce}.`);
      } else {
        throw firstErr;
      }
    }

    console.log(`Relayer: Transaction submitted. Tx Hash: ${tx.hash}${retried ? " (retried)" : ""}`);
    const receipt = await tx.wait();
    console.log(`Relayer: Transaction mined in block ${receipt.blockNumber}`);
    const openedCard = await clearinghouseContract.registry(intent.paycardId);
    const intentDigest = hashSettlementIntent(intent, chainId, clearinghouseAddress, "1.0.0");

    res.json({
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      paycardId: intent.paycardId,
      mode: envelopeMode,
      workflowId,
      proof: buildTransactionProof({
        stage: "opened_escrow",
        paycardId: intent.paycardId,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        payer: openedCard.payer,
        recipient: openedCard.recipient,
        amount: openedCard.totalAllocationPool.toString(),
        metadataHash: openedCard.metadataHash,
        workflowId,
        intentDigest,
        mode: envelopeMode,
      }),
      intentProof: buildIntentProof(
        decoded,
        { chainId, verifyingContract: clearinghouseAddress },
        envelopeMode
      ),
    });
  } catch (err: any) {
    console.error("Relayer Error in openPaycardChannel:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Process Drip Settle
app.post("/api/paycard/drip", apiLimiter, async (req, res) => {
  try {
    if (forbiddenCapability(res, "canGatewaySettle", "Gateway drip settlement")) return;
    const { paycardId } = req.body;
    if (!paycardId || !ethers.isHexString(paycardId, 32)) {
      return res.status(400).json({ error: "paycardId must be a bytes32 hex string" });
    }
    const card = await clearinghouseContract.registry(paycardId);
    if (card.payer === ethers.ZeroAddress) {
      return res.status(404).json({ error: "Paycard not found" });
    }
    if (Number(card.operationalStatus) !== 0) {
      return res.status(400).json({ error: "Paycard is not active" });
    }

    console.log(`Relayer: Triggering processDripSettle for ${paycardId}`);
    const tx = await clearinghouseContract.processDripSettle(paycardId);
    const receipt = await tx.wait();
    const settledAmount = extractVaultEventAmount(receipt, "SettlementFlushed", "amountWithdrawn");

    res.json({
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      settledAmount,
      proof: buildTransactionProof({
        stage: "settlement",
        paycardId,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      }),
    });
  } catch (err: any) {
    console.error("Error in processDripSettle:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Flush Residual Delta (STN-Delta recovery)
app.post("/api/paycard/flush", apiLimiter, async (req, res) => {
  try {
    if (forbiddenCapability(res, "canDemoFlush", "Demo residual flush")) return;
    const { paycardId, caller, authorizationSignature } = req.body;
    if (!paycardId) {
      return res.status(400).json({ error: "Missing paycardId" });
    }
    if (!caller || !authorizationSignature) {
      return res.status(403).json({ error: "Flush requires caller authorization signature" });
    }

    const card = await clearinghouseContract.registry(paycardId);
    if (card.payer === ethers.ZeroAddress) {
      return res.status(404).json({ error: "Paycard not found" });
    }

    const recovered = ethers.verifyMessage(
      buildFlushAuthorizationMessage(paycardId),
      authorizationSignature,
    );
    if (recovered.toLowerCase() !== caller.toLowerCase()) {
      return res.status(403).json({ error: "Flush authorization signer mismatch" });
    }
    const authorized =
      recovered.toLowerCase() === card.payer.toLowerCase() ||
      recovered.toLowerCase() === card.recipient.toLowerCase();
    if (!authorized) {
      return res.status(403).json({ error: "Caller is not payer or recipient for this paycard" });
    }

    if (!isLocalSandboxMode()) {
      return res.status(403).json({
        error: "Demo flush is available only in the local Hardhat sandbox. Submit flushResidualDelta from payer or recipient wallet.",
      });
    }

    const demoPrivateKey = process.env.OPENRAILS_DEMO_FLUSH_PRIVATE_KEY;
    let demoSigner: ethers.Wallet | ethers.JsonRpcSigner;
    if (process.env.OPENRAILS_ENABLE_DEMO_CUSTODIAL_FLUSH === "true" && demoPrivateKey) {
      const walletSigner = new ethers.Wallet(demoPrivateKey, provider);
      if (walletSigner.address.toLowerCase() !== recovered.toLowerCase()) {
        return res.status(403).json({ error: "Configured demo flush key does not match authorized caller" });
      }
      demoSigner = walletSigner;
    } else {
      await provider.send("hardhat_impersonateAccount", [recovered]);
      demoSigner = await provider.getSigner(recovered);
    }

    console.log(`Relayer: Authorized local demo flushResidualDelta for ${paycardId}`);
    const tx = await clearinghouseContract.connect(demoSigner).flushResidualDelta(paycardId);
    const receipt = await tx.wait();
    const recoveredAmount = extractVaultEventAmount(receipt, "ResidualDeltaReclaimed", "varianceSwept");
    const settledAmount = extractVaultEventAmount(receipt, "SettlementFlushed", "amountWithdrawn");

    res.json({
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      recoveredAmount,
      settledAmount,
      proof: buildTransactionProof({
        stage: "residual_reclaim",
        paycardId,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      }),
    });
  } catch (err: any) {
    console.error("Error in flushResidualDelta:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Mint USDC for dashboard convenience
app.post("/api/usdc/mint", apiLimiter, async (req, res) => {
  try {
    if (forbiddenCapability(res, "canMint", "Demo mint")) return;
    const { address, amount } = req.body;
    const decimals = 6;
    const mintAmount = ethers.parseUnits(amount.toString(), decimals);
    
    console.log(`Minting ${amount} USDC to ${address}`);
    const tx = await usdcContract.mint(address, mintAmount);
    await tx.wait();
    
    res.json({ success: true, txHash: tx.hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Increase local block timestamp (Time-Travel for demo simulation)
app.post("/api/blockchain/increase-time", apiLimiter, async (req, res) => {
  try {
    if (forbiddenCapability(res, "canTimeTravel", "Local time travel")) return;
    const { seconds } = req.body;
    console.log(`Blockchain: Advancing time by ${seconds} seconds`);
    await provider.send("evm_increaseTime", [Number(seconds)]);
    await provider.send("evm_mine", []);
    
    const block = await provider.getBlock("latest");
    res.json({ success: true, newTimestamp: block?.timestamp });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Protected demo resource requiring a valid OpenRails access credential
app.get("/api/demo/protected-resource", async (req, res) => {
  try {
    if (!isLocalSandboxMode() || !relayerWallet) {
      return res.status(403).json({ error: "Protected demo resource is available only in local sandbox mode" });
    }
    const validation = validateOpenRailsAccessRequest(
      {
        authorization: req.header("Authorization"),
        openRailsCredentialType: req.header("X-OpenRails-Credential-Type"),
        openRailsPaycardId: req.header("X-OpenRails-Paycard-Id"),
        openRailsMetadataHash: req.header("X-OpenRails-Metadata-Hash"),
        openRailsMode: req.header("X-OpenRails-Mode"),
      },
      {
        expectedChainId: chainId,
        expectedVault: clearinghouseAddress,
        expectedService: relayerAddress,
        expectedServiceOrigin: SERVICE_ORIGIN,
        expectedScope: PROTECTED_SCOPE,
      },
    );
    if (!validation.ok) {
      return res.status(401).json({ error: validation.error });
    }

    const { credential, signer } = validation.value;
    const card = await clearinghouseContract.registry(credential.paycardId);
    if (card.payer === ethers.ZeroAddress) {
      return res.status(404).json({ error: "Paycard not found" });
    }
    if (card.metadataHash !== credential.metadataHash) {
      return res.status(403).json({ error: "Credential metadataHash does not match Vault row" });
    }
    if (Number(card.operationalStatus) !== 0) {
      return res.status(403).json({ error: "Paycard is not active" });
    }

    const signerLower = signer.toLowerCase();
    const authorized =
      signerLower === card.payer.toLowerCase() ||
      signerLower === card.recipient.toLowerCase();
    if (!authorized) {
      return res.status(403).json({ error: "Credential signer is not payer or recipient" });
    }

    res.json({
      success: true,
      message: "OpenRails protected demo resource unlocked",
      paycardId: credential.paycardId,
      metadataHash: credential.metadataHash,
      mode: credential.mode,
      signer,
      availableBalance: card.availableBalance.toString(),
      scope: PROTECTED_SCOPE,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Circle x402-protected OpenRails artifact endpoint.
//     The x402 settlement proves HTTP payment only. It does not claim OpenRails Vault escrow.
app.get(
  "/api/x402/openrails-artifact",
  requireArcX402Mode,
  x402Gateway.require(X402_PRICE),
  (req: X402PaidRequest, res) => {
    const payment = req.payment;
    if (!payment) {
      return res.status(502).json({ error: "Circle x402 payment metadata was not attached" });
    }
    if (!ethers.isAddress(payment.payer)) {
      return res.status(502).json({ error: "Circle x402 payment payer is not an EVM address" });
    }

    const settlementId = payment.transaction ?? "";
    const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
      amount: payment.amount,
      network: payment.network,
      payer: payment.payer,
      scope: X402_OPENRAILS_SCOPE,
      seller: x402SellerAddress,
      settlementId,
    })));
    const metadata: CanonicalMetadataV1 = {
      version: "openrails-metadata-v1",
      mode: "railsflow",
      originator: payment.payer,
      recipient: x402SellerAddress,
      token: usdcAddress,
      amount: payment.amount,
      flowVelocityPerSecond: "0",
      lifespanSeconds: 0,
      metadataRef: settlementId ? `circle-x402:${settlementId}` : "circle-x402:pending",
      descriptionHash,
    };
    const metadataHash = hashOpenRailsMetadata(metadata);

    res.json({
      success: true,
      message: "Circle x402 payment accepted; OpenRails artifact generated without Vault escrow",
      x402: {
        payer: payment.payer,
        amount: payment.amount,
        network: payment.network,
        settlementId,
        facilitatorUrl: X402_FACILITATOR_URL,
      },
      openrails: {
        artifactVersion: "openrails-x402-artifact-v1",
        chainId,
        vaultAddress: clearinghouseAddress,
        tokenAddress: usdcAddress,
        serviceOrigin: SERVICE_ORIGIN,
        scope: X402_OPENRAILS_SCOPE,
        metadata,
        metadataHash,
        vaultEscrowClaimed: false,
        openRailsSettlementStage: "metadata_only",
        nextAction:
          "Redeem this artifact into a real Vault escrow: open a Paycard Stream with a separate " +
          "OpenRails wallet signature, binding metadataRef=circle-x402:<settlementId> " +
          "(non-custodial; buyer funds their own escrow). See `npm run smoke:x402:stream`.",
      },
    });
  },
);

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

/** Start Express after initializing contracts. */
async function startServer() {
  console.log(`Initializing gateway in ${DASHBOARD_MODE} mode...`);
  if (DASHBOARD_MODE !== "arc-testnet") {
    // Give the hardhat node a brief moment to start up if launched concurrently
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  try {
    if (DASHBOARD_MODE === "arc-testnet") {
      await initArcTestnetReadOnly();
    } else {
      await initContracts();
    }
    console.log("Gateway successfully initialized.");

    app.listen(PORT, () => {
      console.log(`Gateway API listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to initialize contracts. Make sure 'npm run node' is running.", err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}
