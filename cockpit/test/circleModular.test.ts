import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";
import { HUB_ABI, USDC_ABI } from "../src/lib/contracts.ts";
import {
  buildCircleSettlementPlan,
  circleErrorLabel,
  classifyCircleError,
  encodeCircleSettlementCalls,
  resolveCircleConfig,
  verifyCircleProvisionEvent,
  verifyCircleVaultState,
} from "../src/lib/circleModular.ts";

const HUB = "0x941C8029F0f912df3fAb7423890ab2359b996D0b";
const USDC = "0x3600000000000000000000000000000000000000";
const PAYER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";

function plan() {
  return buildCircleSettlementPlan({
    hubAddress: HUB,
    usdcAddress: USDC,
    payer: PAYER,
    recipient: RECIPIENT,
    amountUsdc: "1.234567",
    type: "streaming",
    velocityUsdcPerSec: "0.000001",
    lifespanSeconds: "3600",
    memo: "circle-proof",
    workflowId: "WS-PROCUREMENT",
    nonceValue: 7n,
    genesisTimestamp: 1_750_000_000n,
  });
}

test("Circle config is missing until a browser client key is present", () => {
  assert.equal(resolveCircleConfig({}).id, "missing-config");
  assert.equal(resolveCircleConfig({ VITE_CIRCLE_CLIENT_KEY: "browser-client-config" }).id, "ready");
  const normalized = resolveCircleConfig({
    VITE_CIRCLE_CLIENT_KEY: "browser-client-config",
    VITE_CIRCLE_CLIENT_URL: "https://modular-sdk.circle.com/v1/rpc/w3s/buidl///",
  });
  assert.equal(normalized.id, "ready");
  if (normalized.id === "ready") assert.equal(normalized.config.clientUrl, "https://modular-sdk.circle.com/v1/rpc/w3s/buidl");
  assert.equal(resolveCircleConfig({ VITE_CIRCLE_CLIENT_KEY: "browser-client-config", VITE_CIRCLE_CLIENT_URL: "http://localhost" }).id, "missing-config");
});

test("Circle settlement plan uses exact USDC units and payer-bound intent data", () => {
  const prepared = plan();
  assert.equal(prepared.approvalAmount, 1_234_567n);
  assert.equal(prepared.intent.totalAllocationPool, 1_234_567n);
  assert.equal(prepared.intent.flowVelocityPerSecond, 1n);
  assert.equal(prepared.intent.lifespanSeconds, 3600n);
  assert.equal(prepared.intent.nonceValue, 7n);
  assert.equal(prepared.intent.residualDeltaRecipient.toLowerCase(), PAYER.toLowerCase());
  assert.equal(prepared.metadata.workflowId, "WS-PROCUREMENT");

  const calls = encodeCircleSettlementCalls(prepared, "0x1234");
  const approval = decodeFunctionData({ abi: USDC_ABI, data: calls[0].data });
  assert.equal(approval.functionName, "approve");
  assert.equal(approval.args?.[0].toLowerCase(), HUB.toLowerCase());
  assert.equal(approval.args?.[1], 1_234_567n);

  const open = decodeFunctionData({ abi: HUB_ABI, data: calls[1].data });
  assert.equal(open.functionName, "openPaycardChannel");
  assert.equal(open.args?.[8], "0x1234");
  assert.equal(open.args?.[11].toLowerCase(), PAYER.toLowerCase());
});

test("Circle settlement input rejects unsafe decimals and incomplete streaming terms", () => {
  assert.throws(() => buildCircleSettlementPlan({ ...planInput(), amountUsdc: "1.2345671" }), /decimal places/);
  assert.throws(() => buildCircleSettlementPlan({ ...planInput(), recipient: "0x123" }), /Recipient address/);
  assert.throws(() => buildCircleSettlementPlan({ ...planInput(), type: "streaming", velocityUsdcPerSec: "" }), /Velocity/);
  assert.throws(() => buildCircleSettlementPlan({ ...planInput(), type: "streaming", velocityUsdcPerSec: "1", lifespanSeconds: "9007199254740992" }), /safe integer/);
  assert.throws(() => buildCircleSettlementPlan({ ...planInput(), workflowId: "x".repeat(129) }), /Workspace reference/);
});

test("receipt and Vault verification require the Circle smart-account payer and exact terms", () => {
  const prepared = plan();
  const event = {
    paycardId: prepared.intent.paycardId,
    payer: PAYER,
    recipient: RECIPIENT,
    metadataHash: prepared.intent.metadataHash,
    poolAllocation: prepared.intent.totalAllocationPool,
    flowVelocityPerSecond: prepared.intent.flowVelocityPerSecond,
    genesisTimestamp: prepared.intent.genesisTimestamp,
    lifespanSeconds: prepared.intent.lifespanSeconds,
  };
  assert.deepEqual(verifyCircleProvisionEvent(event, prepared, PAYER), { ok: true });
  assert.equal(verifyCircleProvisionEvent({ ...event, payer: RECIPIENT }, prepared, PAYER).ok, false);

  const vault = {
    payer: PAYER,
    recipient: RECIPIENT,
    metadataHash: prepared.intent.metadataHash,
    totalAllocationPool: prepared.intent.totalAllocationPool,
    availableBalance: prepared.intent.totalAllocationPool,
    flowVelocityPerSecond: prepared.intent.flowVelocityPerSecond,
    genesisTimestamp: prepared.intent.genesisTimestamp,
    lifespanSeconds: prepared.intent.lifespanSeconds,
    residualDeltaRecipient: PAYER,
    operationalStatus: 0n,
  };
  assert.deepEqual(verifyCircleVaultState(vault, prepared, PAYER), { ok: true });
  assert.equal(verifyCircleVaultState({ ...vault, totalAllocationPool: 1n }, prepared, PAYER).ok, false);
  assert.equal(verifyCircleVaultState({ ...vault, operationalStatus: 1n }, prepared, PAYER).ok, false);
});

test("Circle lifecycle errors are classified without exposing provider error text", () => {
  assert.equal(classifyCircleError({ name: "NotAllowedError" }), "user-rejected");
  assert.equal(classifyCircleError(new Error("paymaster policy denied")), "sponsorship-denied");
  assert.equal(classifyCircleError(new Error("execution reverted")), "transaction-reverted");
  assert.equal(classifyCircleError(new Error("network unavailable")), "rpc-failure");
  assert.equal(circleErrorLabel("receipt-verification-failure"), "Receipt or live Vault verification failed.");
});

function planInput() {
  return {
    hubAddress: HUB,
    usdcAddress: USDC,
    payer: PAYER,
    recipient: RECIPIENT,
    amountUsdc: "1",
    type: "one-time" as const,
    nonceValue: 0n,
    genesisTimestamp: 1_750_000_000n,
  };
}
