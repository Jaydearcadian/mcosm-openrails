/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARC_RPC_URL?: string;
  readonly VITE_CIRCLE_CLIENT_KEY?: string;
  readonly VITE_CIRCLE_CLIENT_URL?: string;
  readonly VITE_OPENRAILS_API_BASE?: string;
  readonly VITE_OPENRAILS_INTERFACE_BASE?: string;
  readonly VITE_OPENRAILS_RELAY_URL?: string;
  readonly VITE_PRIVY_APP_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
