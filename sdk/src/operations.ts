import {
  assertValidOperation,
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
  context: OperationContext,
): OperationRequest {
  const operation = resolveOperation(operationIdOrCapability);
  const envelope: OperationRequest = {
    interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
    executionProfile: context.executionProfile,
    operationId: operation.operationId,
    capability: operation.capability,
    authorizationClass: operation.authorizationClass as OperationRequest["authorizationClass"],
    subject: context.subject,
    network: context.network,
    data,
    provenance: context.provenance,
    createdAt: context.createdAt,
    ...(context.workspaceRef ? { workspaceRef: context.workspaceRef } : {}),
    ...(context.pathRef ? { pathRef: context.pathRef } : {}),
    ...(context.intentRef ? { intentRef: context.intentRef } : {}),
    ...(context.proposalRef ? { proposalRef: context.proposalRef } : {}),
    ...(context.pactRef ? { pactRef: context.pactRef } : {}),
    ...(context.canonicalRecordRef ? { canonicalRecordRef: context.canonicalRecordRef } : {}),
    ...(context.proofRefs ? { proofRefs: context.proofRefs } : {}),
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
    ...(context.canonicalRecordRef ? { canonicalRecordRef: context.canonicalRecordRef } : {}),
    ...(context.proofRefs ? { proofRefs: context.proofRefs } : {}),
    ...(context.receipts ? { receipts: context.receipts } : {}),
    ...(context.transaction ? { transaction: context.transaction } : {}),
  };

  return assertValidOperation(operation.operationId, envelope, "response");
}
