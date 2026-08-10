/**
 * x402 -> Paycard Stream (non-custodial redeem) on Arc testnet.
 *
 * Phase 1: pay the real x402 artifact endpoint (Circle Gateway) -> settlement id.
 * Phase 2: open a REAL OpenRails Paycard Stream, escrowed from the BUYER'S OWN USDC
 *          (the buyer signs the EIP-712 intent and self-submits openPaycardChannel), bound
 *          to the x402 settlement via metadata (`metadataRef = circle-x402:<settlementId>`).
 *
 * No intermediary custodies funds: the Vault pulls escrow from the intent signer's balance.
 * The x402 fee (access, to the seller) and the stream escrow (buyer's funds) are separate
 * pots, linked by the settlement id. Buyer key via env X402_BUYER_PRIVATE_KEY only.
 *
 *   X402_BUYER_PRIVATE_KEY=0x... \
 *   X402_SMOKE_URL=http://localhost:3001/api/x402/openrails-artifact \
 *   ARC_RPC_URL=https://rpc.testnet.arc.io \
 *   ARC_OPENRAILS_HUB_ADDRESS=0x... ARC_USDC_ADDRESS=0x... \
 *   npm run smoke:x402:stream
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

import {
  hashOpenRailsMetadata,
  buildMetadataBoundPaycardId,
  type CanonicalMetadataV1,
} from "../../sdk/src/metadata";
import { LeptonOpenRailsClient, type OpenRailsIntentV1 } from "../../sdk/src/client";
import {
  approveOpenRailsSpend,
  assertOpenRailsNetwork,
  readNonce,
  readPaycard,
  readTokenAllowance,
  readTokenBalance,
  submitOpenPaycardWithSigner,
} from "../../sdk/src/wallet";

// Circle buyer SDK via typed require (subpath exports aren't type-resolved by ts-node).
type PayResult = { status: number; data: any; transaction?: string };
type Balances = { gateway: { formattedAvailable: string; available: string } };
const { GatewayClient } = require("@circle-fin/x402-batching/client") as {
  GatewayClient: new (c: { chain: string; privateKey: `0x${string}` }) => {
    pay(url: string): Promise<PayResult>;
    getBalances(): Promise<Balances>;
    deposit(amount: string): Promise<{ depositTxHash: string }>;
  };
};

const DEFAULT_URL = "http://localhost:3001/api/x402/openrails-artifact";
const DEMO_SELLER = "0x933a2405f84c224be1ef373ba16e992e1f459682";

function fail(message: string): never {
  console.error(`\n[x402->stream] FAIL: ${message}`);
  process.exit(1);
}

function readPrivateKey(): `0x${string}` {
  const key = process.env.X402_BUYER_PRIVATE_KEY;
  if (!key) {
    fail(
      "X402_BUYER_PRIVATE_KEY is not set.\n" +
        "  Provide the funded Arc-testnet buyer key via the environment (never on argv):\n" +
        "    X402_BUYER_PRIVATE_KEY=0x... npm run smoke:x402:stream",
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    fail("X402_BUYER_PRIVATE_KEY must be a 0x-prefixed 32-byte (64 hex char) private key.");
  }
  return key as `0x${string}`;
}

function loadRegistry(): Record<string, any> {
  const p =
    process.env.OPENRAILS_DEPLOYMENT_REGISTRY_PATH ||
    path.join(__dirname, "../../deployments/openrails-addresses.local.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function requireAddress(value: any, name: string): string {
  const a = String(value || "");
  if (!ethers.isAddress(a)) fail(`${name} is missing or not a valid address`);
  return ethers.getAddress(a);
}

async function main(): Promise<void> {
  const privateKey = readPrivateKey();
  const url = process.env.X402_SMOKE_URL || process.argv[2] || DEFAULT_URL;
  const registry = loadRegistry();

  const rpcUrl = process.env.ARC_RPC_URL || process.env.PROVIDER_URL || "https://rpc.testnet.arc.io";
  const chainId = Number(process.env.ARC_CHAIN_ID || registry.chainId || 5042002);
  const hub = requireAddress(process.env.ARC_OPENRAILS_HUB_ADDRESS || registry.arcOpenRailsHubV1, "Arc OpenRails Hub");
  const token = requireAddress(process.env.ARC_USDC_ADDRESS || registry.arcUsdcAddress, "Arc USDC");

  // Stream terms (the buyer's own escrow; separate from the x402 access fee).
  const allocation = BigInt(process.env.X402_STREAM_ALLOCATION || "50000"); // 0.05 USDC (6dp)
  const velocity = BigInt(process.env.X402_STREAM_VELOCITY || "10"); // base units / sec
  const lifespan = Number(process.env.X402_STREAM_LIFESPAN || "3600");
  const nonceChannel = Number(process.env.X402_STREAM_NONCE_CHANNEL || "402");
  const recipient = requireAddress(process.env.X402_STREAM_RECIPIENT || DEMO_SELLER, "stream recipient");

  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(privateKey, provider);
  const buyer = await wallet.getAddress();
  await assertOpenRailsNetwork(provider, chainId);

  console.log("[x402->stream] non-custodial x402 -> Paycard Stream (Arc testnet)");
  console.log(`[x402->stream] buyer=${buyer} hub=${hub} token=${token} chain=${chainId}`);

  // ---- Phase 1: pay x402 ----
  const client = new GatewayClient({ chain: "arcTestnet", privateKey });

  // Ensure the Circle Gateway has balance to debit (x402 batching model debits a deposit).
  try {
    const bal = await client.getBalances();
    if (Number(bal.gateway.formattedAvailable) < 0.02 && process.env.X402_AUTO_DEPOSIT !== "false") {
      console.log("[x402->stream] gateway balance low; depositing 0.1 USDC into Circle Gateway...");
      const d = await client.deposit("0.1");
      console.log(`[x402->stream] gateway deposit tx: ${d.depositTxHash}`);
    }
  } catch (e: any) {
    console.warn(`[x402->stream] gateway balance check skipped: ${e?.message ?? e}`);
  }

  console.log(`[x402->stream] paying x402 at ${url} ...`);
  const pay = (await client.pay(url).catch((err: any) =>
    fail(
      `x402 pay() failed: ${err?.message ?? err}\n` +
        "  (insufficient Gateway balance, facilitator unreachable, or server not in arc-testnet mode)",
    ),
  )) as PayResult;
  if (pay.status !== 200) fail(`x402 expected HTTP 200, got ${pay.status}: ${JSON.stringify(pay.data)}`);
  const settlementId: string = pay.data?.x402?.settlementId || pay.transaction || "";
  if (!settlementId) fail("x402 succeeded but no settlement id was returned.");
  console.log(`[x402->stream] x402 PAID. settlementId=${settlementId}`);

  // ---- Phase 2: open a real Paycard Stream, bound to the settlement, buyer-funded ----
  const nonceValue = await readNonce(provider, hub, buyer, nonceChannel);
  const genesisTimestamp = Math.floor(Date.now() / 1000);

  const metadata: CanonicalMetadataV1 = {
    version: "openrails-metadata-v1",
    mode: "railsflow",
    originator: buyer,
    recipient,
    token,
    amount: allocation.toString(),
    flowVelocityPerSecond: velocity.toString(),
    lifespanSeconds: lifespan,
    metadataRef: `circle-x402:${settlementId}`,
  };
  const metadataHash = hashOpenRailsMetadata(metadata);
  const paycardId = buildMetadataBoundPaycardId({ payer: buyer, nonceChannel, nonceValue, metadataHash });

  const intent: OpenRailsIntentV1 = {
    paycardId,
    metadataHash,
    recipient,
    totalAllocationPool: allocation.toString(),
    flowVelocityPerSecond: velocity.toString(),
    genesisTimestamp,
    lifespanSeconds: lifespan,
    residualDeltaRecipient: buyer, // recover residual to self
    nonceChannel,
    nonceValue,
  };

  // Balance + bounded allowance (buyer funds their own escrow).
  const balance = await readTokenBalance(provider, token, buyer);
  if (balance < allocation) {
    fail(`Insufficient USDC for stream escrow: need ${allocation}, have ${balance}.`);
  }
  let allowance = await readTokenAllowance(provider, token, buyer, hub);
  let approvalHash: string | undefined;
  if (allowance < allocation) {
    console.log(`[x402->stream] approving bounded USDC spend (${allocation}) to hub...`);
    const approveTx = await approveOpenRailsSpend(wallet, token, hub, allocation);
    approvalHash = approveTx.hash;
    await approveTx.wait();
    allowance = await readTokenAllowance(provider, token, buyer, hub);
    if (allowance < allocation) fail(`Allowance still insufficient after approval: have ${allowance}.`);
  }

  // Sign EIP-712 envelope (metadata bound) and self-submit openPaycardChannel.
  const orClient = new LeptonOpenRailsClient(privateKey, hub, chainId);
  const envelopeToken = await orClient.signPermissionEnvelope(intent, { mode: "railsflow", metadata });
  console.log("[x402->stream] opening Paycard Stream (openPaycardChannel)...");
  const openTx = await submitOpenPaycardWithSigner(wallet, hub, envelopeToken, "railsflow");
  console.log(`[x402->stream] open tx submitted: ${openTx.hash}`);
  const receipt = await openTx.wait();

  // ---- Prove: read the on-chain registry row ----
  const row: any = await readPaycard(provider, hub, paycardId);
  const onchainMetadataHash = String(row.metadataHash ?? row[3] ?? "");
  const onchainPayer = String(row.payer ?? row[0] ?? "");
  if (onchainMetadataHash.toLowerCase() !== metadataHash.toLowerCase()) {
    fail(`On-chain metadataHash ${onchainMetadataHash} != bound metadataHash ${metadataHash}`);
  }
  if (onchainPayer && onchainPayer.toLowerCase() !== buyer.toLowerCase()) {
    fail(`On-chain payer ${onchainPayer} != buyer ${buyer} (escrow not from buyer!)`);
  }

  const result = {
    nonCustodial: true,
    x402: { settlementId, facilitatorUrl: pay.data?.x402?.facilitatorUrl, paidTo: pay.data?.x402 ? DEMO_SELLER : undefined },
    stream: {
      paycardId,
      openTxHash: openTx.hash,
      blockNumber: receipt?.blockNumber ?? null,
      payer: buyer,
      recipient,
      totalAllocationPool: allocation.toString(),
      flowVelocityPerSecond: velocity.toString(),
      lifespanSeconds: lifespan,
      residualDeltaRecipient: buyer,
      metadataHash,
      approvalHash: approvalHash ?? "(already approved)",
    },
    binding: { metadataRef: metadata.metadataRef, metadata },
  };

  console.log(
    "\n[x402->stream] PASS — x402 payment unlocked the artifact AND a real OpenRails Vault stream " +
      "was opened from the buyer's own USDC, bound to the settlement.",
  );
  console.log("\n===== X402 -> PAYCARD STREAM RESULT (paste into bridge results doc) =====");
  console.log(JSON.stringify(result, null, 2));
  console.log("===== END RESULT =====\n");
}

main().catch((err) => {
  console.error(`[x402->stream] unexpected error: ${err?.message ?? err}`);
  process.exit(1);
});
