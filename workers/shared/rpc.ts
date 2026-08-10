import { ethers } from "ethers";

export interface RpcEnv {
  ARC_CANTEEN_RPC_URL?: string;
  ARC_RPC_URL: string;
  ARC_RPC_FALLBACK_URL?: string;
  ARC_CHAIN_ID?: string;
}

export function createRpcProvider(env: RpcEnv): ethers.AbstractProvider {
  const urls = [
    ...new Set(
      [env.ARC_CANTEEN_RPC_URL, env.ARC_RPC_URL, env.ARC_RPC_FALLBACK_URL]
        .filter((url): url is string => Boolean(url)),
    ),
  ];
  const chainId = env.ARC_CHAIN_ID ? Number(env.ARC_CHAIN_ID) : undefined;
  const providers = urls.map(
    (url) => new ethers.JsonRpcProvider(url, chainId, { staticNetwork: chainId !== undefined }),
  );
  if (providers.length === 1) return providers[0];
  return new ethers.FallbackProvider(
    providers.map((provider, index) => ({
      provider,
      priority: index + 1,
      weight: 1,
      stallTimeout: 1_200,
    })),
    chainId,
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
