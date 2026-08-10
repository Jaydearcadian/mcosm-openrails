/**
 * Safe HTTP consumer for the OpenRails Shared Interface REST boundary.
 *
 * This client prepares, validates, verifies, and reads interface envelopes. It
 * deliberately has no signing, custody, relay, or transaction methods.
 */

export interface SharedInterfaceClientOptions {
  /** API origin, for example `https://api.example.com`. Empty means same-origin. */
  baseUrl?: string;
  /** REST path prefix. Set to `/api/interface/1.2.0` for the versioned route aliases. */
  basePath?: string;
  fetch?: SharedInterfaceFetch;
  headers?: Record<string, string>;
}

export type SharedInterfaceFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SharedInterfacePrepareRequest {
  operationId: string;
  data: unknown;
  context: unknown;
}

export interface SharedInterfaceValidateRequest {
  operationId: string;
  direction?: "request" | "response";
  envelope: unknown;
}

export interface SharedInterfaceVerifyRequest {
  operationId?: string;
  direction?: "request" | "response";
  envelope?: unknown;
  record?: unknown;
  policy?: unknown;
}

export interface SharedInterfacePrepareResponse {
  valid: boolean;
  broadcasted: false;
  request: unknown;
}

export class SharedInterfaceSafetyError extends Error {
  constructor(path: string) {
    super(`${path} is not accepted by the safe Shared Interface client`);
    this.name = "SharedInterfaceSafetyError";
  }
}

export class SharedInterfaceHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(status: number, url: string, body: unknown) {
    super(`Shared Interface request failed with HTTP ${status}`);
    this.name = "SharedInterfaceHttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const CUSTODY_FIELD = /(?:private[_-]?key|secret[_-]?key|seed[_-]?phrase|mnemonic|signer[_-]?key)/i;

/** Reject secrets before they can be serialized into an HTTP request. */
export function assertSafeSharedInterfaceInput(value: unknown, path = "input"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeSharedInterfaceInput(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CUSTODY_FIELD.test(key)) throw new SharedInterfaceSafetyError(`${path}.${key}`);
    assertSafeSharedInterfaceInput(child, `${path}.${key}`);
  }
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Shared Interface basePath cannot be empty");
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function jsonBody(value: unknown): string {
  assertSafeSharedInterfaceInput(value);
  return JSON.stringify(value);
}

/**
 * HTTP client for the safe Shared Interface boundary.
 *
 * The default path remains backward-compatible. Pass `basePath` explicitly
 * when a caller wants the versioned `/api/interface/1.2.0` aliases.
 */
export class SharedInterfaceClient {
  private readonly baseUrl: string;
  private readonly basePath: string;
  private readonly fetchImpl: SharedInterfaceFetch;
  private readonly headers: Record<string, string>;

  constructor(options: SharedInterfaceClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.basePath = normalizePath(options.basePath ?? "/api/interface");
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.headers = { ...(options.headers ?? {}) };
  }

  async capabilities<T = unknown>(): Promise<T> {
    return this.request<T>("/capabilities");
  }

  async prepare<T = SharedInterfacePrepareResponse>(body: SharedInterfacePrepareRequest): Promise<T> {
    return this.request<T>("/prepare", { method: "POST", body: jsonBody(body) });
  }

  async validate<T = unknown>(body: SharedInterfaceValidateRequest): Promise<T> {
    return this.request<T>("/validate", { method: "POST", body: jsonBody(body) });
  }

  async verify<T = unknown>(body: SharedInterfaceVerifyRequest): Promise<T> {
    return this.request<T>("/verify", { method: "POST", body: jsonBody(body) });
  }

  async read<T = unknown>(type: string, id?: string): Promise<T> {
    assertSafeSharedInterfaceInput({ type, id });
    const suffix = id === undefined
      ? `/read?type=${encodeURIComponent(type)}`
      : `/read/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
    return this.request<T>(suffix);
  }

  private async request<T>(suffix: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${this.basePath}${suffix}`;
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ...this.headers,
        ...(init.headers ?? {}),
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) throw new SharedInterfaceHttpError(response.status, url, body);
    return body as T;
  }
}
