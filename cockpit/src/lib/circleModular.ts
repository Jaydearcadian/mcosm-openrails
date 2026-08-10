import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { HUB_ABI, USDC_ABI } from "./contracts.ts";
import {
  type CanonicalMetadataV1,
  type OpenRailsIntentV1,
  OPENRAILS_EIP712_TYPES,
  buildMetadataBoundPaycardId,
  buildOpenRailsDomain,
  hashOpenRailsMetadata,
  ZERO_ADDRESS,
} from "./intents.ts";

export const CIRCLE_MODULAR_CLIENT_URL = "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
export const ARC_CHAIN_ID = 5042002;
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as Address;

const MAX_UINT256 = (1n << 256n) - 1n;

export interface CircleBrowserEnvironment {
  VITE_CIRCLE_CLIENT_KEY?: string;
  VITE_CIRCLE_CLIENT_URL?: string;
}

export interface CircleModularConfig {
  clientKey: string;
  clientUrl: string;
}

export type CircleConfigState =
  | { id: "missing-config"; reason: string }
  | { id: "ready"; config: CircleModularConfig };

export function resolveCircleConfig(env: CircleBrowserEnvironment): CircleConfigState {
  const clientKey = env.VITE_CIRCLE_CLIENT_KEY?.trim();
  const clientUrl = (env.VITE_CIRCLE_CLIENT_URL || CIRCLE_MODULAR_CLIENT_URL).trim().replace(/\/+$/, "");

  if (!clientKey) {
    return { id: "missing-config", reason: "Circle Client Key is not configured." };
  }

  try {
    const parsed = new URL(clientUrl);
    if (parsed.protocol !== "https:") throw new Error("Circle Client URL must use HTTPS.");
  } catch {
    return { id: "missing-config", reason: "Circle Client URL must be a valid HTTPS URL." };
  }

  return { id: "ready", config: { clientKey, clientUrl } };
}

export class CircleSettlementInputError extends Error {
  readonly code = "CIRCLE_SETTLEMENT_INPUT_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "CircleSettlementInputError";
  }
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new CircleSettlementInputError(`${label} must be a valid address.`);
  return getAddress(value);
}

function parseFixedUnits(value: string, label: string, decimals: number, allowZero = false): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new CircleSettlementInputError(`${label} must be a decimal number.`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new CircleSettlementInputError(`${label} supports at most ${decimals} decimal places.`);
  }

  const scaled = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (!allowZero && scaled <= 0n) throw new CircleSettlementInputError(`${label} must be greater than zero.`);
  if (scaled > MAX_UINT256) throw new CircleSettlementInputError(`${label} is too large.`);
  return scaled;
}

function parseSeconds(value: string, label: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new CircleSettlementInputError(`${label} must be a whole number of seconds.`);
  const seconds = BigInt(normalized);
  if (seconds <= 0n || seconds > MAX_UINT256) throw new CircleSettlementInputError(`${label} must be greater than zero.`);
  return seconds;
}

export interface CircleSettlementInput {
  hubAddress: string;
  usdcAddress: string;
  payer: string;
  recipient: string;
  amountUsdc: string;
  type: "one-time" | "streaming";
  velocityUsdcPerSec?: string;
  lifespanSeconds?: string;
  memo?: string;
  workflowId?: string;
  nonceValue: bigint;
  genesisTimestamp?: bigint;
}

export interface CircleUserOperationCall {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface CircleSettlementPlan {
  payer: Address;
  hubAddress: Address;
  usdcAddress: Address;
  approvalAmount: bigint;
  metadata: CanonicalMetadataV1;
  intent: OpenRailsIntentV1;
  domain: ReturnType<typeof buildOpenRailsDomain>;
  calls: readonly CircleUserOperationCall[];
}

export function buildCircleSettlementPlan(input: CircleSettlementInput): CircleSettlementPlan {
  const hubAddress = normalizeAddress(input.hubAddress, "Hub address");
  const usdcAddress = normalizeAddress(input.usdcAddress, "USDC address");
  const payer = normalizeAddress(input.payer, "Payer address");
  const recipient = normalizeAddress(input.recipient, "Recipient address");
  const amount = parseFixedUnits(input.amountUsdc, "Amount", 6);
  const isOneTime = input.type === "one-time";
  const flowVelocityPerSecond = isOneTime
    ? 0n
    : parseFixedUnits(input.velocityUsdcPerSec ?? "", "Velocity", 6);
  const lifespanSeconds = isOneTime
    ? 0n
    : parseSeconds(input.lifespanSeconds ?? "", "Lifespan");
  if (lifespanSeconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CircleSettlementInputError("Lifespan must be no greater than the JavaScript safe integer limit.");
  }
  const memo = input.memo?.trim() || undefined;
  const workflowId = input.workflowId?.trim() || undefined;

  if (memo && memo.length > 256) throw new CircleSettlementInputError("Memo must be 256 characters or fewer.");
  if (workflowId && workflowId.length > 128) throw new CircleSettlementInputError("Workspace reference must be 128 characters or fewer.");

  const metadata: CanonicalMetadataV1 = {
    version: "openrails-metadata-v1",
    mode: "railsflow",
    originator: payer,
    recipient,
    token: usdcAddress,
    amount: amount.toString(),
    flowVelocityPerSecond: flowVelocityPerSecond.toString(),
    lifespanSeconds: Number(lifespanSeconds),
    ...(workflowId ? { workflowId } : {}),
    ...(memo ? { metadataRef: memo } : {}),
  };
  const metadataHash = hashOpenRailsMetadata(metadata);
  const nonceChannel = 0n;
  const nonceValue = input.nonceValue;
  if (nonceValue < 0n || nonceValue > MAX_UINT256) {
    throw new CircleSettlementInputError("Nonce value is invalid.");
  }
  const paycardId = buildMetadataBoundPaycardId({ payer, nonceChannel, nonceValue, metadataHash });
  const genesisTimestamp = input.genesisTimestamp ?? BigInt(Math.floor(Date.now() / 1000));
  if (genesisTimestamp <= 0n || genesisTimestamp > MAX_UINT256) {
    throw new CircleSettlementInputError("Genesis timestamp is invalid.");
  }

  const intent: OpenRailsIntentV1 = {
    paycardId,
    metadataHash,
    recipient,
    totalAllocationPool: amount,
    flowVelocityPerSecond,
    genesisTimestamp,
    lifespanSeconds,
    residualDeltaRecipient: payer,
    nonceChannel,
    nonceValue,
  };
  const domain = buildOpenRailsDomain(ARC_CHAIN_ID, hubAddress);
  const plan: CircleSettlementPlan = {
    payer,
    hubAddress,
    usdcAddress,
    approvalAmount: amount,
    metadata,
    intent,
    domain,
    calls: [],
  };
  return { ...plan, calls: encodeCircleSettlementCalls(plan, "0x") };
}

export function encodeCircleSettlementCalls(
  plan: Omit<CircleSettlementPlan, "calls"> | CircleSettlementPlan,
  envelopeSignature: Hex,
): readonly [CircleUserOperationCall, CircleUserOperationCall] {
  const approvalData = encodeFunctionData({
    abi: USDC_ABI,
    functionName: "approve",
    args: [plan.hubAddress, plan.approvalAmount],
  });
  const openData = encodeFunctionData({
    abi: HUB_ABI,
    functionName: "openPaycardChannel",
    args: [
      plan.intent.paycardId,
      plan.intent.metadataHash,
      plan.intent.recipient,
      plan.intent.totalAllocationPool,
      plan.intent.flowVelocityPerSecond,
      plan.intent.genesisTimestamp,
      plan.intent.lifespanSeconds,
      plan.payer,
      envelopeSignature,
      plan.intent.nonceChannel,
      plan.intent.nonceValue,
      plan.payer,
    ],
  });
  return [
    { to: plan.usdcAddress, data: approvalData, value: 0n },
    { to: plan.hubAddress, data: openData, value: 0n },
  ];
}

export interface CircleProvisionEvent {
  paycardId: string;
  payer: string;
  recipient: string;
  metadataHash: string;
  poolAllocation: bigint | string | number;
  flowVelocityPerSecond: bigint | string | number;
  genesisTimestamp: bigint | string | number;
  lifespanSeconds: bigint | string | number;
}

export interface CircleVaultState {
  payer: string;
  recipient: string;
  metadataHash: string;
  totalAllocationPool: bigint | string | number;
  availableBalance: bigint | string | number;
  flowVelocityPerSecond: bigint | string | number;
  genesisTimestamp: bigint | string | number;
  lifespanSeconds: bigint | string | number;
  residualDeltaRecipient?: string;
  operationalStatus: bigint | string | number;
}

export type CircleVerification = { ok: true } | { ok: false; reason: string };

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameBytes32(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function asBigInt(value: bigint | string | number, label: string): bigint {
  try {
    return typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new CircleSettlementInputError(`${label} is not an integer.`);
  }
}

export function verifyCircleProvisionEvent(
  event: CircleProvisionEvent,
  plan: CircleSettlementPlan,
  payer: string,
): CircleVerification {
  if (!sameAddress(event.payer, payer) || !sameAddress(event.payer, plan.payer)) {
    return { ok: false, reason: "Provision event payer does not match the Circle smart account." };
  }
  if (!sameBytes32(event.paycardId, plan.intent.paycardId)) {
    return { ok: false, reason: "Provision event paycard id does not match the prepared intent." };
  }
  if (!sameAddress(event.recipient, plan.intent.recipient)) {
    return { ok: false, reason: "Provision event recipient does not match the prepared intent." };
  }
  if (!sameBytes32(event.metadataHash, plan.intent.metadataHash)) {
    return { ok: false, reason: "Provision event metadata hash does not match the prepared intent." };
  }
  if (asBigInt(event.poolAllocation, "Pool allocation") !== plan.intent.totalAllocationPool) {
    return { ok: false, reason: "Provision event amount does not match the exact allowance." };
  }
  if (asBigInt(event.flowVelocityPerSecond, "Flow velocity") !== plan.intent.flowVelocityPerSecond) {
    return { ok: false, reason: "Provision event velocity does not match the prepared intent." };
  }
  if (asBigInt(event.genesisTimestamp, "Genesis timestamp") !== plan.intent.genesisTimestamp) {
    return { ok: false, reason: "Provision event genesis timestamp does not match the prepared intent." };
  }
  if (asBigInt(event.lifespanSeconds, "Lifespan") !== plan.intent.lifespanSeconds) {
    return { ok: false, reason: "Provision event lifespan does not match the prepared intent." };
  }
  return { ok: true };
}

export function verifyCircleVaultState(
  state: CircleVaultState,
  plan: CircleSettlementPlan,
  payer: string,
): CircleVerification {
  if (!sameAddress(state.payer, payer) || !sameAddress(state.payer, plan.payer)) {
    return { ok: false, reason: "Vault payer does not match the Circle smart account." };
  }
  if (!sameAddress(state.recipient, plan.intent.recipient)) {
    return { ok: false, reason: "Vault recipient does not match the prepared intent." };
  }
  if (!sameBytes32(state.metadataHash, plan.intent.metadataHash)) {
    return { ok: false, reason: "Vault metadata hash does not match the prepared intent." };
  }
  if (asBigInt(state.totalAllocationPool, "Vault allocation") !== plan.intent.totalAllocationPool) {
    return { ok: false, reason: "Vault allocation does not match the exact settlement amount." };
  }
  if (asBigInt(state.availableBalance, "Vault available balance") !== plan.intent.totalAllocationPool) {
    return { ok: false, reason: "Vault available balance does not match the exact settlement amount." };
  }
  if (asBigInt(state.flowVelocityPerSecond, "Vault velocity") !== plan.intent.flowVelocityPerSecond) {
    return { ok: false, reason: "Vault velocity does not match the prepared intent." };
  }
  if (asBigInt(state.genesisTimestamp, "Vault genesis timestamp") !== plan.intent.genesisTimestamp) {
    return { ok: false, reason: "Vault genesis timestamp does not match the prepared intent." };
  }
  if (asBigInt(state.lifespanSeconds, "Vault lifespan") !== plan.intent.lifespanSeconds) {
    return { ok: false, reason: "Vault lifespan does not match the prepared intent." };
  }
  if (asBigInt(state.operationalStatus, "Vault operational status") !== 0n) {
    return { ok: false, reason: "Vault is not active after settlement." };
  }
  if (state.residualDeltaRecipient && !sameAddress(state.residualDeltaRecipient, payer)) {
    return { ok: false, reason: "Vault residual recipient does not match the Circle smart account." };
  }
  return { ok: true };
}

export function normalizeCircleVaultState(raw: unknown): CircleVaultState | null {
  const values = Array.isArray(raw)
    ? {
        payer: raw[0],
        recipient: raw[1],
        metadataHash: raw[2],
        totalAllocationPool: raw[3],
        availableBalance: raw[4],
        flowVelocityPerSecond: raw[5],
        genesisTimestamp: raw[6],
        lifespanSeconds: raw[7],
        residualDeltaRecipient: raw[9],
        operationalStatus: raw[10],
      }
    : raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : null;
  if (!values) return null;

  const required = [
    values.payer,
    values.recipient,
    values.metadataHash,
    values.totalAllocationPool,
    values.availableBalance,
    values.flowVelocityPerSecond,
    values.genesisTimestamp,
    values.lifespanSeconds,
    values.operationalStatus,
  ];
  if (required.some((value) => value === undefined || value === null)) return null;

  return {
    payer: String(values.payer),
    recipient: String(values.recipient),
    metadataHash: String(values.metadataHash),
    totalAllocationPool: values.totalAllocationPool as bigint | string | number,
    availableBalance: values.availableBalance as bigint | string | number,
    flowVelocityPerSecond: values.flowVelocityPerSecond as bigint | string | number,
    genesisTimestamp: values.genesisTimestamp as bigint | string | number,
    lifespanSeconds: values.lifespanSeconds as bigint | string | number,
    residualDeltaRecipient: values.residualDeltaRecipient ? String(values.residualDeltaRecipient) : undefined,
    operationalStatus: values.operationalStatus as bigint | string | number,
  };
}

export type CircleErrorState =
  | "user-rejected"
  | "sponsorship-denied"
  | "insufficient-balance"
  | "rpc-failure"
  | "transaction-reverted"
  | "receipt-verification-failure";

export function classifyCircleError(error: unknown): CircleErrorState {
  const candidate = error as { name?: unknown; message?: unknown } | null;
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error ?? "");
  const text = `${name} ${message}`.toLowerCase();

  if (/user.?reject|user.?denied|notallowederror|aborterror|cancelled|canceled/.test(text)) {
    return "user-rejected";
  }
  if (/paymaster|sponsor|gas station|policy|aa3|aa31|insufficient prefund/.test(text)) {
    return "sponsorship-denied";
  }
  if (/revert|execution failed|user operation failed|success.?false/.test(text)) {
    return "transaction-reverted";
  }
  return "rpc-failure";
}

export function circleErrorLabel(state: CircleErrorState): string {
  switch (state) {
    case "user-rejected":
      return "Passkey approval was cancelled.";
    case "sponsorship-denied":
      return "Circle Gas Station sponsorship was denied.";
    case "insufficient-balance":
      return "The Circle smart account does not have enough USDC.";
    case "rpc-failure":
      return "Circle or Arc RPC request failed.";
    case "transaction-reverted":
      return "The sponsored transaction reverted.";
    case "receipt-verification-failure":
      return "Receipt or live Vault verification failed.";
  }
}

export const CIRCLE_INTENT_TYPES = OPENRAILS_EIP712_TYPES;
export const CIRCLE_ZERO_ADDRESS = ZERO_ADDRESS;
