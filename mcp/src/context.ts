/**
 * Build the runtime context (config + SDK objects) from environment variables.
 *
 * The signer is agnostic: for dev, set OPENRAILS_MCP_SIGNER_KEY (a raw key) and it is
 * wrapped via the SDK's ethers adapter into an OpenRailsAccount. For prod, swap in a
 * Turnkey/Privy account (see openrails-sdk/adapters). Read-only tools work without a key.
 *
 * Gasless by default: opens/claims go through the RelayClient, so this wallet never needs
 * gas management — the keeper sponsors gas; escrow flows from the signer per the signed intent.
 */
import { ethers } from 'ethers';
import { LeptonOpenRailsClient, RelayClient } from 'openrails-sdk';
import { ethersToSubmitter } from 'openrails-sdk/adapters/ethers';

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
  provider: ethers.JsonRpcProvider;
  relay: RelayClient;
  /** Present only when a signer key is configured. */
  signerAddress?: string;
  /** Throws a clear error if no signer is configured. */
  requireClient(): Promise<LeptonOpenRailsClient>;
  requireAccount(): Promise<ReturnType<typeof ethersToSubmitter>>;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env ${name}`);
  return v;
}

export function buildContext(): OpenRailsContext {
  const config: OpenRailsMcpConfig = {
    networkMode: env('OPENRAILS_NETWORK_MODE', 'arc-testnet'),
    chainId: Number(env('OPENRAILS_CHAIN_ID', '5042002')),
    rpcUrl: env('OPENRAILS_RPC_URL', 'https://rpc.testnet.arc.io'),
    hubAddress: env('OPENRAILS_HUB_ADDRESS', '0x941C8029F0f912df3fAb7423890ab2359b996D0b'),
    usdcAddress: env('OPENRAILS_USDC_ADDRESS', '0x3600000000000000000000000000000000000000'),
    relayUrl: env('OPENRAILS_RELAY_URL', 'https://openrails-reconciliation-worker.microcosm.workers.dev'),
    appBaseUrl: env('OPENRAILS_APP_BASE_URL', 'https://openrails.pages.dev'),
    explorerBaseUrl: env('OPENRAILS_EXPLORER_BASE_URL', 'https://testnet.arcscan.app'),
  };

  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
  const relay = new RelayClient({ baseUrl: config.relayUrl });

  const key = process.env.OPENRAILS_MCP_SIGNER_KEY;
  const wallet = key ? new ethers.Wallet(key, provider) : undefined;
  const account = wallet ? ethersToSubmitter(wallet) : undefined;

  return {
    config,
    provider,
    relay,
    signerAddress: wallet?.address,
    async requireAccount() {
      if (!account) throw new Error('No signer configured. Set OPENRAILS_MCP_SIGNER_KEY (dev) or wire a Turnkey/Privy account.');
      return account;
    },
    async requireClient() {
      if (!account) throw new Error('No signer configured. Set OPENRAILS_MCP_SIGNER_KEY (dev) or wire a Turnkey/Privy account.');
      return LeptonOpenRailsClient.fromAccount(account, config.hubAddress, config.chainId);
    },
  };
}
