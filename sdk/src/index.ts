/**
 * @module index
 * @description Shared Interface 1.2 safe public surface for OpenRails.
 *
 * The root surface prepares, reads, and verifies canonical objects. Signing
 * and transaction submission remain responsibilities of an external wallet.
 * The pre-1.0 Arc-specific surface is available from `openrails-sdk/arc`.
 */

export * from "./shared-interface";
export {
  assertValidOperationRequest,
  assertValidOperationResponse,
  createOperationRequest,
  createOperationResponse,
  isSignedRuntimeTransitionOperation,
  SIGNED_RUNTIME_TRANSITION_OPERATIONS,
  validateOperationRequest,
  validateOperationResponse,
} from "./operations";
export type { OperationContext, OperationResponseContext, SignedRuntimeTransitionOperation } from "./operations";
export * from "./wallet-handoff";
export * from "./canonical-record";
export * from "./circle-gas-station";
export * from "./cctp";
export * from "./interface-client";
export * from "./runtime-client";
