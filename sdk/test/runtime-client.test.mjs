import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";

import { RuntimeClient, RuntimeClientHttpError } from "../dist/runtime-client.js";

test("RuntimeClient discovers Workspaces through the versioned signed route", async () => {
  const account = Wallet.createRandom();
  let captured;
  const client = new RuntimeClient({
    baseUrl: "https://runtime.test",
    fetch: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        interfaceVersion: "1.2.0",
        operationId: "workspace.list",
        walletAddress: account.address,
        workspaces: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const response = await client.discoverWorkspaces(account, { role: "owner" });

  assert.deepEqual(response.workspaces, []);
  assert.equal(captured.url, "https://runtime.test/api/interface/1.2.0/runtime/discover");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.body.operationId, "workspace.list");
  assert.equal(captured.body.subject.walletAddress, account.address);
  assert.equal(captured.body.data.walletAddress, account.address);
  assert.equal(captured.body.data.signatureBinding.operationId, "workspace.list");
});

test("RuntimeClient includes the server error in HTTP failures", () => {
  const error = new RuntimeClientHttpError(405, "https://runtime.test", { error: "Use POST for this Runtime route." });
  assert.equal(error.message, "OpenRails Runtime request failed with HTTP 405: Use POST for this Runtime route.");
});
