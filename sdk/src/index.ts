/**
 * @module index
 * @description Shared Interface 1.1 safe public surface for OpenRails.
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
  validateOperationRequest,
  validateOperationResponse,
} from "./operations";
export type { OperationContext, OperationResponseContext } from "./operations";
export * from "./wallet-handoff";
export * from "./canonical-record";
export * from "./circle-gas-station";
