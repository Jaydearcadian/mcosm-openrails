import assert from "node:assert/strict";

const { default: handler } = await import(`file:///tmp/openrails-interface-worker.bundle.js?${Date.now()}`);
const env = {
  ARC_RPC_URL: "https://rpc.testnet.arc.io",
  OPENRAILS_CORS_ORIGIN: "https://openrails.pages.dev",
  OPENRAILS_RUNTIME_ENABLED: "false",
};

async function request(path, init = {}) {
  return handler.fetch(new Request(`https://worker.test${path}`, {
    ...init,
    headers: {
      Origin: "https://openrails.pages.dev",
      ...(init.headers ?? {}),
    },
  }), env);
}

const health = await request("/healthz");
assert.equal(health.status, 200);
assert.equal((await health.json()).network.chainId, "5042002");

const capabilities = await request("/api/interface/1.2.0/capabilities");
assert.equal(capabilities.status, 200);
assert.equal((await capabilities.json()).interfaceVersion, "1.2.0");

const manifest = await request("/api/interface/read/NetworkManifest");
assert.equal(manifest.status, 200);
assert.equal((await manifest.json()).object.networkId, "arc-testnet");

const disabledRuntime = await request("/api/interface/1.2.0/runtime/execute", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
assert.equal(disabledRuntime.status, 503);

const custody = await request("/api/interface/prepare", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ operationId: "network.list", privateKey: "must-not-enter" }),
});
assert.equal(custody.status, 400);

console.log("Interface Worker bundle smoke passed.");
