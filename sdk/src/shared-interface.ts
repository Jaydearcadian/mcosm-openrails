import {
  ARC_TESTNET_MANIFEST_ARTIFACT,
} from "./generated/shared-interface-runtime";
import type { NetworkManifest } from "./generated/shared-interface";

export type * from "./generated/shared-interface";

export const OPENRAILS_SHARED_INTERFACE_VERSION = "1.2.0" as const;
export const SHARED_INTERFACE_SCHEMA_BASE_URL = "https://schemas.openrails.dev/openrails/1.2.0" as const;

export const ARC_TESTNET_MANIFEST = ARC_TESTNET_MANIFEST_ARTIFACT as NetworkManifest;
export const ARC_CAPABILITY_MANIFEST = ARC_TESTNET_MANIFEST;

export function getArcTestnetManifest(): NetworkManifest {
  return JSON.parse(JSON.stringify(ARC_TESTNET_MANIFEST)) as NetworkManifest;
}

export {
  assertValidOperation,
  assertValidSchema,
  isSignedRuntimeTransitionOperation,
  resolveOperation,
  validateOperation,
  SIGNED_RUNTIME_TRANSITION_OPERATIONS,
} from "./generated/shared-interface-operations";
export type {
  OperationDirection,
  OperationRegistryEntry,
  OperationValidationIssue,
  OperationValidationResult,
  SignedRuntimeTransitionOperation,
} from "./generated/shared-interface-operations";

export {
  canonicalizeRuntimePayload,
  hashRuntimePayload,
  hashRuntimeTransition,
  recoverRuntimeTransitionSigner,
  runtimeTransitionDomain,
  runtimeTransitionMessage,
  RUNTIME_TRANSITION_PRIMARY_TYPE,
  RUNTIME_TRANSITION_TYPES,
} from "./generated/shared-interface-runtime-signature";
