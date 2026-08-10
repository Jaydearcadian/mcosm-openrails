import type { ReactNode } from "react";
import { WagmiProvider as BareWagmiProvider } from "wagmi";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { wagmiConfig } from "../lib/wagmi-config";
import { arcTestnet } from "../lib/chain";
import { CircleModularWalletProvider } from "../lib/circleModularWallet";

const queryClient = new QueryClient();

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

export function Providers({ children }: { children: ReactNode }) {
  const content = !PRIVY_APP_ID ? (
    <BareWagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </BareWagmiProvider>
  ) : (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
        loginMethods: ["google", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#d45334",
          logo: "",
        },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>{children}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );

  return <CircleModularWalletProvider>{content}</CircleModularWalletProvider>;
}
