import { useMemo } from "react";
import { useWallets, type EIP1193Provider } from "@privy-io/react-auth";
import { privyToAccount, type Eip1193Provider } from "../../../sdk/src/adapters/privy";
import type { OpenRailsAccount } from "../../../sdk/src/account";

export interface RuntimeAccountHandle {
  account: OpenRailsAccount;
  signMessage(message: string): Promise<string>;
}

export function useRuntimeAccount(address?: string): {
  ready: boolean;
  handle: RuntimeAccountHandle | null;
  error?: string;
} {
  const { wallets, ready } = useWallets();

  return useMemo(() => {
    if (!ready || !address) return { ready, handle: null };
    const wallet = wallets.find((candidate) => candidate.address.toLowerCase() === address.toLowerCase());
    if (!wallet) {
      return {
        ready,
        handle: null,
        error: "The connected wallet is not ready to sign runtime transitions.",
      };
    }

    let providerPromise: Promise<EIP1193Provider> | undefined;
    const provider: Eip1193Provider = {
      request: async (args) => {
        providerPromise ??= wallet.getEthereumProvider();
        return (await providerPromise).request(args as Parameters<EIP1193Provider["request"]>[0]);
      },
    };
    const account = privyToAccount({ address: wallet.address, provider });
    return {
      ready,
      handle: {
        account,
        signMessage: async (message: string) => {
          providerPromise ??= wallet.getEthereumProvider();
          const result = await (await providerPromise).request({
            method: "personal_sign",
            params: [message, wallet.address],
          });
          if (typeof result !== "string" || !result.startsWith("0x")) {
            throw new Error("The connected wallet returned an invalid message signature.");
          }
          return result;
        },
      },
    };
  }, [address, ready, wallets]);
}
