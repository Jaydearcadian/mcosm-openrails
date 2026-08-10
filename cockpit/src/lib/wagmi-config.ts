import { createConfig } from "@privy-io/wagmi";
import { arcTestnet } from "./chain";
import { createArcTransport } from "./rpc";

// createConfig from @privy-io/wagmi (not plain wagmi) — its WagmiProvider auto-syncs Privy's
// connected wallets (embedded or external) as wagmi connectors, so every existing wagmi hook
// (useAccount, useSignTypedData, useWriteContract, usePublicClient) keeps working unchanged.
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: createArcTransport(),
  },
});
