import assert from "node:assert/strict";
import test from "node:test";
import { SharedInterfaceClient, SharedInterfaceHttpError, SharedInterfaceSafetyError } from "../dist/index.js";

function mockFetch(responseBody, responseOptions = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...responseOptions,
    });
  };
  return { fetch, calls };
}

test("uses the explicit versioned REST path for safe preparation", async () => {
  const { fetch, calls } = mockFetch({ valid: true, broadcasted: false, request: { operationId: "network.get" } });
  const client = new SharedInterfaceClient({
    baseUrl: "https://api.example.test/",
    basePath: "/api/interface/1.2.0/",
    fetch,
    headers: { "X-Client": "sdk-test" },
  });

  const result = await client.prepare({
    operationId: "network.get",
    data: { networkId: "arc-testnet" },
    context: { executionProfile: "direct-wallet-authorized" },
  });

  assert.equal(result.valid, true);
  assert.equal(calls[0].url, "https://api.example.test/api/interface/1.2.0/prepare");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-Client"], "sdk-test");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    operationId: "network.get",
    data: { networkId: "arc-testnet" },
    context: { executionProfile: "direct-wallet-authorized" },
  });
});

test("reads through the same client without inventing an indexer", async () => {
  const { fetch, calls } = mockFetch({ available: false, capabilityStatus: "UNAVAILABLE" });
  const client = new SharedInterfaceClient({ fetch });
  await client.read("CanonicalRecord", "record:missing");
  assert.equal(calls[0].url, "/api/interface/read/CanonicalRecord/record%3Amissing");
});

test("rejects custody fields before a request is made", async () => {
  const { fetch, calls } = mockFetch({});
  const client = new SharedInterfaceClient({ fetch });
  await assert.rejects(
    client.prepare({
      operationId: "network.get",
      data: { networkId: "arc-testnet" },
      context: { privateKey: "not-sent" },
    }),
    (error) => error instanceof SharedInterfaceSafetyError,
  );
  assert.equal(calls.length, 0);
});

test("surfaces HTTP status without treating a response as financial success", async () => {
  const { fetch } = mockFetch({ error: "unavailable" }, { status: 503 });
  const client = new SharedInterfaceClient({ fetch });
  await assert.rejects(
    client.capabilities(),
    (error) => error instanceof SharedInterfaceHttpError
      && error.status === 503
      && error.message === "Shared Interface request failed with HTTP 503",
  );
});
