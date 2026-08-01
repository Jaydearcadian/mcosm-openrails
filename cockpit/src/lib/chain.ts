import { defineChain } from "viem";

const managedRpcUrl = import.meta.env.VITE_ARC_RPC_URL?.trim();

export const ARC_RPC_URLS = [
  managedRpcUrl,
  "https://rpc.testnet.arc.io",
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.blockdaemon.testnet.arc.io",
].filter((url): url is string => Boolean(url));

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: ARC_RPC_URLS },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});
