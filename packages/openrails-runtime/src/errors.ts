import type { ErrorCode } from "@openrails/shared-interface";

export type RuntimeErrorCode = Extract<
  ErrorCode,
  | "INPUT_INVALID"
  | "WRONG_NETWORK"
  | "AUTHORIZATION_REQUIRED"
  | "SIGNATURE_INVALID"
  | "SIGNATURE_EXPIRED"
  | "NONCE_CONFLICT"
  | "POLICY_BLOCKED"
  | "TERMS_MISMATCH"
  | "PROOF_REQUIRED"
  | "PROOF_INVALID"
  | "RPC_UNAVAILABLE"
  | "STATE_STALE"
  | "INTERNAL_ERROR"
>;

export interface RuntimeErrorOptions {
  retryable?: boolean;
  details?: {
    field?: string;
    providerCode?: string;
    reason?: string;
  };
}

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;
  readonly details?: RuntimeErrorOptions["details"];

  constructor(code: RuntimeErrorCode, message: string, options: RuntimeErrorOptions = {}) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function isRuntimeError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError;
}

export function asRuntimeError(error: unknown, fallbackCode: RuntimeErrorCode, fallbackMessage: string): RuntimeError {
  if (isRuntimeError(error)) return error;
  return new RuntimeError(fallbackCode, error instanceof Error ? error.message : fallbackMessage);
}
