/**
 * Client-side chain reads — make the cockpit work WITHOUT a gateway (e.g. hosted on
 * Cloudflare Pages). Reads config from bundled constants, Paycard state from the Hub's
 * `registry`, and recovers paycards via `PaycardProvisioned` logs — all over the public Arc RPC
 * with viem. `api.*` read calls fall back to these when the gateway is unreachable.
 *
 * Indexer-only views (the streams projection, per-stream history, workflow grouping) have no
 * cheap chain equivalent, so they degrade to honest empty states in standalone mode; My Streams
 * + Profile still work via recover + registry.
 */
import { createPublicClient, parseAbiItem, getAddress } from "viem";
import { arcTestnet } from "./chain";
import { createArcTransport } from "./rpc";
import { HUB_ABI } from "./contracts";
import type { GatewayConfig, PaycardOnchain, RecoveredPaycard, StreamState, StreamEvent, PaycardStatus } from "./api";

// Public Arc testnet config (addresses are public, not secrets).
export const BUNDLED_CONFIG: GatewayConfig = {
  networkMode: "arc-testnet",
  chainId: 5042002,
  clearinghouseAddress: "0x941C8029F0f912df3fAb7423890ab2359b996D0b",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  explorerBaseUrl: "https://testnet.arcscan.app",
  relayerMode: "client-self-submit",
};

const HUB = BUNDLED_CONFIG.clearinghouseAddress as `0x${string}`;
const PROVISIONED = parseAbiItem(
  "event PaycardProvisioned(bytes32 indexed paycardId, address indexed payer, address indexed recipient, bytes32 metadataHash, uint256 poolAllocation, uint256 flowVelocityPerSecond, uint256 genesisTimestamp, uint256 lifespanSeconds)",
);
const SETTLED = parseAbiItem(
  "event SettlementFlushed(bytes32 indexed paycardId, address indexed recipient, uint256 amountWithdrawn)",
);
const RECLAIMED = parseAbiItem(
  "event ResidualDeltaReclaimed(bytes32 indexed paycardId, address indexed recoveryVault, uint256 varianceSwept)",
);

const WINDOW = 9000n; // public RPC caps getLogs at ~10k blocks
const stringifyArgs = (a: Record<string, unknown> = {}): Record<string, unknown> =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

/** Retry a complete fallback pass to absorb short multi-provider outages. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}

const client = createPublicClient({ chain: arcTestnet, transport: createArcTransport() });

const USDC = BUNDLED_CONFIG.usdcAddress as `0x${string}`;
const ERC20_READ = [
  parseAbiItem("function balanceOf(address) view returns (uint256)"),
  parseAbiItem("function allowance(address,address) view returns (uint256)"),
] as const;

export const chainReads = {
  config: async (): Promise<GatewayConfig> => BUNDLED_CONFIG,

  balance: async (address: string): Promise<{ balance: string }> => {
    const b = await withRetry(() => client.readContract({ address: USDC, abi: ERC20_READ, functionName: "balanceOf", args: [getAddress(address)] })) as bigint;
    return { balance: b.toString() };
  },
  allowance: async (owner: string): Promise<{ allowance: string }> => {
    const a = await withRetry(() => client.readContract({ address: USDC, abi: ERC20_READ, functionName: "allowance", args: [getAddress(owner), HUB] })) as bigint;
    return { allowance: a.toString() };
  },
  nonce: async (payer: string, channel: number): Promise<{ nonce: string }> => {
    const n = await withRetry(() => client.readContract({ address: HUB, abi: HUB_ABI, functionName: "accountNonceTracks", args: [getAddress(payer), BigInt(channel)] })) as bigint;
    return { nonce: n.toString() };
  },

  paycard: async (id: string): Promise<PaycardOnchain> => {
    const r = await withRetry(() => client.readContract({
      address: HUB,
      abi: HUB_ABI,
      functionName: "registry",
      args: [id as `0x${string}`],
    })) as any;
    // viem returns an array (positional) for multi-output getters.
    const v = Array.isArray(r) ? r : [r.payer, r.recipient, r.metadataHash, r.totalAllocationPool, r.availableBalance, r.flowVelocityPerSecond, r.genesisTimestamp, r.lifespanSeconds, r.lastCheckpointEpoch, r.residualDeltaRecipient, r.operationalStatus];
    return {
      paycardId: id,
      payer: v[0],
      recipient: v[1],
      metadataHash: v[2],
      totalAllocationPool: String(v[3]),
      availableBalance: String(v[4]),
      flowVelocityPerSecond: String(v[5]),
      genesisTimestamp: Number(v[6]),
      lifespanSeconds: Number(v[7]),
      lastCheckpointEpoch: Number(v[8]),
      residualDeltaRecipient: v[9],
      operationalStatus: Number(v[10]) === 0 ? "Active" : "Terminated",
    };
  },

  recoverPaycards: async (params: { payer?: string; recipient?: string; limit?: number }): Promise<{ results: RecoveredPaycard[]; count: number }> => {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > 9000n ? latest - 9000n : 0n; // public RPC caps getLogs at 10k
    const logs = await client.getLogs({
      address: HUB,
      event: PROVISIONED,
      args: {
        ...(params.payer ? { payer: getAddress(params.payer) } : {}),
        ...(params.recipient ? { recipient: getAddress(params.recipient) } : {}),
      },
      fromBlock,
      toBlock: "latest",
    });
    const results: RecoveredPaycard[] = logs.slice(0, params.limit ?? 20).map((l) => ({
      paycardId: l.args.paycardId as string,
      source: "chain",
      provisioned: {
        payer: l.args.payer as string,
        recipient: l.args.recipient as string,
        metadataHash: l.args.metadataHash as string,
        blockNumber: Number(l.blockNumber),
        transactionHash: l.transactionHash,
      },
    }));
    return { results, count: results.length };
  },

  // Reconstruct the stream list from PaycardProvisioned logs + registry hydrate, so the Deck
  // telemetry works standalone. Bounded to the recent block window (public RPC getLogs cap).
  streams: async (
    q: Record<string, string> = {},
  ): Promise<{ count: number; streams: StreamState[]; authoritative: boolean }> => {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > WINDOW ? latest - WINDOW : 0n;
    const logs = await client.getLogs({
      address: HUB,
      event: PROVISIONED,
      args: {
        ...(q.payer ? { payer: getAddress(q.payer) } : {}),
        ...(q.recipient ? { recipient: getAddress(q.recipient) } : {}),
      },
      fromBlock,
      toBlock: "latest",
    });
    const ids = [...new Set(logs.map((l) => l.args.paycardId as string))];
    const cards = await Promise.all(ids.map((id) => chainReads.paycard(id).catch(() => null)));
    const streams: StreamState[] = cards
      .filter((c): c is PaycardOnchain => c !== null)
      .map((c) => ({
        paycardId: c.paycardId,
        payer: c.payer,
        recipient: c.recipient,
        metadataHash: c.metadataHash,
        totalAllocation: c.totalAllocationPool,
        availableBalance: c.availableBalance,
        velocity: c.flowVelocityPerSecond,
        genesis: c.genesisTimestamp,
        lifespan: c.lifespanSeconds,
        lastCheckpoint: c.lastCheckpointEpoch,
        status: (c.operationalStatus === "Active" ? "Active" : "Terminated") as PaycardStatus,
      }));
    return { count: streams.length, streams, authoritative: false };
  },

  // Per-stream event history from the three Hub events (indexed by paycardId), for LedgerTrails
  // and DeltaCurve. blockTimestamp is omitted (LedgerTrails falls back to block number).
  history: async (
    paycardId: string,
  ): Promise<{ paycardId: string; state: StreamState | null; events: StreamEvent[]; authoritative: boolean }> => {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > WINDOW ? latest - WINDOW : 0n;
    const defs = [
      { name: "PaycardProvisioned", ev: PROVISIONED },
      { name: "SettlementFlushed", ev: SETTLED },
      { name: "ResidualDeltaReclaimed", ev: RECLAIMED },
    ] as const;
    const lists = await Promise.all(
      defs.map((d) =>
        client
          .getLogs({ address: HUB, event: d.ev, args: { paycardId: paycardId as `0x${string}` }, fromBlock, toBlock: "latest" })
          .catch(() => []),
      ),
    );
    const events: StreamEvent[] = [];
    lists.forEach((logs, i) => {
      for (const l of logs as any[]) {
        events.push({
          paycardId,
          eventName: defs[i].name,
          blockNumber: Number(l.blockNumber),
          transactionHash: l.transactionHash,
          logIndex: Number(l.logIndex),
          args: stringifyArgs(l.args),
          recordedAt: Date.now(),
        });
      }
    });
    events.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
    return { paycardId, state: null, events, authoritative: false };
  },
};
