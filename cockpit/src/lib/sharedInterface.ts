const PUBLIC_INTERFACE_BASE = "https://openrails-interface-worker.microcosm.workers.dev";

function configuredBase(...values: Array<string | undefined>): string | undefined {
  const value = values.find((candidate) => candidate?.trim());
  return value?.trim().replace(/\/$/, "");
}

const API_BASE = import.meta.env.DEV
  ? ""
  : configuredBase(
      import.meta.env.VITE_OPENRAILS_INTERFACE_BASE,
      import.meta.env.VITE_OPENRAILS_API_BASE,
    ) ?? PUBLIC_INTERFACE_BASE;

export interface SharedInterfaceCapabilities {
  interfaceVersion: string;
  network: { networkId: string; chainId: string };
  capabilities: Array<Record<string, unknown>>;
  safeSurface: {
    canRead?: boolean;
    canPrepare?: boolean;
    canValidate?: boolean;
    canVerify?: boolean;
    canSign?: boolean;
    canBroadcast?: boolean;
    broadcasts?: boolean;
    canonicalRecords?: string;
  };
  canonicalRecord?: Record<string, unknown>;
  canonicalRecordCapability?: Record<string, unknown>;
  circleGasStation?: Record<string, unknown>;
}

export interface SharedOperationContext {
  executionProfile?: "direct-wallet-authorized" | "delegated-runtime";
  subject?: Record<string, unknown>;
  network?: { networkId: string; chainId: string };
  workspaceRef?: Record<string, unknown>;
  pathRef?: Record<string, unknown>;
  intentRef?: Record<string, unknown>;
  proposalRef?: Record<string, unknown>;
  pactRef?: Record<string, unknown>;
  canonicalRecordRef?: Record<string, unknown>;
  proofRefs?: Array<Record<string, unknown>>;
  provenance?: Record<string, unknown>;
  createdAt?: string;
}

export interface SharedOperationPreparation {
  operationId: string;
  data: unknown;
  context: SharedOperationContext;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${path} -> HTTP ${response.status}`);
  return body;
}

export const sharedInterface = {
  capabilities: () => request<SharedInterfaceCapabilities>("/api/interface/capabilities"),
  prepare: (body: SharedOperationPreparation) => request<{ valid: boolean; broadcasted: false; request: unknown }>(
    "/api/interface/prepare",
    { method: "POST", body: JSON.stringify(body) },
  ),
  validate: (body: { operationId: string; direction?: "request" | "response"; envelope: unknown }) => request<unknown>(
    "/api/interface/validate",
    { method: "POST", body: JSON.stringify(body) },
  ),
  verify: (body: { operationId?: string; direction?: "request" | "response"; envelope?: unknown; record?: unknown; policy?: unknown }) => request<unknown>(
    "/api/interface/verify",
    { method: "POST", body: JSON.stringify(body) },
  ),
  read: (type: string, id?: string) => request<unknown>(
    id
      ? `/api/interface/read/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
      : `/api/interface/read?type=${encodeURIComponent(type)}`,
  ),
};
