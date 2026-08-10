import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, type Address } from "viem";
import {
  createBundlerClient,
  toWebAuthnAccount,
  type SmartAccount,
} from "viem/account-abstraction";
import type { ToCircleSmartAccountReturnType } from "@circle-fin/modular-wallets-core";
import { arcTestnet } from "./chain";
import {
  classifyCircleError,
  circleErrorLabel,
  resolveCircleConfig,
  type CircleConfigState,
  type CircleErrorState,
  type CircleModularConfig,
} from "./circleModular";

const STORAGE_KEY = "openrails.circle.modular.passkey.v1";

type CircleSmartAccount = ToCircleSmartAccountReturnType;
type CirclePublicClient = ReturnType<typeof createPublicClient>;
type CircleBundlerClient = ReturnType<typeof createBundlerClient>;

export type CircleConnectionStatus =
  | "missing-config"
  | "disconnected"
  | "connecting"
  | "connected"
  | CircleErrorState;

type CircleAuthMode = "Register" | "Login";

export interface CircleWalletConnection {
  address: Address;
  credentialId: string;
  username?: string;
  account: CircleSmartAccount;
  publicClient: CirclePublicClient;
  bundlerClient: CircleBundlerClient;
}

interface StoredPasskey {
  credentialId: string;
  username?: string;
}

interface CircleModularWalletContextValue {
  config: CircleConfigState;
  status: CircleConnectionStatus;
  error: string | null;
  busy: boolean;
  wallet: CircleWalletConnection | null;
  register: (username: string) => Promise<void>;
  login: () => Promise<void>;
  disconnect: () => void;
}

const CircleModularWalletContext = createContext<CircleModularWalletContextValue | undefined>(undefined);

function readStoredPasskey(): StoredPasskey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPasskey>;
    if (typeof parsed.credentialId !== "string" || parsed.credentialId.length === 0 || parsed.credentialId.length > 512) {
      return null;
    }
    return {
      credentialId: parsed.credentialId,
      username: typeof parsed.username === "string" ? parsed.username : undefined,
    };
  } catch {
    return null;
  }
}

function storePasskey(value: StoredPasskey): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function validateUsername(value: string): string {
  const username = value.trim();
  if (!username) throw new Error("Enter a passkey name.");
  if (username.length > 64 || /[\u0000-\u001f\u007f]/.test(username)) {
    throw new Error("Passkey name must be 64 characters or fewer.");
  }
  return username;
}

async function createCircleConnection(config: CircleModularConfig, mode: CircleAuthMode, username?: string) {
  const {
    toCircleSmartAccount,
    toModularTransport,
    toPasskeyTransport,
    toWebAuthnCredential,
    WebAuthnMode,
  } = await import("@circle-fin/modular-wallets-core");
  const passkeyTransport = toPasskeyTransport(config.clientUrl, config.clientKey);
  const modularTransport = toModularTransport(`${config.clientUrl}/arcTestnet`, config.clientKey);
  // Circle 1.0.15 pins viem 2.45.3 while Cockpit uses viem 2.52.0. The runtime transport
  // contract is the same; keep the version bridge at this official SDK boundary only.
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: modularTransport as unknown as Parameters<typeof createPublicClient>[0]["transport"],
  });
  const stored = readStoredPasskey();
  const credential = await toWebAuthnCredential({
    transport: passkeyTransport,
    mode: mode === "Register" ? WebAuthnMode.Register : WebAuthnMode.Login,
    ...(mode === "Register"
      ? { username: validateUsername(username ?? "") }
      : { credentialId: stored?.credentialId }),
  });
  const owner = toWebAuthnAccount({ credential });
  const account = await toCircleSmartAccount({
    client: publicClient as unknown as Parameters<typeof toCircleSmartAccount>[0]["client"],
    owner: owner as unknown as Parameters<typeof toCircleSmartAccount>[0]["owner"],
    ...(username ? { name: username } : stored?.username ? { name: stored.username } : {}),
  });
  const address = await account.getAddress();
  const bundlerClient = createBundlerClient({
    account: account as unknown as SmartAccount,
    client: publicClient,
    chain: arcTestnet,
    transport: modularTransport as unknown as Parameters<typeof createBundlerClient>[0]["transport"],
  });

  return {
    address,
    credentialId: credential.id,
    username: username?.trim() || stored?.username,
    account,
    publicClient,
    bundlerClient,
  } satisfies CircleWalletConnection;
}

export function CircleModularWalletProvider({ children }: { children: ReactNode }) {
  const config = useMemo(
    () => resolveCircleConfig({
      VITE_CIRCLE_CLIENT_KEY: import.meta.env.VITE_CIRCLE_CLIENT_KEY,
      VITE_CIRCLE_CLIENT_URL: import.meta.env.VITE_CIRCLE_CLIENT_URL,
    }),
    [],
  );
  const [status, setStatus] = useState<CircleConnectionStatus>(config.id === "ready" ? "disconnected" : "missing-config");
  const [error, setError] = useState<string | null>(config.id === "missing-config" ? config.reason : null);
  const [wallet, setWallet] = useState<CircleWalletConnection | null>(null);

  const connect = useCallback(
    async (mode: CircleAuthMode, username?: string) => {
      if (config.id !== "ready") {
        setStatus("missing-config");
        setError(config.reason);
        return;
      }
      setStatus("connecting");
      setError(null);
      try {
        const connection = await createCircleConnection(config.config, mode, username);
        storePasskey({ credentialId: connection.credentialId, username: connection.username });
        setWallet(connection);
        setStatus("connected");
      } catch (cause) {
        setWallet(null);
        const nextStatus = classifyCircleError(cause);
        setStatus(nextStatus);
        setError(circleErrorLabel(nextStatus));
      }
    },
    [config],
  );

  const register = useCallback((username: string) => connect("Register", username), [connect]);
  const login = useCallback(() => connect("Login"), [connect]);
  const disconnect = useCallback(() => {
    setWallet(null);
    setError(null);
    setStatus(config.id === "ready" ? "disconnected" : "missing-config");
  }, [config]);

  return (
    <CircleModularWalletContext.Provider
      value={{
        config,
        status,
        error,
        busy: status === "connecting",
        wallet,
        register,
        login,
        disconnect,
      }}
    >
      {children}
    </CircleModularWalletContext.Provider>
  );
}

export function useCircleModularWallet(): CircleModularWalletContextValue {
  const context = useContext(CircleModularWalletContext);
  if (!context) throw new Error("useCircleModularWallet must be used inside CircleModularWalletProvider");
  return context;
}
