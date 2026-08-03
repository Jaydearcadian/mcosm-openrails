import {
  assertValidSchema,
  OPENRAILS_SHARED_INTERFACE_VERSION,
  SHARED_INTERFACE_SCHEMA_BASE_URL,
  resolveOperation,
} from "./shared-interface";
import {
  createOperationRequest,
  createOperationResponse,
  type OperationContext,
  type OperationResponseContext,
} from "./operations";
import type {
  ErrorCode,
  ExecutionProfile,
  InterfaceError,
  LifecycleState,
  NetworkReference,
  OperationRequest,
  OperationResponse,
  Receipt,
  Timestamp,
  TransactionState,
  TransactionStateName,
  WalletAuthorization,
  WalletHandoff,
  WalletReceiptVerification,
  WalletTransactionRequest,
} from "./generated/shared-interface";

export const WALLET_HANDOFF_SCHEMA = `${SHARED_INTERFACE_SCHEMA_BASE_URL}/wallet-handoff.schema.json` as const;
export const TRANSACTION_STATE_SCHEMA = `${SHARED_INTERFACE_SCHEMA_BASE_URL}/transaction-state.schema.json` as const;
export const RECEIPT_SCHEMA = `${SHARED_INTERFACE_SCHEMA_BASE_URL}/receipt.schema.json` as const;

type HandoffReferences = Pick<
  WalletHandoff,
  "workspaceRef" | "pathRef" | "intentRef" | "proposalRef" | "pactRef"
>;

export interface PrepareWalletHandoffParams extends HandoffReferences {
  id: WalletHandoff["id"];
  operationId: WalletHandoff["operationId"];
  capability?: WalletHandoff["capability"];
  correlationId: WalletHandoff["correlationId"];
  subject: WalletHandoff["subject"];
  network: NetworkReference;
  preparedRequest: WalletTransactionRequest;
  expiresAt: Timestamp;
  provenance: WalletHandoff["provenance"];
  executionProfile?: ExecutionProfile;
  createdAt?: Timestamp;
  now?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RecordWalletAuthorizationParams {
  signer: string;
  signature: WalletAuthorization["signature"];
  signedAt: Timestamp;
  now?: Timestamp;
}

export interface WalletHandoffVerification {
  valid: boolean;
  status: LifecycleState;
  financialSuccess: boolean;
  receiptVerified: boolean;
  errors: InterfaceError[];
}

export class WalletHandoffValidationError extends Error {
  readonly code: ErrorCode;
  readonly expectedNetwork?: NetworkReference;
  readonly actualNetwork?: NetworkReference;

  constructor(
    code: ErrorCode,
    message: string,
    options: { expectedNetwork?: NetworkReference; actualNetwork?: NetworkReference } = {},
  ) {
    super(message);
    this.name = "WalletHandoffValidationError";
    this.code = code;
    this.expectedNetwork = options.expectedNetwork;
    this.actualNetwork = options.actualNetwork;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function timestamp(value: Timestamp | Date | undefined): Timestamp {
  return value instanceof Date ? value.toISOString() : value ?? new Date().toISOString();
}

function time(value: Timestamp, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new WalletHandoffValidationError("INPUT_INVALID", `${label} must be an ISO timestamp.`);
  return parsed;
}

function sameNetwork(left: NetworkReference, right: NetworkReference): boolean {
  return left.networkId === right.networkId && left.chainId === right.chainId;
}

function assertNetwork(expected: NetworkReference, actual: NetworkReference): void {
  if (!sameNetwork(expected, actual)) {
    throw new WalletHandoffValidationError(
      "WRONG_NETWORK",
      `Wallet handoff network mismatch: expected ${expected.networkId}/${expected.chainId}, got ${actual.networkId}/${actual.chainId}.`,
      { expectedNetwork: expected, actualNetwork: actual },
    );
  }
}

function assertPreparedRequestNetwork(network: NetworkReference, preparedRequest: WalletTransactionRequest): void {
  if (preparedRequest.chainId !== network.chainId) {
    throw new WalletHandoffValidationError(
      "WRONG_NETWORK",
      `Prepared wallet request chain mismatch: expected ${network.chainId}, got ${preparedRequest.chainId}.`,
      {
        expectedNetwork: network,
        actualNetwork: { networkId: network.networkId, chainId: preparedRequest.chainId },
      },
    );
  }
}

function assertWalletAddress(subject: WalletHandoff["subject"], preparedRequest: WalletTransactionRequest): void {
  if (subject.walletAddress && subject.walletAddress.toLowerCase() !== preparedRequest.from.toLowerCase()) {
    throw new WalletHandoffValidationError(
      "AUTHORIZATION_REQUIRED",
      "The prepared transaction sender must match the subject wallet address.",
    );
  }
}

function errorFor(
  handoff: WalletHandoff,
  code: ErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    financialEffect?: InterfaceError["financialEffect"];
    lifecycleState?: LifecycleState;
    transactionState?: TransactionStateName;
    occurredAt?: Timestamp;
    expectedNetwork?: NetworkReference;
    actualNetwork?: NetworkReference;
    expiresAt?: Timestamp;
  } = {},
): InterfaceError {
  return {
    interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
    code,
    message,
    retryable: options.retryable ?? true,
    financialEffect: options.financialEffect ?? "NONE",
    lifecycleState: options.lifecycleState ?? handoff.lifecycleState,
    transactionState: options.transactionState ?? handoff.transaction.status,
    operationId: handoff.operationId,
    occurredAt: options.occurredAt ?? handoff.updatedAt,
    provenance: handoff.provenance,
    ...(options.expectedNetwork ? { expectedNetwork: options.expectedNetwork } : {}),
    ...(options.actualNetwork ? { actualNetwork: options.actualNetwork } : {}),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  };
}

function appendError(handoff: WalletHandoff, error: InterfaceError): void {
  if (!handoff.errors.some((existing) => existing.code === error.code)) handoff.errors.push(error);
}

function setReceiptPending(handoff: WalletHandoff, reasons: string[] = []): WalletReceiptVerification {
  return {
    status: "PENDING",
    reasons,
  };
}

function assertValidHandoff(handoff: WalletHandoff): WalletHandoff {
  return assertValidSchema(WALLET_HANDOFF_SCHEMA, handoff);
}

function assertCanAuthorize(handoff: WalletHandoff, now: Timestamp): void {
  if (handoff.walletAuthorization.status !== "AWAITING_SIGNATURE") {
    throw new WalletHandoffValidationError(
      "AUTHORIZATION_REQUIRED",
      `Wallet handoff cannot be authorized from ${handoff.walletAuthorization.status}.`,
    );
  }
  if (time(now, "now") >= time(handoff.expiresAt, "expiresAt")) {
    throw new WalletHandoffValidationError(
      "SIGNATURE_EXPIRED",
      "Wallet handoff authorization expired before the external wallet signed it.",
    );
  }
}

export function prepareWalletHandoff(params: PrepareWalletHandoffParams): WalletHandoff {
  const now = timestamp(params.now ?? params.createdAt);
  const createdAt = params.createdAt ?? now;
  const updatedAt = params.updatedAt ?? now;
  const operation = resolveOperationForHandoff(params.operationId);

  assertPreparedRequestNetwork(params.network, params.preparedRequest);
  assertWalletAddress(params.subject, params.preparedRequest);
  if (time(params.expiresAt, "expiresAt") <= time(now, "now")) {
    throw new WalletHandoffValidationError("SIGNATURE_EXPIRED", "Wallet handoff expiry must be after the preparation time.");
  }
  if (params.capability && params.capability !== operation.capability) {
    throw new WalletHandoffValidationError(
      "INPUT_INVALID",
      `Wallet handoff capability must equal ${operation.capability}.`,
    );
  }

  const handoff: WalletHandoff = {
    interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
    id: params.id,
    executionProfile: params.executionProfile ?? "direct-wallet-authorized",
    operationId: operation.operationId,
    capability: operation.capability,
    correlationId: params.correlationId,
    subject: params.subject,
    network: params.network,
    preparedRequest: params.preparedRequest,
    expiresAt: params.expiresAt,
    lifecycleState: "PREPARED",
    walletAuthorization: {
      mode: "external-wallet",
      status: "AWAITING_SIGNATURE",
      expiresAt: params.expiresAt,
    },
    transaction: {
      interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
      status: "WALLET_REQUIRED",
      network: params.network,
      financialEffect: "NONE",
      observedAt: now,
    },
    receiptVerification: { status: "NOT_REQUESTED", reasons: [] },
    errors: [],
    createdAt,
    updatedAt,
    provenance: params.provenance,
    ...(params.workspaceRef ? { workspaceRef: params.workspaceRef } : {}),
    ...(params.pathRef ? { pathRef: params.pathRef } : {}),
    ...(params.intentRef ? { intentRef: params.intentRef } : {}),
    ...(params.proposalRef ? { proposalRef: params.proposalRef } : {}),
    ...(params.pactRef ? { pactRef: params.pactRef } : {}),
  };

  return assertValidHandoff(handoff);
}

function resolveOperationForHandoff(operationId: string) {
  try {
    return resolveOperation(operationId);
  } catch (error) {
    throw new WalletHandoffValidationError("INPUT_INVALID", error instanceof Error ? error.message : String(error));
  }
}

export function isWalletHandoffExpired(handoff: WalletHandoff, now: Timestamp | Date = new Date()): boolean {
  return time(timestamp(now), "now") >= time(handoff.expiresAt, "expiresAt");
}

export function expireWalletHandoff(handoff: WalletHandoff, now: Timestamp | Date = new Date()): WalletHandoff {
  const next = clone(handoff);
  const observedAt = timestamp(now);
  if (!isWalletHandoffExpired(next, observedAt)) return assertValidHandoff(next);
  if (!["NOT_REQUESTED", "WALLET_REQUIRED"].includes(next.transaction.status)) return assertValidHandoff(next);
  if (next.walletAuthorization.status === "EXPIRED") return assertValidHandoff(next);

  next.lifecycleState = "FAILED";
  next.walletAuthorization = {
    mode: "external-wallet",
    status: "EXPIRED",
    expiresAt: next.expiresAt,
  };
  next.transaction = {
    ...next.transaction,
    status: "NOT_REQUESTED",
    financialEffect: "NONE",
    observedAt,
  };
  next.updatedAt = observedAt;
  appendError(
    next,
    errorFor(next, "SIGNATURE_EXPIRED", "The external wallet authorization expired before submission.", {
      retryable: false,
      lifecycleState: "FAILED",
      transactionState: "NOT_REQUESTED",
      occurredAt: observedAt,
      expiresAt: next.expiresAt,
    }),
  );
  return assertValidHandoff(next);
}

export function recordWalletAuthorization(
  handoff: WalletHandoff,
  params: RecordWalletAuthorizationParams,
): WalletHandoff {
  const next = clone(handoff);
  const now = timestamp(params.now ?? params.signedAt);
  assertValidHandoff(next);
  assertCanAuthorize(next, now);
  if (params.signer.toLowerCase() !== next.preparedRequest.from.toLowerCase()) {
    throw new WalletHandoffValidationError("AUTHORIZATION_REQUIRED", "The external signer must match the prepared transaction sender.");
  }

  next.walletAuthorization = {
    mode: "external-wallet",
    status: "SIGNED",
    signer: params.signer as WalletAuthorization["signer"],
    signature: params.signature,
    signedAt: params.signedAt,
    expiresAt: next.expiresAt,
  };
  next.lifecycleState = "COMMITTED";
  next.updatedAt = now;
  return assertValidHandoff(next);
}

export const recordWalletSignature = recordWalletAuthorization;

export function recordWalletRejection(
  handoff: WalletHandoff,
  reason: string,
  now: Timestamp | Date = new Date(),
): WalletHandoff {
  const next = clone(handoff);
  const observedAt = timestamp(now);
  assertValidHandoff(next);
  next.lifecycleState = "FAILED";
  next.walletAuthorization = {
    mode: "external-wallet",
    status: "REJECTED",
    reason,
    expiresAt: next.expiresAt,
  };
  next.transaction = {
    ...next.transaction,
    status: "WALLET_REJECTED",
    financialEffect: "NONE",
    observedAt,
  };
  next.receiptVerification = { status: "NOT_REQUESTED", reasons: [] };
  next.updatedAt = observedAt;
  appendError(next, errorFor(next, "WALLET_REJECTED", reason, {
    retryable: true,
    lifecycleState: "FAILED",
    transactionState: "WALLET_REJECTED",
    occurredAt: observedAt,
  }));
  return assertValidHandoff(next);
}

export function recordWalletSubmission(
  handoff: WalletHandoff,
  transaction: TransactionState,
): WalletHandoff {
  const next = clone(handoff);
  assertValidHandoff(next);
  assertValidSchema(TRANSACTION_STATE_SCHEMA, transaction);
  assertNetwork(next.network, transaction.network);
  if (next.walletAuthorization.status !== "SIGNED") {
    throw new WalletHandoffValidationError("AUTHORIZATION_REQUIRED", "Record the external wallet signature before recording submission.");
  }
  if (transaction.submittedAt && time(transaction.submittedAt, "submittedAt") >= time(next.expiresAt, "expiresAt")) {
    throw new WalletHandoffValidationError("SIGNATURE_EXPIRED", "The external wallet submitted the transaction after authorization expiry.");
  }

  next.transaction = transaction;
  next.updatedAt = transaction.observedAt;
  switch (transaction.status) {
    case "SUBMITTED":
    case "PENDING_CONFIRMATION":
      next.lifecycleState = "SUBMITTED";
      next.receiptVerification = setReceiptPending(next, ["A verified financial receipt is still pending."]);
      break;
    case "CONFIRMED":
      next.lifecycleState = "SETTLING";
      next.receiptVerification = setReceiptPending(next, ["Exact receipt evidence and canonical reconciliation are still pending."]);
      break;
    case "REVERTED":
    case "REPLACED":
    case "DROPPED":
    case "UNKNOWN": {
      next.lifecycleState = "FAILED";
      const code = transaction.failureCode ?? (
        transaction.status === "REVERTED"
          ? "TRANSACTION_REVERTED"
          : transaction.status === "REPLACED"
            ? "TRANSACTION_REPLACED"
            : transaction.status === "DROPPED"
              ? "TRANSACTION_DROPPED"
              : "RPC_UNAVAILABLE"
      );
      appendError(next, errorFor(next, code, transaction.failureReason ?? `External wallet transaction is ${transaction.status.toLowerCase()}.`, {
        retryable: code !== "TRANSACTION_REVERTED",
        lifecycleState: "FAILED",
        transactionState: transaction.status,
        financialEffect: transaction.financialEffect,
        occurredAt: transaction.observedAt,
      }));
      break;
    }
    case "WALLET_REJECTED":
      return recordWalletRejection(next, transaction.failureReason ?? "The external wallet rejected the transaction.", transaction.observedAt);
    case "NOT_REQUESTED":
    case "WALLET_REQUIRED":
      next.lifecycleState = "PREPARED";
      next.receiptVerification = { status: "NOT_REQUESTED", reasons: [] };
      break;
  }

  return assertValidHandoff(next);
}

export function recordWalletReceiptVerification(
  handoff: WalletHandoff,
  receipt: Receipt,
  now: Timestamp | Date = new Date(),
): WalletHandoff {
  assertValidHandoff(handoff);
  assertValidSchema(RECEIPT_SCHEMA, receipt);
  assertNetwork(handoff.network, receipt.network);
  assertNetwork(handoff.network, receipt.transaction.network);
  if (receipt.operationId !== handoff.operationId) {
    throw new WalletHandoffValidationError("INPUT_INVALID", "Receipt operationId does not match the wallet handoff.");
  }
  if (handoff.transaction.status !== "CONFIRMED" || !handoff.transaction.txHash) {
    throw new WalletHandoffValidationError(
      "STATE_STALE",
      "Receipt verification requires a previously recorded confirmed transaction with a transaction hash.",
    );
  }
  if (!receipt.transaction.txHash
    || receipt.transaction.txHash.toLowerCase() !== handoff.transaction.txHash.toLowerCase()) {
    throw new WalletHandoffValidationError(
      "RECEIPT_UNVERIFIED",
      "Receipt transaction hash does not match the transaction recorded on the wallet handoff.",
    );
  }

  const next = clone(handoff);
  const observedAt = timestamp(now);
  next.transaction = receipt.transaction;
  next.updatedAt = observedAt;
  if (receipt.receiptStatus === "VERIFIED") {
    if (receipt.transaction.status !== "CONFIRMED") {
      throw new WalletHandoffValidationError("INPUT_INVALID", "A verified receipt must reference a confirmed transaction.");
    }
    next.receiptVerification = {
      status: "VERIFIED",
      receiptRef: { type: "Receipt", id: receipt.id, network: receipt.network },
      reasons: receipt.verification.reasons,
      verifiedAt: observedAt,
    };
    if (receipt.financialOutcome === "RECONCILED" && receipt.canonicalReconciliation.status === "MATCHED") {
      next.lifecycleState = "SETTLED";
    } else {
      next.lifecycleState = "SETTLING";
      appendError(next, errorFor(next, "RECEIPT_UNVERIFIED", "The receipt is verified but canonical reconciliation is not complete.", {
        financialEffect: "RECONCILIATION_REQUIRED",
        lifecycleState: "SETTLING",
        transactionState: receipt.transaction.status,
        occurredAt: observedAt,
      }));
    }
  } else {
    next.receiptVerification = {
      status: receipt.receiptStatus === "REJECTED" ? "REJECTED" : "UNVERIFIED",
      receiptRef: { type: "Receipt", id: receipt.id, network: receipt.network },
      reasons: receipt.verification.reasons,
    };
    if (receipt.transaction.status === "REVERTED") {
      next.lifecycleState = "FAILED";
      appendError(next, errorFor(next, "TRANSACTION_REVERTED", "The transaction referenced by the receipt reverted.", {
        retryable: false,
        lifecycleState: "FAILED",
        transactionState: "REVERTED",
        financialEffect: receipt.transaction.financialEffect,
        occurredAt: observedAt,
      }));
    } else {
      next.lifecycleState = "SETTLING";
      appendError(next, errorFor(next, "RECEIPT_UNVERIFIED", receipt.verification.reasons.join(" ") || "The financial receipt is not verified.", {
        financialEffect: receipt.financialOutcome === "PENDING" ? "PENDING" : "UNKNOWN",
        lifecycleState: "SETTLING",
        transactionState: receipt.transaction.status,
        occurredAt: observedAt,
      }));
    }
  }

  return assertValidHandoff(next);
}

export function verifyWalletHandoff(
  handoff: WalletHandoff,
  expectedNetwork: NetworkReference = handoff.network,
  now: Timestamp | Date = new Date(),
): WalletHandoffVerification {
  const next = clone(handoff);
  const errors = [...next.errors];
  try {
    assertValidHandoff(next);
    assertNetwork(expectedNetwork, next.network);
    assertPreparedRequestNetwork(expectedNetwork, next.preparedRequest);
  } catch (error) {
    const validation = error instanceof WalletHandoffValidationError ? error : new WalletHandoffValidationError("INPUT_INVALID", String(error));
    errors.push(errorFor(next, validation.code, validation.message, {
      retryable: validation.code === "WRONG_NETWORK",
      lifecycleState: "FAILED",
      transactionState: next.transaction.status,
      expectedNetwork: validation.expectedNetwork,
      actualNetwork: validation.actualNetwork,
      occurredAt: timestamp(now),
    }));
    return {
      valid: false,
      status: "FAILED",
      financialSuccess: false,
      receiptVerified: false,
      errors,
    };
  }

  const submitted = ["SUBMITTED", "PENDING_CONFIRMATION", "CONFIRMED"].includes(next.transaction.status);
  if (!submitted && isWalletHandoffExpired(next, now)) {
    errors.push(errorFor(next, "SIGNATURE_EXPIRED", "The external wallet authorization expired before submission.", {
      retryable: false,
      lifecycleState: "FAILED",
      transactionState: "NOT_REQUESTED",
      occurredAt: timestamp(now),
      expiresAt: next.expiresAt,
    }));
    return { valid: false, status: "FAILED", financialSuccess: false, receiptVerified: false, errors };
  }

  if (["REVERTED", "REPLACED", "DROPPED", "UNKNOWN", "WALLET_REJECTED"].includes(next.transaction.status)) {
    return { valid: false, status: "FAILED", financialSuccess: false, receiptVerified: false, errors };
  }

  const receiptVerified = next.receiptVerification.status === "VERIFIED";
  const financialSuccess = next.lifecycleState === "SETTLED" && receiptVerified && next.transaction.status === "CONFIRMED";
  return {
    valid: true,
    status: next.lifecycleState,
    financialSuccess,
    receiptVerified,
    errors,
  };
}

export function assertWalletHandoffReadyForFinancialSuccess(handoff: WalletHandoff): WalletHandoff {
  const result = verifyWalletHandoff(handoff);
  if (!result.financialSuccess) {
    throw new WalletHandoffValidationError(
      result.errors[0]?.code ?? "RECEIPT_UNVERIFIED",
      result.errors[0]?.message ?? "A verified receipt and canonical reconciliation are required for financial success.",
    );
  }
  return handoff;
}

export function createWalletHandoffPrepareRequest(
  handoff: WalletHandoff,
  context: OperationContext,
): OperationRequest {
  return createOperationRequest("wallet.handoff.prepare", { walletHandoff: handoff }, context);
}

export function createWalletHandoffVerifyRequest(
  handoffRef: WalletHandoff["id"],
  receipt: Receipt,
  context: OperationContext,
): OperationRequest {
  return createOperationRequest(
    "wallet.handoff.verify",
    {
      handoffRef: { type: "WalletHandoff", id: handoffRef },
      receipt,
    },
    context,
  );
}

export function createWalletHandoffResponse(
  handoff: WalletHandoff,
  context: Omit<OperationResponseContext, "data">,
): OperationResponse {
  return createOperationResponse("wallet.handoff.get", { ...context, data: { walletHandoff: handoff } });
}
