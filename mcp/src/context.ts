/** Runtime configuration for the safe-only Shared Interface MCP surface. */
import { getArcTestnetManifest, type NetworkManifest } from "openrails-sdk";

export interface OpenRailsMcpConfig {
  networkMode: string;
  chainId: number;
  rpcUrl: string;
  hubAddress: string;
  usdcAddress: string;
  relayUrl: string;
  appBaseUrl: string;
  explorerBaseUrl: string;
}

export interface OpenRailsContext {
  config: OpenRailsMcpConfig;
  manifest: NetworkManifest;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env ${name}`);
  return value;
}

export function buildContext(): OpenRailsContext {
  const config: OpenRailsMcpConfig = {
    networkMode: env("OPENRAILS_NETWORK_MODE", "arc-testnet"),
    chainId: Number(env("OPENRAILS_CHAIN_ID", "5042002")),
    rpcUrl: env("OPENRAILS_RPC_URL", "https://rpc.testnet.arc.io"),
    hubAddress: env("OPENRAILS_HUB_ADDRESS", "0x941C8029F0f912df3fAb7423890ab2359b996D0b"),
    usdcAddress: env("OPENRAILS_USDC_ADDRESS", "0x3600000000000000000000000000000000000000"),
    relayUrl: env("OPENRAILS_RELAY_URL", "https://openrails-reconciliation-worker.microcosm.workers.dev"),
    appBaseUrl: env("OPENRAILS_APP_BASE_URL", "https://openrails.pages.dev"),
    explorerBaseUrl: env("OPENRAILS_EXPLORER_BASE_URL", "https://testnet.arcscan.app"),
  };

  return {
    config,
    manifest: getArcTestnetManifest(),
  };
}
