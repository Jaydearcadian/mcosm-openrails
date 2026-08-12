/**
 * OpenRails x402 Payment-Gated Gateway — Cloudflare Worker
 *
 * Standalone, serverless x402 gateway that:
 *   1. Returns an HTTP 402 challenge when no payment headers are present.
 *   2. Verifies and settles payments via Circle's Gateway facilitator.
 *   3. Returns a signed OpenRails artifact (metadata + metadataHash) that can
 *      be redeemed into a real on-chain Vault stream.
 *
 * This worker has NO private keys — it is purely read-side verification.
 * The Circle facilitator handles the actual settlement.
 */
import { createGatewayMiddleware, type PaymentRequest, type PaymentResponse } from "@circle-fin/x402-batching/server";
import { ethers } from "ethers";

export interface Env {
  ARC_CHAIN_ID: string;
  ARC_RPC_URL: string;
  ARC_RPC_FALLBACK_URL?: string;
  ARC_USDC_ADDRESS: string;
  ARC_OPENRAILS_HUB_ADDRESS: string;
  X402_PRICE: string;
  X402_NETWORK: string;
  X402_FACILITATOR_URL: string;
  X402_SELLER_ADDRESS: string;
  X402_ADMIN_TOKEN?: string;
}

// ---------------------------------------------------------------------------
// Metadata types (inlined to avoid importing from ../../sdk which is not
// available inside the Cloudflare Worker bundle)
// ---------------------------------------------------------------------------

interface CanonicalMetadataV1 {
  version: "openrails-metadata-v1";
  mode: "railsflow" | "railscard_bearer" | "railscard_recipient_bound";
  originator: string;
  recipient: string;
  token: string;
  amount: string;
  flowVelocityPerSecond: string;
  lifespanSeconds: number;
  workflowId?: string;
  metadataRef?: string;
  descriptionHash?: string;
  expiresAt?: number;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) normalized[key] = normalizeValue(entry);
    }
    return normalized;
  }
  return value;
}

function canonicalizeMetadata(metadata: CanonicalMetadataV1): string {
  return JSON.stringify(normalizeValue(metadata));
}

function hashOpenRailsMetadata(metadata: CanonicalMetadataV1): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalizeMetadata(metadata)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Payment, X-Payment-Response, Payment-Signature, Payment-Required, Payment-Response",
  "Access-Control-Expose-Headers": "Payment-Required, Payment-Response, X-Payment-Response",
};

function jsonResponse(body: Record<string, unknown>, status = 200, extraHeaders?: Headers): Response {
  const headers = new Headers({ "Content-Type": "application/json", ...CORS_HEADERS });
  if (extraHeaders) {
    for (const [k, v] of extraHeaders.entries()) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

const X402_OPENRAILS_SCOPE = "GET /api/x402/openrails-artifact";

// ---------------------------------------------------------------------------
// Express-to-Fetch adapter
// ---------------------------------------------------------------------------
// The Circle createGatewayMiddleware produces Express-style middleware
// (req, res, next). We adapt it to Cloudflare's Fetch API by constructing
// minimal shim objects.
//
// Challenge flow (no Payment-Signature/X-Payment header): middleware sends the 402 challenge
//   via res.end() → we return that response directly.
// Paid flow (Payment-Signature/X-Payment header present): middleware verifies, settles, then
//   may call next() AND/OR res.end(). We must prefer next() because that's
//   the signal to run our artifact handler with req.payment attached.

function runExpressMiddleware(
  middleware: (req: any, res: any, next: any) => void | Promise<void>,
  request: Request,
): Promise<{ responded: true; response: Response } | { responded: false; paymentReq: any; responseHeaders: Headers }> {
  const isPaidRequest = request.headers.has("payment-signature") || request.headers.has("x-payment");

  return new Promise((resolve) => {
    let resolved = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const safeResolve = (val: any) => {
      if (!resolved) {
        resolved = true;
        if (timeout) clearTimeout(timeout);
        resolve(val);
      }
    };

    // Minimal IncomingMessage shim
    const reqShim: Record<string, any> = {
      method: request.method,
      url: new URL(request.url).pathname,
      headers: Object.fromEntries(request.headers.entries()),
    };

    // Minimal ServerResponse shim
    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set("Content-Type", "application/json");
    let capturedBody: string | undefined;

    const resShim: Record<string, any> = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        responseHeaders.set(name, value);
      },
      getHeader(name: string) {
        return responseHeaders.get(name);
      },
      writeHead(status: number, headers?: Record<string, string>) {
        this.statusCode = status;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            responseHeaders.set(k, v);
          }
        }
      },
      end(body?: string) {
        capturedBody = body;
        if (!isPaidRequest) {
          // Challenge response — return directly
          safeResolve({
            responded: true,
            response: new Response(body ?? "", {
              status: this.statusCode,
              headers: responseHeaders,
            }),
          });
        }
        // For paid requests, do NOT resolve here. Wait for next() which
        // fires after the middleware finishes verify+settle and sets req.payment.
        // If next() never fires, the timeout below will fall back to this response.
      },
      status(code: number) {
        this.statusCode = code;
        return resShim;
      },
      json(data: unknown) {
        resShim.end(JSON.stringify(data));
      },
    };

    timeout = setTimeout(() => {
      safeResolve({
        responded: true,
        response: jsonResponse({ error: "Circle x402 facilitator timed out" }, 504),
      });
    }, 25_000);

    const next = () => {
      // Middleware passed — payment was verified and settled, req.payment is set
      safeResolve({ responded: false, paymentReq: reqShim, responseHeaders });
    };

    try {
      const result = middleware(reqShim, resShim, next);
      if (result && typeof (result as any).then === "function") {
        (result as Promise<void>).then(() => {
          // Middleware's async work is done. If we haven't resolved yet
          // (paid request where end() was called but next() wasn't),
          // check if req.payment was set and pass through, otherwise
          // return the captured response.
          if (!resolved) {
            if (reqShim.payment) {
              safeResolve({ responded: false, paymentReq: reqShim, responseHeaders });
            } else {
              safeResolve({
                responded: true,
                response: new Response(capturedBody ?? "", {
                  status: resShim.statusCode,
                  headers: responseHeaders,
                }),
              });
            }
          }
        }).catch((err: any) => {
          console.error("Circle x402 middleware failure", err);
          safeResolve({
            responded: true,
            response: jsonResponse({ error: "Circle x402 facilitator unavailable" }, 502),
          });
        });
      } else {
        // Synchronous middleware — if still unresolved after returning, resolve now
        if (!resolved) {
          if (reqShim.payment) {
            safeResolve({ responded: false, paymentReq: reqShim, responseHeaders });
          } else if (capturedBody !== undefined) {
            safeResolve({
              responded: true,
              response: new Response(capturedBody, {
                status: resShim.statusCode,
                headers: responseHeaders,
              }),
            });
          }
          // else: still waiting for async callback (next or end)
        }
      }
    } catch (err) {
      console.error("Circle x402 middleware failure", err);
      safeResolve({
        responded: true,
        response: jsonResponse({ error: "Circle x402 facilitator unavailable" }, 502),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleX402Artifact(request: Request, env: Env): Promise<Response> {
  const chainId = Number(env.ARC_CHAIN_ID);
  const sellerAddress = env.X402_SELLER_ADDRESS;
  const facilitatorUrl = env.X402_FACILITATOR_URL;
  const network = env.X402_NETWORK;
  const price = env.X402_PRICE;
  const usdcAddress = env.ARC_USDC_ADDRESS;
  const hubAddress = env.ARC_OPENRAILS_HUB_ADDRESS;

  // Create the Circle middleware (stateless, cheap to construct per-request in Workers)
  const gateway = createGatewayMiddleware({
    sellerAddress,
    facilitatorUrl,
    networks: [network],
  });

  // Run the Express-style middleware through our adapter
  const middlewareFn = gateway.require(price);
  const result = await runExpressMiddleware(middlewareFn, request);

  // If the middleware responded directly (402 challenge or error), return that
  if (result.responded) {
    return result.response;
  }

  // Payment was verified and settled — build the OpenRails artifact
  const payment = result.paymentReq.payment;
  if (!payment) {
    return jsonResponse({ error: "Circle x402 payment metadata was not attached" }, 502);
  }
  if (!ethers.isAddress(payment.payer)) {
    return jsonResponse({ error: "Circle x402 payment payer is not an EVM address" }, 502);
  }

  const settlementId = payment.transaction ?? "";
  const descriptionHash = ethers.keccak256(
    ethers.toUtf8Bytes(
      JSON.stringify({
        amount: payment.amount,
        network: payment.network,
        payer: payment.payer,
        scope: X402_OPENRAILS_SCOPE,
        seller: sellerAddress,
        settlementId,
      }),
    ),
  );

  const metadata: CanonicalMetadataV1 = {
    version: "openrails-metadata-v1",
    mode: "railsflow",
    originator: payment.payer,
    recipient: sellerAddress,
    token: usdcAddress,
    amount: payment.amount,
    flowVelocityPerSecond: "0",
    lifespanSeconds: 0,
    metadataRef: settlementId ? `circle-x402:${settlementId}` : "circle-x402:pending",
    descriptionHash,
  };
  const metadataHash = hashOpenRailsMetadata(metadata);

  return jsonResponse({
    success: true,
    message: "Circle x402 payment accepted; OpenRails artifact generated without Vault escrow",
    x402: {
      payer: payment.payer,
      amount: payment.amount,
      network: payment.network,
      settlementId,
      facilitatorUrl,
    },
    openrails: {
      artifactVersion: "openrails-x402-artifact-v1",
      chainId,
      vaultAddress: hubAddress,
      tokenAddress: usdcAddress,
      serviceOrigin: "https://openrails-x402-gateway.workers.dev",
      scope: X402_OPENRAILS_SCOPE,
      metadata,
      metadataHash,
      vaultEscrowClaimed: false,
      openRailsSettlementStage: "metadata_only",
      nextAction:
        "Redeem this artifact into a real Vault escrow: open a Paycard Stream with a separate " +
        "OpenRails wallet signature, binding metadataRef=circle-x402:<settlementId> " +
        "(non-custodial; buyer funds their own escrow). See `npm run smoke:x402:stream`.",
    },
  }, 200, result.responseHeaders);
}

function handleHealth(env: Env): Response {
  return jsonResponse({
    status: "ok",
    service: "openrails-x402-gateway",
    chainId: Number(env.ARC_CHAIN_ID),
    hubAddress: env.ARC_OPENRAILS_HUB_ADDRESS,
    sellerAddress: env.X402_SELLER_ADDRESS,
    facilitatorUrl: env.X402_FACILITATOR_URL,
    price: env.X402_PRICE,
  });
}

// ---------------------------------------------------------------------------
// Worker entrypoint
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // Health check
      if (url.pathname === "/" || url.pathname === "/health") {
        return handleHealth(env);
      }

      // x402-gated OpenRails artifact endpoint
      if (url.pathname === "/api/x402/openrails-artifact") {
        if (request.method !== "GET") {
          return jsonResponse({ error: "Only GET requests allowed" }, 405);
        }
        return handleX402Artifact(request, env);
      }

      return jsonResponse({ error: "Not Found" }, 404);
    } catch (err) {
      console.error("OpenRails x402 gateway failure", err);
      return jsonResponse({ error: "OpenRails x402 gateway unavailable" }, 500);
    }
  },
};
