import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

import {
  readPaycard,
  readTokenAllowance,
  readTokenBalance,
  recoverPaycardsFromLogs,
} from "../sdk/src/wallet";

type Args = {
  wallet?: string;
  paycard?: string;
  metadataHash?: string;
  fromBlock?: number;
  toBlock?: number;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--help") {
      printHelp();
      process.exit(0);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--wallet") args.wallet = value;
    else if (flag === "--paycard") args.paycard = value;
    else if (flag === "--metadata-hash") args.metadataHash = value;
    else if (flag === "--from-block") args.fromBlock = parseBlock(value, "from-block");
    else if (flag === "--to-block") args.toBlock = parseBlock(value, "to-block");
    else if (flag === "--limit") args.limit = parseLimit(value);
    else throw new Error(`Unknown option ${flag}`);
    i += 1;
  }
  return args;
}

function parseBlock(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
  return parsed;
}

function parseLimit(value: string): number {
  const parsed = parseBlock(value, "limit");
  if (parsed <= 0 || parsed > 25) throw new Error("limit must be between 1 and 25");
  return parsed;
}

function printHelp(): void {
  console.log([
    "Read-only OpenRails Arc SDK smoke.",
    "",
    "Usage:",
    "  npm run smoke:sdk:arc -- --wallet 0x...",
    "  npm run smoke:sdk:arc -- --paycard 0x...",
    "",
    "Options:",
    "  --wallet 0x...          Read balance/allowance and recover Paycard IDs by payer/recipient logs.",
    "  --paycard 0x...         Read one Paycard Stream registry row.",
    "  --metadata-hash 0x...   Optional recovery filter.",
    "  --from-block N          Optional recovery start block.",
    "  --to-block N            Optional recovery end block.",
    "  --limit N               Recovery result limit, default 10, max 25.",
  ].join("\n"));
}

function loadRegistry(): Record<string, unknown> {
  const registryPath = process.env.OPENRAILS_DEPLOYMENT_REGISTRY_PATH ||
    path.join(__dirname, "../deployments/openrails-addresses.local.json");
  if (!fs.existsSync(registryPath)) return {};
  return JSON.parse(fs.readFileSync(registryPath, "utf8")) as Record<string, unknown>;
}

function requireAddress(value: unknown, name: string): string {
  const address = String(value || "");
  if (!ethers.isAddress(address)) throw new Error(`${name} is missing or invalid`);
  return ethers.getAddress(address);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const registry = loadRegistry();
  const rpcUrl = process.env.ARC_RPC_URL || process.env.RPC || "https://rpc.testnet.arc.io";
  const chainId = Number(process.env.ARC_CHAIN_ID || registry.chainId || 5042002);
  const hub = requireAddress(process.env.ARC_OPENRAILS_HUB_ADDRESS || registry.arcOpenRailsHubV1, "Arc hub");
  const token = requireAddress(process.env.ARC_USDC_ADDRESS || registry.arcUsdcAddress, "Arc USDC");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const probedChainId = Number(BigInt(await provider.send("eth_chainId", [])));
  if (probedChainId !== chainId) {
    throw new Error(`Wrong network: expected chain ${chainId}, got ${probedChainId}`);
  }
  const latestBlock = await provider.getBlockNumber();

  const output: Record<string, unknown> = {
    ok: true,
    mode: "read-only",
    chainId,
    latestBlock,
    hub,
    token,
  };

  if (args.wallet) {
    const wallet = ethers.getAddress(args.wallet);
    const [balance, allowance] = await Promise.all([
      readTokenBalance(provider, token, wallet),
      readTokenAllowance(provider, token, wallet, hub),
    ]);
    const fromBlock = args.fromBlock ?? Math.max(0, latestBlock - 50_000);
    const payerMatches = await recoverPaycardsFromLogs(provider, hub, {
      payer: wallet,
      metadataHash: args.metadataHash,
      fromBlock,
      toBlock: args.toBlock,
      limit: args.limit,
    });
    const recipientMatches = await recoverPaycardsFromLogs(provider, hub, {
      recipient: wallet,
      metadataHash: args.metadataHash,
      fromBlock,
      toBlock: args.toBlock,
      limit: args.limit,
    });
    const recovered = new Map<string, unknown>();
    for (const result of [...payerMatches, ...recipientMatches]) {
      recovered.set(result.paycardId.toLowerCase(), result);
    }
    output.wallet = wallet;
    output.balance = balance.toString();
    output.allowance = allowance.toString();
    output.recovery = {
      fromBlock,
      toBlock: args.toBlock ?? latestBlock,
      count: recovered.size,
      results: [...recovered.values()],
    };
  }

  if (args.paycard) {
    if (!ethers.isHexString(args.paycard, 32)) throw new Error("paycard must be bytes32 hex");
    output.paycard = {
      paycardId: args.paycard,
      registry: await readPaycard(provider, hub, args.paycard),
    };
  }

  if (!args.wallet && !args.paycard) {
    output.next = "Pass --wallet to recover Paycard IDs, or --paycard to read one stream.";
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exitCode = 1;
});
