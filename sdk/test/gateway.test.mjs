import assert from "node:assert/strict";
import test from "node:test";

import { depositForToGateway, depositToGateway, mintFromGateway } from "../dist/gateway.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const signer = { getAddress: async () => ADDRESS };

test("Gateway deposits reject invalid amounts and addresses before contract calls", async () => {
  await assert.rejects(
    () => depositToGateway({ signer, amountBaseUnits: 0n }),
    /amountBaseUnits must be a positive bigint/,
  );
  await assert.rejects(
    () => depositToGateway({ signer, amountBaseUnits: 1n, tokenAddress: ADDRESS.slice(0, -1) }),
    /tokenAddress must be a non-zero EVM address/,
  );
  await assert.rejects(
    () => depositForToGateway({ signer, amountBaseUnits: 1n, depositor: "0x0000000000000000000000000000000000000000" }),
    /depositor must be a non-zero EVM address/,
  );
});

test("Gateway mint rejects empty attestation data before contract calls", async () => {
  await assert.rejects(
    () => mintFromGateway({ signer, attestationPayload: "0x", signature: "0x1234" }),
    /attestationPayload must be non-empty hex data/,
  );
  await assert.rejects(
    () => mintFromGateway({ signer, attestationPayload: "0x1234", signature: "0x" }),
    /signature must be non-empty hex data/,
  );
});
