/** Safe-only MCP handlers for the OpenRails Shared Interface 1.2 surface. */
import {
  assertCanonicalRecordPolicy,
  canonicalRecordCapabilityDeclaration,
  createOperationRequest,
  getArcTestnetManifest,
  isSignedRuntimeTransitionOperation,
  SIGNED_RUNTIME_TRANSITION_OPERATIONS,
  validateOperationRequest,
  validateOperationResponse,
  verifyCanonicalRecord,
  type CanonicalRecord,
  type OperationContext,
  type OperationRequest,
  type Pact,
} from "openrails-sdk";
import type { OpenRailsContext } from "./context.js";

export const SAFE_MCP_TOOL_NAMES = [
  "openrails_capabilities",
  "openrails_prepare",
  "openrails_validate",
  "openrails_verify",
  "openrails_read",
] as const;

const CUSTODY_FIELD = /(?:private[_-]?key|secret[_-]?key|seed[_-]?phrase|mnemonic)/i;

function rejectCustodyFields(value: unknown, path = "input"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => rejectCustodyFields(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CUSTODY_FIELD.test(key)) throw new Error(`${path}.${key} is not accepted by the safe-only MCP surface`);
    rejectCustodyFields(child, `${path}.${key}`);
  }
}

function networkFor(ctx: OpenRailsContext): OperationContext["network"] {
  return {
    networkId: ctx.manifest.networkId,
    chainId: String(ctx.config.chainId),
  };
}

function defaultContext(ctx: OpenRailsContext): OperationContext {
  const createdAt = new Date().toISOString();
  return {
    executionProfile: "direct-wallet-authorized",
    subject: {
      actorRef: {
        type: "Actor",
        id: "mcp:external-requester",
        network: networkFor(ctx),
      },
      role: "observer",
    },
    network: networkFor(ctx),
    provenance: {
      authority: "openrails-mcp",
      evidenceLevel: "configuration-only",
      observedAt: createdAt,
      source: "configuration",
      notes: "Prepared by the safe-only MCP boundary. An external wallet must authorize and submit it.",
    },
    createdAt,
  };
}

function operationContext(ctx: OpenRailsContext, supplied: unknown): OperationContext {
  rejectCustodyFields(supplied);
  const base = defaultContext(ctx);
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return base;
  const context = { ...base, ...(supplied as Partial<OperationContext>) } as OperationContext;
  if (context.network.networkId !== ctx.manifest.networkId || context.network.chainId !== String(ctx.config.chainId)) {
    throw new Error("Operation context network must match the configured Arc Testnet network");
  }
  return context;
}

export async function openrailsCapabilities(ctx: OpenRailsContext) {
  return {
    interfaceVersion: ctx.manifest.interfaceVersion,
    network: ctx.manifest,
    capabilities: ctx.manifest.capabilities,
    runtimeOperations: SIGNED_RUNTIME_TRANSITION_OPERATIONS,
    runtimeSignature: {
      standard: "eip-712",
      canPrepare: true,
      canValidate: true,
      canRecover: false,
      canSign: false,
    },
    safeSurface: {
      canRead: true,
      canPrepare: true,
      canValidate: true,
      canVerify: true,
      canSign: false,
      createsSigners: false,
      canBroadcast: false,
      canRelay: false,
      financialSuccess: false,
    },
    canonicalRecords: {
      supported: true,
      policy: "pact-declared-and-optional",
      defaultExposure: "encrypted",
      indexer: "replaceable-and-not-configured",
    },
    canonicalRecordCapability: canonicalRecordCapabilityDeclaration(),
  };
}

export async function prepareOperation(
  ctx: OpenRailsContext,
  args: { operationId: string; data: unknown; context?: unknown },
) {
  rejectCustodyFields(args);
  const request = createOperationRequest(
    args.operationId,
    args.data as OperationRequest["data"],
    isSignedRuntimeTransitionOperation(args.operationId)
      ? args.context as Partial<OperationContext> | undefined
      : operationContext(ctx, args.context),
  );
  return {
    valid: true,
    broadcasted: false,
    signed: false,
    request,
  };
}

export async function validateOperation(
  _ctx: OpenRailsContext,
  args: { operationId: string; direction?: "request" | "response"; envelope: unknown },
) {
  rejectCustodyFields(args);
  const direction = args.direction ?? "request";
  const result = direction === "response"
    ? validateOperationResponse(args.operationId, args.envelope)
    : validateOperationRequest(args.operationId, args.envelope);
  return { ...result, broadcasted: false };
}

export async function verifyOperation(
  _ctx: OpenRailsContext,
  args: {
    operationId: string;
    direction?: "request" | "response";
    envelope: unknown;
    record?: unknown;
    pact?: unknown;
  },
) {
  rejectCustodyFields(args);
  const direction = args.direction ?? "response";
  const operation = direction === "response"
    ? validateOperationResponse(args.operationId, args.envelope)
    : validateOperationRequest(args.operationId, args.envelope);
  const record = args.record as CanonicalRecord | undefined;
  const pact = args.pact as Pick<Pact, "canonicalRecordPolicy"> | undefined;
  const canonicalRecord = record
    ? verifyCanonicalRecord(record, pact?.canonicalRecordPolicy)
    : { valid: true, errors: [], commitment: null };
  if (pact) assertCanonicalRecordPolicy(pact, record);
  return {
    operation,
    canonicalRecord,
    broadcasted: false,
    financialSuccess: false,
  };
}

export async function readInterfaceObject(
  ctx: OpenRailsContext,
  args: { type: string; id?: string },
) {
  rejectCustodyFields(args);
  const type = args.type.toLowerCase();
  if (type === "network" || type === "networkmanifest") return { available: true, object: getArcTestnetManifest() };
  if (type === "capabilities" || type === "capabilitydeclaration") {
    return { available: true, object: ctx.manifest.capabilities };
  }
  return {
    available: false,
    type: args.type,
    id: args.id ?? null,
    reason: "Canonical object reads require a replaceable indexer or application repository adapter",
  };
}
