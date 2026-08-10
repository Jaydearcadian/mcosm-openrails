import { getAddress, randomBytes } from "ethers";

import type { OpenRailsAccount } from "./account";
import {
  ARC_TESTNET_MANIFEST,
  RUNTIME_TRANSITION_TYPES,
  hashRuntimePayload,
  runtimeTransitionDomain,
  runtimeTransitionMessage,
} from "./shared-interface";
import type { RuntimeSignatureBinding } from "./generated/shared-interface";

export type RuntimeRole = "owner" | "delegate";

const RUNTIME_AUTHORIZATION_CLASSES: Record<string, string> = {
  "workspace.register": "RELAY_SIGNED_ENVELOPE",
  "actor.register": "RELAY_SIGNED_ENVELOPE",
  "path.activate": "WALLET_SIGNATURE",
  "path.revoke": "WALLET_SIGNATURE",
  "intent.prepare": "PREPARE_ONLY",
  "proposal.evaluate": "PREPARE_ONLY",
  "proposal.submit": "RELAY_SIGNED_ENVELOPE",
  "pact.sign": "RELAY_SIGNED_ENVELOPE",
  "proof.submit": "RELAY_SIGNED_ENVELOPE",
  "proof.verify": "PUBLIC_READ",
};

export interface RuntimeClientOptions {
  baseUrl?: string;
  basePath?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
  signatureLifetimeSeconds?: number;
}

export interface RuntimeRequestReferences {
  workspaceRef?: unknown;
  pathRef?: unknown;
  intentRef?: unknown;
  proposalRef?: unknown;
  decisionRef?: unknown;
  pactRef?: unknown;
  canonicalRecordRef?: unknown;
  proofRefs?: unknown;
}

export interface RuntimeExecuteOptions extends RuntimeRequestReferences {
  role: RuntimeRole;
  nonce?: string | bigint;
  issuedAt?: string;
  expiresAt?: string;
}

export class RuntimeClientHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(status: number, url: string, body: unknown) {
    super(`OpenRails Runtime request failed with HTTP ${status}`);
    this.name = "RuntimeClientHttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function randomNonce(): string {
  const hex = Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex}`).toString();
}

function assertLifetime(seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 900) {
    throw new RangeError("Runtime signature lifetime must be between 1 and 900 seconds.");
  }
}

function normalizePath(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) throw new Error("Runtime basePath cannot be empty.");
  return `/${trimmed}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Runtime transition data must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

/**
 * HTTP client for the signed, non-custodial OpenRails Runtime boundary.
 *
 * The client owns no private key. It asks the injected account to sign an
 * EIP-712 transition, then submits that signed envelope to the Runtime.
 */
export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly basePath: string;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly headers: Record<string, string>;
  private readonly signatureLifetimeSeconds: number;

  constructor(options: RuntimeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.basePath = normalizePath(options.basePath ?? "/api/interface/1.2.0/runtime");
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.headers = { ...(options.headers ?? {}) };
    this.signatureLifetimeSeconds = options.signatureLifetimeSeconds ?? 600;
    assertLifetime(this.signatureLifetimeSeconds);
  }

  async signTransition(
    operationId: string,
    unsignedData: unknown,
    account: OpenRailsAccount,
    options: RuntimeExecuteOptions,
  ): Promise<Record<string, unknown>> {
    const data = asRecord(unsignedData);
    const signer = getAddress(await account.getAddress());
    const issuedAt = options.issuedAt ?? new Date().toISOString();
    const expiresAt = options.expiresAt
      ?? new Date(Date.parse(issuedAt) + this.signatureLifetimeSeconds * 1000).toISOString();
    if (!Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(expiresAt))) {
      throw new RangeError("Runtime transition timestamps must be valid ISO timestamps.");
    }
    if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new RangeError("Runtime transition expiresAt must be after issuedAt.");

    const binding = {
      signatureStandard: "eip-712" as const,
      primaryType: "OpenRailsRuntimeTransition" as const,
      signaturePurpose: "offchain-runtime" as const,
      operationId,
      payloadHash: hashRuntimePayload(data),
      signer,
      signature: "0x",
      nonce: String(options.nonce ?? randomNonce()),
      issuedAt,
      expiresAt,
      chainId: String(ARC_TESTNET_MANIFEST.chainId),
      anchorContract: ARC_TESTNET_MANIFEST.runtime.anchorContract,
      domain: ARC_TESTNET_MANIFEST.runtime.signatureDomain,
    } satisfies RuntimeSignatureBinding;

    binding.signature = await account.signTypedData(
      runtimeTransitionDomain(binding),
      RUNTIME_TRANSITION_TYPES,
      runtimeTransitionMessage(binding),
    );

    return {
      ...data,
      signatureBinding: binding,
    };
  }

  async execute<T = unknown>(
    operationId: string,
    unsignedData: unknown,
    account: OpenRailsAccount,
    options: RuntimeExecuteOptions,
  ): Promise<T> {
    const data = await this.signTransition(operationId, unsignedData, account, options);
    const signer = getAddress(await account.getAddress());
    const request = {
      interfaceVersion: "1.2.0",
      executionProfile: "delegated-runtime" as const,
      operationId,
      capability: operationId,
      authorizationClass: RUNTIME_AUTHORIZATION_CLASSES[operationId] ?? "RELAY_SIGNED_ENVELOPE",
      subject: { walletAddress: signer, role: options.role },
      network: { networkId: ARC_TESTNET_MANIFEST.networkId, chainId: String(ARC_TESTNET_MANIFEST.chainId) },
      ...Object.fromEntries(Object.entries(options).filter(([key]) => key.endsWith("Ref") || key === "proofRefs")),
      data,
      provenance: {
        source: "wallet-signed" as const,
        authority: "openrails-sdk",
        evidenceLevel: "runtime-observed" as const,
        observedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };
    return this.post<T>("/execute", request);
  }

  async ingestPath<T = unknown>(path: unknown): Promise<T> {
    return this.post<T>("/path", { path });
  }

  private async post<T>(suffix: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${this.basePath}${suffix}`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(body),
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (!response.ok) throw new RuntimeClientHttpError(response.status, url, parsed);
    return parsed as T;
  }
}
