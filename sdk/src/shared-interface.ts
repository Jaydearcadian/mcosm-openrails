import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import {
  ARC_TESTNET_MANIFEST_ARTIFACT,
  OPERATION_REGISTRY_ARTIFACT,
  SHARED_INTERFACE_SCHEMAS,
} from "./generated/shared-interface-runtime";
import type { NetworkManifest } from "./generated/shared-interface";

export type * from "./generated/shared-interface";

export const OPENRAILS_SHARED_INTERFACE_VERSION = "1.1.0" as const;
export const SHARED_INTERFACE_SCHEMA_BASE_URL = "https://schemas.openrails.dev/openrails/1.1.0" as const;

export type OperationDirection = "request" | "response";

export interface OperationRegistryEntry {
  operationId: string;
  capability: string;
  requestSchema: string;
  responseSchema: string;
  requestDataSchema: string;
  responseDataSchema: string;
  authorizationClass: string;
  allowedExecutionProfiles: string[];
  transactionBehavior: Record<string, unknown>;
  capabilityStatusBehavior: Record<string, unknown>;
}

export interface OperationValidationIssue {
  stage: "metadata" | "wrapper" | "payload";
  message: string;
  keyword?: string;
  instancePath?: string;
  params?: Record<string, unknown>;
}

export interface OperationValidationResult {
  valid: boolean;
  operation: OperationRegistryEntry;
  direction: OperationDirection;
  issues: OperationValidationIssue[];
}

interface OperationRegistryFile {
  operations: OperationRegistryEntry[];
}

interface EnvelopeRecord {
  operationId?: unknown;
  capability?: unknown;
  authorizationClass?: unknown;
  executionProfile?: unknown;
  lifecycleState?: unknown;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addAjvError(issues: OperationValidationIssue[], stage: "wrapper" | "payload", error: ErrorObject): void {
  issues.push({
    stage,
    keyword: error.keyword,
    instancePath: error.instancePath,
    message: error.message ?? "schema validation failed",
    params: error.params as Record<string, unknown>,
  });
}

function buildValidator(): Ajv2020 {
  const validator = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  validator.addFormat("date-time", {
    type: "string",
    validate: (value: string) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(value)
      && !Number.isNaN(Date.parse(value)),
  });
  for (const schema of SHARED_INTERFACE_SCHEMAS) validator.addSchema(schema as AnySchema);
  return validator;
}

const ajv = buildValidator();
const registry = OPERATION_REGISTRY_ARTIFACT as OperationRegistryFile;

export const ARC_TESTNET_MANIFEST = ARC_TESTNET_MANIFEST_ARTIFACT as NetworkManifest;
export const ARC_CAPABILITY_MANIFEST = ARC_TESTNET_MANIFEST;

export function getArcTestnetManifest(): NetworkManifest {
  return JSON.parse(JSON.stringify(ARC_TESTNET_MANIFEST)) as NetworkManifest;
}

export function resolveOperation(operationIdOrCapability: string): OperationRegistryEntry {
  const operation = registry.operations.find((entry) => entry.operationId === operationIdOrCapability
    || entry.capability === operationIdOrCapability);
  if (!operation) throw new Error(`Unknown OpenRails operation: ${operationIdOrCapability}`);
  return operation;
}

function validatorFor(schemaRef: string): ValidateFunction {
  const validator = ajv.getSchema(schemaRef);
  if (!validator) throw new Error(`No validator registered for ${schemaRef}`);
  return validator;
}

function isTerminalNullResponse(value: EnvelopeRecord, direction: OperationDirection): boolean {
  return direction === "response"
    && value.data === null
    && ["FAILED", "BLOCKED", "CANCELLED"].includes(String(value.lifecycleState));
}

export function validateOperation(
  operationIdOrCapability: string,
  envelope: unknown,
  direction: OperationDirection = "request",
): OperationValidationResult {
  const operation = resolveOperation(operationIdOrCapability);
  const issues: OperationValidationIssue[] = [];
  const value: EnvelopeRecord = isRecord(envelope) ? envelope : {};

  if (operation.operationId !== operation.capability) {
    issues.push({ stage: "metadata", message: `Registry operationId ${operation.operationId} does not equal capability ${operation.capability}.` });
  }
  if (value.operationId !== operation.operationId) {
    issues.push({ stage: "metadata", message: `operationId must equal registry operation ${operation.operationId}.` });
  }
  if (value.capability !== operation.capability) {
    issues.push({ stage: "metadata", message: `capability must equal registry capability ${operation.capability}.` });
  }
  if (value.operationId !== value.capability) {
    issues.push({ stage: "metadata", message: "operationId must equal capability." });
  }
  if (value.authorizationClass !== operation.authorizationClass) {
    issues.push({ stage: "metadata", message: `authorizationClass must equal ${operation.authorizationClass}.` });
  }
  if (!operation.allowedExecutionProfiles.includes(String(value.executionProfile))) {
    issues.push({ stage: "metadata", message: `executionProfile is not allowed for ${operation.operationId}.` });
  }

  const wrapperSchema = direction === "request" ? operation.requestSchema : operation.responseSchema;
  const dataSchema = direction === "request" ? operation.requestDataSchema : operation.responseDataSchema;
  const wrapperValidator = validatorFor(wrapperSchema);
  const dataValidator = validatorFor(dataSchema);
  if (!wrapperValidator(envelope)) {
    for (const error of wrapperValidator.errors ?? []) addAjvError(issues, "wrapper", error);
  }
  if (!isTerminalNullResponse(value, direction) && !dataValidator(value.data)) {
    for (const error of dataValidator.errors ?? []) addAjvError(issues, "payload", error);
  }

  return { valid: issues.length === 0, operation, direction, issues };
}

export function assertValidOperation<T = unknown>(
  operationIdOrCapability: string,
  envelope: T,
  direction: OperationDirection = "request",
): T {
  const result = validateOperation(operationIdOrCapability, envelope, direction);
  if (!result.valid) {
    throw new Error(`Invalid ${direction} for ${result.operation.operationId}:\n${JSON.stringify(result.issues, null, 2)}`);
  }
  return envelope;
}

export function assertValidSchema<T = unknown>(schemaRef: string, value: T): T {
  const validator = validatorFor(schemaRef);
  if (!validator(value)) {
    throw new Error(`Invalid value for ${schemaRef}:\n${JSON.stringify(validator.errors ?? [], null, 2)}`);
  }
  return value;
}
