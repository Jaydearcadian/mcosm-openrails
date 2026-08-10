import {
  assertValidOperation,
  getArcTestnetManifest,
  isSignedRuntimeTransitionOperation,
  OPENRAILS_SHARED_INTERFACE_VERSION,
  resolveOperation,
  validateOperation,
} from "./shared-interface";
import type {
  ExecutionProfile,
  InterfaceError,
  LifecycleState,
  NetworkReference,
  OperationRequest,
  OperationResponse,
  Provenance,
  Receipt,
  Subject,
  Timestamp,
  TransactionState,
} from "./generated/shared-interface";

export type {
  ExecutionProfile,
  InterfaceError,
  LifecycleState,
  NetworkReference,
  OperationRequest,
  OperationResponse,
  Provenance,
  Receipt,
  Subject,
  Timestamp,
  TransactionState,
} from "./generated/shared-interface";

export interface OperationContext {
  executionProfile: ExecutionProfile;
  subject: Subject;
  network: NetworkReference;
  provenance: Provenance;
  createdAt: Timestamp;
  workspaceRef?: OperationRequest["workspaceRef"];
  pathRef?: OperationRequest["pathRef"];
  intentRef?: OperationRequest["intentRef"];
  proposalRef?: OperationRequest["proposalRef"];
  pactRef?: OperationRequest["pactRef"];
  decisionRef?: OperationRequest["decisionRef"];
  canonicalRecordRef?: OperationRequest["canonicalRecordRef"];
  proofRefs?: OperationRequest["proofRefs"];
}

export interface OperationResponseContext extends OperationContext {
  lifecycleState: LifecycleState;
  data: OperationResponse["data"];
  errors?: InterfaceError[];
  updatedAt?: Timestamp;
  receipts?: Receipt[];
  transaction?: TransactionState;
}

const RUNTIME_CONTEXT_FIELDS = [
  "executionProfile",
  "subject",
  "network",
  "provenance",
  "createdAt",
  "workspaceRef",
  "pathRef",
  "intentRef",
  "proposalRef",
  "pactRef",
  "decisionRef",
  "canonicalRecordRef",
  "proofRefs",
] as const satisfies ReadonlyArray<keyof OperationContext>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(left[key], right[key]));
}

function artifactReference<T extends "Proposal" | "Pact">(
  type: T,
  artifact: unknown,
): { type: T; id: string } | undefined {
  return isRecord(artifact) && typeof artifact.id === "string"
    ? { type, id: artifact.id }
    : undefined;
}

function signedRuntimeContext(operationId: string, data: OperationRequest["data"]): OperationContext {
  if (!isRecord(data)) {
    throw new Error(`${operationId} requires a signed runtime payload with signatureBinding`);
  }
  const payload: Record<string, unknown> = data;
  if (!isRecord(payload.signatureBinding)) {
    throw new Error(`${operationId} requires a signed runtime payload with signatureBinding`);
  }
  const binding = payload.signatureBinding;
  if (typeof binding.signer !== "string" || typeof binding.issuedAt !== "string") {
    throw new Error(`${operationId} signatureBinding must include signer and issuedAt`);
  }

  const manifest = getArcTestnetManifest();
  const context: OperationContext = {
    executionProfile: "delegated-runtime",
    subject: { walletAddress: binding.signer, role: "owner" },
    network: { networkId: manifest.networkId, chainId: String(manifest.chainId) },
    provenance: {
      source: "configuration",
      authority: "openrails-sdk",
      evidenceLevel: "configuration-only",
      observedAt: binding.issuedAt,
      notes: "Derived from signed runtime payload fields. The external signature is present but not verified by createOperationRequest.",
    },
    createdAt: binding.issuedAt,
  };

  if (operationId === "actor.register") {
    context.workspaceRef = payload.workspaceRef as OperationContext["workspaceRef"];
  } else if (operationId === "proposal.submit" && isRecord(payload.proposal)) {
    context.workspaceRef = payload.proposal.workspaceRef as OperationContext["workspaceRef"];
    context.pathRef = payload.proposal.pathRef as OperationContext["pathRef"];
    context.intentRef = payload.proposal.intentRef as OperationContext["intentRef"];
    context.proposalRef = artifactReference("Proposal", payload.proposal);
  } else if (operationId === "pact.sign" && isRecord(payload.pact)) {
    context.workspaceRef = payload.pact.workspaceRef as OperationContext["workspaceRef"];
    context.pathRef = payload.pact.pathRef as OperationContext["pathRef"];
    context.intentRef = payload.intentRef as OperationContext["intentRef"];
    context.proposalRef = payload.pact.proposalRef as OperationContext["proposalRef"];
    context.decisionRef = payload.pact.decisionRef as OperationContext["decisionRef"];
    context.pactRef = artifactReference("Pact", payload.pact);
  }
  return context;
}

function assertCompatibleRuntimeContext(
  operationId: string,
  supplied: Partial<OperationContext> | undefined,
  derived: OperationContext,
): void {
  if (supplied === undefined) return;
  if (!isRecord(supplied)) throw new TypeError(`${operationId} signed runtime context must be an object`);
  for (const [field, value] of Object.entries(supplied)) {
    if (!RUNTIME_CONTEXT_FIELDS.includes(field as typeof RUNTIME_CONTEXT_FIELDS[number])) {
      throw new Error(`${operationId} signed runtime context field ${field} is not accepted`);
    }
    const expected = derived[field as typeof RUNTIME_CONTEXT_FIELDS[number]];
    if (!sameJsonValue(value, expected)) {
      throw new Error(`${operationId} signed runtime context ${field} must exactly match the SDK-derived value`);
    }
  }
}

function requireOperationContext(
  operationId: string,
  context: Partial<OperationContext> | undefined,
): OperationContext {
  if (!context
    || context.executionProfile === undefined
    || context.subject === undefined
    || context.network === undefined
    || context.provenance === undefined
    || context.createdAt === undefined) {
    throw new Error(`${operationId} requires an operation context`);
  }
  return context as OperationContext;
}

export function validateOperationRequest(
  operationIdOrCapability: string,
  envelope: unknown,
) {
  return validateOperation(operationIdOrCapability, envelope, "request");
}

export function validateOperationResponse(
  operationIdOrCapability: string,
  envelope: unknown,
) {
  return validateOperation(operationIdOrCapability, envelope, "response");
}

export function assertValidOperationRequest<T = unknown>(
  operationIdOrCapability: string,
  envelope: T,
): T {
  return assertValidOperation(operationIdOrCapability, envelope, "request");
}

export function assertValidOperationResponse<T = unknown>(
  operationIdOrCapability: string,
  envelope: T,
): T {
  return assertValidOperation(operationIdOrCapability, envelope, "response");
}

export function createOperationRequest(
  operationIdOrCapability: string,
  data: OperationRequest["data"],
  context?: Partial<OperationContext>,
): OperationRequest {
  const operation = resolveOperation(operationIdOrCapability);
  const requestContext = isSignedRuntimeTransitionOperation(operation.operationId)
    ? signedRuntimeContext(operation.operationId, data)
    : requireOperationContext(operation.operationId, context);
  if (isSignedRuntimeTransitionOperation(operation.operationId)) {
    assertCompatibleRuntimeContext(operation.operationId, context, requestContext);
  }
  const envelope: OperationRequest = {
    interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
    executionProfile: requestContext.executionProfile,
    operationId: operation.operationId,
    capability: operation.capability,
    authorizationClass: operation.authorizationClass as OperationRequest["authorizationClass"],
    subject: requestContext.subject,
    network: requestContext.network,
    data,
    provenance: requestContext.provenance,
    createdAt: requestContext.createdAt,
    ...(requestContext.workspaceRef ? { workspaceRef: requestContext.workspaceRef } : {}),
    ...(requestContext.pathRef ? { pathRef: requestContext.pathRef } : {}),
    ...(requestContext.intentRef ? { intentRef: requestContext.intentRef } : {}),
    ...(requestContext.proposalRef ? { proposalRef: requestContext.proposalRef } : {}),
    ...(requestContext.pactRef ? { pactRef: requestContext.pactRef } : {}),
    ...(requestContext.decisionRef ? { decisionRef: requestContext.decisionRef } : {}),
    ...(requestContext.canonicalRecordRef ? { canonicalRecordRef: requestContext.canonicalRecordRef } : {}),
    ...(requestContext.proofRefs ? { proofRefs: requestContext.proofRefs } : {}),
  };

  return assertValidOperation(operation.operationId, envelope, "request");
}

export function createOperationResponse(
  operationIdOrCapability: string,
  context: OperationResponseContext,
): OperationResponse {
  const operation = resolveOperation(operationIdOrCapability);
  const envelope: OperationResponse = {
    interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
    executionProfile: context.executionProfile,
    operationId: operation.operationId,
    capability: operation.capability,
    authorizationClass: operation.authorizationClass as OperationResponse["authorizationClass"],
    subject: context.subject,
    network: context.network,
    data: context.data,
    lifecycleState: context.lifecycleState,
    errors: context.errors ?? [],
    provenance: context.provenance,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt ?? context.createdAt,
    ...(context.workspaceRef ? { workspaceRef: context.workspaceRef } : {}),
    ...(context.pathRef ? { pathRef: context.pathRef } : {}),
    ...(context.intentRef ? { intentRef: context.intentRef } : {}),
    ...(context.proposalRef ? { proposalRef: context.proposalRef } : {}),
    ...(context.pactRef ? { pactRef: context.pactRef } : {}),
    ...(context.decisionRef ? { decisionRef: context.decisionRef } : {}),
    ...(context.canonicalRecordRef ? { canonicalRecordRef: context.canonicalRecordRef } : {}),
    ...(context.proofRefs ? { proofRefs: context.proofRefs } : {}),
    ...(context.receipts ? { receipts: context.receipts } : {}),
    ...(context.transaction ? { transaction: context.transaction } : {}),
  };

  return assertValidOperation(operation.operationId, envelope, "response");
}

export {
  isSignedRuntimeTransitionOperation,
  SIGNED_RUNTIME_TRANSITION_OPERATIONS,
} from "./shared-interface";
export type { SignedRuntimeTransitionOperation } from "./shared-interface";
