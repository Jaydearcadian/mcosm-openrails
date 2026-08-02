import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_ROOT = path.join(PACKAGE_ROOT, "schemas");
const REGISTRY_PATH = path.join(PACKAGE_ROOT, "registries", "operation-registry.json");

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

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
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
    params: error.params as Record<string, unknown>
  });
}

function buildValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(value) && !Number.isNaN(Date.parse(value))
  });
  for (const file of fs.readdirSync(SCHEMA_ROOT).filter((entry) => entry.endsWith(".schema.json")).sort()) {
    ajv.addSchema(readJson(path.join(SCHEMA_ROOT, file)));
  }
  return ajv;
}

const ajv = buildValidator();
const registry = readJson<OperationRegistryFile>(REGISTRY_PATH);

export function resolveOperation(operationIdOrCapability: string): OperationRegistryEntry {
  const operation = registry.operations.find((entry) => entry.operationId === operationIdOrCapability || entry.capability === operationIdOrCapability);
  if (!operation) throw new Error(`Unknown OpenRails operation: ${operationIdOrCapability}`);
  return operation;
}

function validatorFor(schemaRef: string): ValidateFunction {
  const validator = ajv.getSchema(schemaRef);
  if (!validator) throw new Error(`No validator registered for ${schemaRef}`);
  return validator;
}

function addMetadataIssue(issues: OperationValidationIssue[], message: string): void {
  issues.push({ stage: "metadata", message });
}

function isTerminalNullResponse(value: EnvelopeRecord, direction: OperationDirection): boolean {
  return direction === "response"
    && value.data === null
    && ["FAILED", "BLOCKED", "CANCELLED"].includes(String(value.lifecycleState));
}

export function validateOperation(
  operationIdOrCapability: string,
  envelope: unknown,
  direction: OperationDirection = "request"
): OperationValidationResult {
  const operation = resolveOperation(operationIdOrCapability);
  const issues: OperationValidationIssue[] = [];
  const value: EnvelopeRecord = isRecord(envelope) ? envelope : {};

  if (operation.operationId !== operation.capability) {
    addMetadataIssue(issues, `Registry operationId ${operation.operationId} does not equal capability ${operation.capability}.`);
  }
  if (value.operationId !== operation.operationId) {
    addMetadataIssue(issues, `operationId must equal registry operation ${operation.operationId}.`);
  }
  if (value.capability !== operation.capability) {
    addMetadataIssue(issues, `capability must equal registry capability ${operation.capability}.`);
  }
  if (value.operationId !== value.capability) {
    addMetadataIssue(issues, "operationId must equal capability.");
  }
  if (value.authorizationClass !== operation.authorizationClass) {
    addMetadataIssue(issues, `authorizationClass must equal ${operation.authorizationClass}.`);
  }
  if (!operation.allowedExecutionProfiles.includes(String(value.executionProfile))) {
    addMetadataIssue(issues, `executionProfile is not allowed for ${operation.operationId}.`);
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
  direction: OperationDirection = "request"
): T {
  const result = validateOperation(operationIdOrCapability, envelope, direction);
  if (!result.valid) {
    throw new Error(`Invalid ${direction} for ${result.operation.operationId}:\n${JSON.stringify(result.issues, null, 2)}`);
  }
  return envelope;
}
