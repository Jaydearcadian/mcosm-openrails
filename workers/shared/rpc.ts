import { ethers } from "ethers";

export interface ArcRpcEnv {
  ARC_CANTEEN_RPC_URL?: string;
  ARC_RPC_URL?: string;
  ARC_RPC_FALLBACK_URL?: string;
  ARC_CHAIN_ID?: string;
}

export function rpcUrlsFromEnv(env: ArcRpcEnv): string[] {
  const urls = [env.ARC_CANTEEN_RPC_URL, env.ARC_RPC_URL, env.ARC_RPC_FALLBACK_URL]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));
  return [...new Set(urls)];
}

export function createRpcProvider(env: ArcRpcEnv): ethers.AbstractProvider {
  const urls = rpcUrlsFromEnv(env);
  if (urls.length === 0) throw new Error("No Arc RPC provider is configured");

  const chainId = Number(env.ARC_CHAIN_ID ?? "5042002");
  const network = Number.isSafeInteger(chainId) && chainId > 0 ? chainId : undefined;
  const providers = urls.map(
    (url) => new ethers.JsonRpcProvider(url, network, { staticNetwork: network !== undefined }),
  );
  if (providers.length === 1) return providers[0];
  return new ethers.FallbackProvider(
    providers.map((provider, index) => ({
      provider,
      priority: index + 1,
      stallTimeout: 2_000,
      weight: 1,
    })),
    network,
    { quorum: 1 },
  );
}

export const createArcProvider = createRpcProvider;

export function safeRpcError(error: unknown, fallback = "Arc RPC request failed"): string {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return (message || fallback)
    .replace(/https?:\/\/[^\s"']+/gi, "[RPC endpoint]")
    .slice(0, 300);
}
