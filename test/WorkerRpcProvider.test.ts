import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import { createArcProvider, rpcUrlsFromEnv, safeRpcError } from "../workers/shared/rpc.ts";
import { validateRelayPermit } from "../workers/shared/relay.ts";

test("orders Canteen before public Arc providers and removes duplicates", () => {
  assert.deepEqual(
    rpcUrlsFromEnv({
      ARC_CANTEEN_RPC_URL: "https://canteen.example/rpc",
      ARC_RPC_URL: "https://rpc.testnet.arc.io",
      ARC_RPC_FALLBACK_URL: "https://rpc.testnet.arc.io",
    }),
    ["https://canteen.example/rpc", "https://rpc.testnet.arc.io"],
  );
});

test("uses a direct provider for one endpoint and fallback for multiple endpoints", () => {
  const direct = createArcProvider({ ARC_RPC_URL: "https://rpc.testnet.arc.io" });
  const fallback = createArcProvider({
    ARC_CANTEEN_RPC_URL: "https://canteen.example/rpc",
    ARC_RPC_URL: "https://rpc.testnet.arc.io",
  });
  assert.equal(direct instanceof ethers.JsonRpcProvider, true);
  assert.equal(fallback instanceof ethers.FallbackProvider, true);
});

test("fails closed when no RPC endpoint is configured", () => {
  assert.throws(() => createArcProvider({}), /No Arc RPC provider is configured/);
});

test("redacts tokenized RPC URLs from provider errors", () => {
  const message = safeRpcError(
    new Error("request failed at https://canteen.example/v1/private-token method eth_call"),
  );
  assert.equal(message.includes("private-token"), false);
  assert.match(message, /\[RPC endpoint\]/);
});

test("binds relay permits to the signed payer, Hub, amount, and deadline", () => {
  const payer = "0x1111111111111111111111111111111111111111";
  const hub = "0x2222222222222222222222222222222222222222";
  const permit = {
    owner: payer,
    spender: hub,
    value: "100",
    deadline: 2_000,
    v: 27,
    r: `0x${"00".repeat(32)}`,
    s: `0x${"00".repeat(32)}`,
  };

  assert.equal(validateRelayPermit(permit, payer, hub, 100n, 1_000), null);
  assert.match(
    validateRelayPermit({ ...permit, spender: payer }, payer, hub, 100n, 1_000) ?? "",
    /spender/,
  );
  assert.match(validateRelayPermit({ ...permit, value: "99" }, payer, hub, 100n, 1_000) ?? "", /value/);
  assert.match(validateRelayPermit({ ...permit, deadline: 999 }, payer, hub, 100n, 1_000) ?? "", /expired/);
});
