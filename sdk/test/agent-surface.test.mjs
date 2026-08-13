import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENRAILS_CHAINS,
  assertOpenRailsSurfaceManifest,
  buildOpenRailsDiscoveryEvent,
  buildOpenRailsMarketplaceIndex,
  buildOpenRailsNotificationPayload,
  buildOpenRailsProviderSurfaceRegistration,
  createOpenRailsProviderMiddleware,
  resolveOpenRailsDiscoveryAction,
  verifyOpenRailsProviderSession,
} from "../dist/agent/index.js";

const chain = OPENRAILS_CHAINS["arc-testnet"];
const RECIPIENT = "0x08C07d545f3753D6B75aC27eeeF4733Bc3Af400d";

const surface = {
  version: "openrails-surface-v1",
  surfaceId: "provider.premium-research",
  name: "Provider Premium Research",
  description: "A paid research service exposed through the OpenRails agent surface.",
  type: "api",
  recipient: RECIPIENT,
  settlementChain: chain.settlementChain,
  chainId: chain.chainId,
  token: { symbol: "USDC", address: chain.tokens.USDC.address, decimals: 6 },
  pricing: {
    model: "metered_seconds",
    velocityPerSecondBaseUnits: "10000",
    maxSessionSeconds: 300,
    displayRate: "0.01 USDC/sec",
  },
  session: {
    heartbeatTimeoutMs: 30000,
    stopOnExitSupported: true,
    residualReturn: "stn-delta-flush",
  },
  scope: "premium.research.read",
  endpoints: {
    verifySession: "https://provider.example/api/provider/verify-session",
    receipt: "https://provider.example/api/provider/receipt",
    manifest: "https://provider.example/.well-known/openrails-surface.json",
  },
  openrails: {
    supportedPrimitives: ["railsflow", "railscard_bearer"],
    hub: chain.contracts.hub,
    domainVersion: "2.0.0",
  },
  interop: { x402: true, paymentLinkFallback: true, gatewayFallback: true },
  proof: { status: "arc-testnet-proven", docs: "https://provider.example/docs/openrails-proof" },
};

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("agent discovery produces a validated marketplace and approval-aware tasks", () => {
  const validated = assertOpenRailsSurfaceManifest(surface);
  const index = buildOpenRailsMarketplaceIndex({
    marketplaceId: "openrails.testnet",
    generatedAt: "2026-08-13T00:00:00Z",
    surfaces: [validated],
  });
  const event = buildOpenRailsDiscoveryEvent({
    type: "marketplace.service_arrived",
    openrailsId: "openrails:testnet:surface:1",
    providerId: "provider.example",
    surface: validated,
    occurredAt: "2026-08-13T00:00:00Z",
  });
  const notification = buildOpenRailsNotificationPayload(event, { channel: "local_webhook" });

  assert.equal(index.surfaces[0].surfaceId, surface.surfaceId);
  assert.equal(notification.requiresUserApproval, true);
  assert.equal(notification.authorizesPayment, false);
  assert.deepEqual(resolveOpenRailsDiscoveryAction(event, "quote"), {
    kind: "quote_surface",
    surfaceId: surface.surfaceId,
    openrailsId: "openrails:testnet:surface:1",
    requiresUserApproval: false,
  });
  assert.equal(resolveOpenRailsDiscoveryAction(event, "negotiate").requiresUserApproval, true);
});

test("provider registration validates the manifest and preserves the registration boundary", () => {
  const registration = buildOpenRailsProviderSurfaceRegistration(surface, {
    providerId: "provider.example",
    registerEndpoint: "https://provider.example/api/openrails/register",
  });

  assert.equal(registration.method, "POST");
  assert.equal(registration.body.providerId, "provider.example");
  assert.equal(registration.body.manifest.surfaceId, surface.surfaceId);
  assert.deepEqual(registration.headers, { "content-type": "application/json" });
});

test("provider session verification fails closed and accepts only an explicit valid response", async () => {
  const calls = [];
  const validFetch = async (url, init) => {
    calls.push({ url, init });
    return response(200, { valid: true, session: { sessionId: "session-1", remaining: "10000" } });
  };

  const missing = await verifyOpenRailsProviderSession({
    verifyEndpoint: "https://provider.example/api/provider/verify-session",
    surfaceId: surface.surfaceId,
    fetch: validFetch,
  });
  assert.deepEqual(missing, { allowed: false, status: 402, reason: "missing_session_id" });
  assert.equal(calls.length, 0);

  const allowed = await verifyOpenRailsProviderSession({
    verifyEndpoint: "https://provider.example/api/provider/verify-session",
    sessionId: "session-1",
    surfaceId: surface.surfaceId,
    scope: surface.scope,
    fetch: validFetch,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    sessionId: "session-1",
    surfaceId: surface.surfaceId,
    scope: surface.scope,
  });

  const denied = await verifyOpenRailsProviderSession({
    verifyEndpoint: "https://provider.example/api/provider/verify-session",
    sessionId: "expired-session",
    surfaceId: surface.surfaceId,
    fetch: async () => response(403, { reason: "session_expired" }),
  });
  assert.deepEqual(denied, {
    allowed: false,
    status: 403,
    reason: "session_expired",
    raw: { reason: "session_expired" },
  });

  const unavailable = await verifyOpenRailsProviderSession({
    verifyEndpoint: "https://provider.example/api/provider/verify-session",
    sessionId: "session-1",
    surfaceId: surface.surfaceId,
    fetch: async () => { throw new Error("network unavailable"); },
  });
  assert.deepEqual(unavailable, { allowed: false, status: 503, reason: "verify_unreachable" });
});

test("provider middleware blocks missing sessions and forwards verified sessions", async () => {
  const middleware = createOpenRailsProviderMiddleware({
    verifyEndpoint: "https://provider.example/api/provider/verify-session",
    surfaceId: surface.surfaceId,
    scope: surface.scope,
    fetch: async (_url, init) => {
      const request = JSON.parse(init.body);
      return request.sessionId === "session-1"
        ? response(200, { valid: true, session: { sessionId: "session-1" } })
        : response(403, { reason: "session_forbidden" });
    },
  });

  let denied;
  let nextCalls = 0;
  await middleware(
    { headers: {} },
    {
      status(code) {
        denied = { status: code };
        return { json(body) { denied.body = body; } };
      },
    },
    () => { nextCalls += 1; },
  );
  assert.equal(denied.status, 402);
  assert.equal(denied.body.error, "openrails_session_required");
  assert.equal(nextCalls, 0);

  const allowedRequest = { headers: { "x-openrails-session-id": "session-1" } };
  let allowedResponseCalls = 0;
  await middleware(allowedRequest, {
    status() { throw new Error("verified request must not write an error response"); },
    json() { throw new Error("verified request must not write JSON"); },
  }, () => { allowedResponseCalls += 1; });
  assert.equal(allowedResponseCalls, 1);
  assert.deepEqual(allowedRequest.openrails.session, { valid: true, session: { sessionId: "session-1" } });
});
