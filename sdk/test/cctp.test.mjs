import assert from "node:assert/strict";
import test from "node:test";
import {
  CCTP_ARC_TESTNET,
  cctpWorkspaceFundingExtension,
  getCctpAttestationStatus,
  prepareCctpFunding,
  prepareCctpReceiveMessage,
} from "../dist/cctp.js";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const WORKSPACE = { type: "Workspace", id: "workspace:cctp-test" };

test("prepares source burn and Arc mint destination for a Workspace direct payment", () => {
  const plan = prepareCctpFunding({
    source: "sepolia",
    amountBaseUnits: 1_000_000n,
    mintRecipient: RECIPIENT,
    maxFeeBaseUnits: 1_000n,
    workspaceRef: WORKSPACE,
    paymentMode: "direct",
  });
  assert.equal(plan.destination.domain, 26);
  assert.equal(plan.destination.messageTransmitterV2, CCTP_ARC_TESTNET.messageTransmitterV2);
  assert.equal(plan.source.domain, 0);
  assert.equal(plan.workspaceFunding?.paymentMode, "direct");
  assert.equal(plan.workspaceFunding?.status, "PREPARED");
  assert.equal(plan.calls.length, 2);
  assert.notEqual(plan.calls[0].data, "0x");
  assert.notEqual(plan.calls[1].data, "0x");
  assert.equal(plan.execution.broadcasts, false);
});

test("prepares a streaming funding record without moving per-drip value cross-chain", () => {
  const plan = prepareCctpFunding({
    source: "baseSepolia",
    amountBaseUnits: 5_000_000n,
    mintRecipient: RECIPIENT,
    destinationCaller: RECIPIENT,
    maxFeeBaseUnits: 1_000n,
    minFinalityThreshold: 2000,
    workspaceRef: WORKSPACE,
    paymentMode: "streaming",
  });
  assert.equal(plan.source.domain, 6);
  assert.equal(plan.workspaceFunding?.paymentMode, "streaming");
  assert.equal(plan.workspaceFunding?.amountBaseUnits, "5000000");
  assert.equal(plan.destinationCaller.length, 66);
});

test("prepares the one-time destination receiveMessage call after attestation", () => {
  const plan = prepareCctpReceiveMessage({ message: "0x1234", attestation: "0xabcd" });
  assert.equal(plan.call.to, CCTP_ARC_TESTNET.messageTransmitterV2);
  assert.match(plan.call.data, /^0x[0-9a-f]+$/i);
  assert.equal(plan.execution.consumesMessageNonce, true);
});

test("reads CCTP attestation state without broadcasting or mutating payment state", async () => {
  let request;
  const result = await getCctpAttestationStatus({
    source: "sepolia",
    transactionHash: `0x${"22".repeat(32)}`,
    apiBaseUrl: "https://iris.example.test",
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ messages: [{ status: "complete", message: "0x1234", attestation: "0xabcd" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.message, "0x1234");
  assert.equal(result.attestation, "0xabcd");
  assert.match(request.url, /\/v2\/messages\/0\?transactionHash=0x(?:22){32}$/);
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.body, undefined);
});

test("workspace funding extension preserves evidence state and rejects invalid hashes", () => {
  const extension = cctpWorkspaceFundingExtension({
    protocol: "circle-cctp-v2",
    workspaceRef: WORKSPACE,
    sourceNetwork: "ethereum-sepolia",
    sourceDomain: 0,
    destinationNetwork: "arc-testnet",
    destinationDomain: 26,
    paymentMode: "direct",
    amountBaseUnits: "1000000",
    mintRecipient: RECIPIENT,
    status: "BURN_CONFIRMED",
    burnTransactionHash: `0x${"11".repeat(32)}`,
    messageNonce: "7",
  });
  assert.equal(extension["x-openrails-cctp-funding"].status, "BURN_CONFIRMED");
  assert.throws(() => cctpWorkspaceFundingExtension({
    ...extension["x-openrails-cctp-funding"],
    burnTransactionHash: "0x12",
  }), /burnTransactionHash must be a 32-byte transaction hash/);
  assert.throws(() => cctpWorkspaceFundingExtension({
    ...extension["x-openrails-cctp-funding"],
    destinationDomain: 0,
  }), /destinationDomain must be 26/);
  assert.throws(() => cctpWorkspaceFundingExtension({
    ...extension["x-openrails-cctp-funding"],
    sourceNetwork: "unknown-testnet",
  }), /sourceNetwork and sourceDomain must match/);
  assert.throws(() => cctpWorkspaceFundingExtension({
    ...extension["x-openrails-cctp-funding"],
    status: "MINT_CONFIRMED",
    mintTransactionHash: undefined,
  }), /MINT_CONFIRMED funding requires mintTransactionHash/);
});

test("CCTP plans reject invalid values before producing wallet calls", () => {
  assert.throws(() => prepareCctpFunding({ source: "sepolia", amountBaseUnits: 0n, mintRecipient: RECIPIENT, maxFeeBaseUnits: 0n }), /amountBaseUnits must be a positive bigint/);
  assert.throws(() => prepareCctpFunding({ source: "sepolia", amountBaseUnits: 1n, mintRecipient: RECIPIENT, maxFeeBaseUnits: -1n }), /maxFeeBaseUnits must be a non-negative bigint/);
  assert.throws(() => prepareCctpFunding({ source: "sepolia", amountBaseUnits: 1n, mintRecipient: RECIPIENT, maxFeeBaseUnits: 2n }), /maxFeeBaseUnits cannot exceed amountBaseUnits/);
  assert.throws(() => prepareCctpReceiveMessage({ message: "0x", attestation: "0xabcd" }), /message must be non-empty hex data/);
});
