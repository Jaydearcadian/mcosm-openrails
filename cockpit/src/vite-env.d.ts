/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARC_RPC_URL?: string;
  readonly VITE_OPENRAILS_API_BASE?: string;
  readonly VITE_OPENRAILS_RELAY_URL?: string;
  readonly VITE_PRIVY_APP_ID?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
