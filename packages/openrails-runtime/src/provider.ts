import { getAddress } from "ethers";

import { ARC_TESTNET_MANIFEST } from "@openrails/shared-interface";

export interface ArcCallRequest {
  to: string;
  data: string;
}

export interface ArcReadProvider {
  getCode(address: string): Promise<string>;
  call(request: ArcCallRequest): Promise<string>;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

function assertHex(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`Arc RPC returned malformed ${field}`);
  }
  return value;
}

/** Read-only Arc JSON-RPC boundary. It intentionally has no send method. */
export class ArcJsonRpcProvider implements ArcReadProvider {
  private requestId = 0;

  constructor(
    readonly rpcUrl: string = ARC_TESTNET_MANIFEST.rpc.defaultEndpoint,
    fetchImpl?: typeof fetch
  ) {
    // Cloudflare Workers require the global fetch receiver to remain bound.
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  private readonly fetchImpl: typeof fetch;

  async getCode(address: string): Promise<string> {
    return this.request("eth_getCode", [getAddress(address), "latest"]);
  }

  async call(request: ArcCallRequest): Promise<string> {
    return this.request("eth_call", [{ to: getAddress(request.to), data: assertHex(request.data, "call data") }, "latest"]);
  }

  private async request(method: "eth_getCode" | "eth_call", params: unknown[]): Promise<string> {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestId, method, params }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Arc RPC ${method} failed with HTTP ${response.status}`);
    const body = await response.json() as JsonRpcResponse;
    if (body.error) throw new Error(`Arc RPC ${method} error ${body.error.code ?? "unknown"}: ${body.error.message ?? "unknown error"}`);
    return assertHex(body.result, method);
  }
}

export function createArcTestnetProvider(options: {
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
} = {}): ArcJsonRpcProvider {
  return new ArcJsonRpcProvider(options.rpcUrl ?? ARC_TESTNET_MANIFEST.rpc.defaultEndpoint, options.fetchImpl);
}
