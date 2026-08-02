import fs from "node:fs";
import path from "node:path";
import { createAjv, PACKAGE_ROOT, readJson, schemaFiles, validatorFor } from "./validation-lib.mjs";

const ajv = createAjv();
const schemaIndex = readJson("schemas/schemas.json");
const actualSchemaFiles = schemaFiles();
const indexedSchemaFiles = schemaIndex.schemas.map((entry) => entry.path).sort();
if (JSON.stringify(actualSchemaFiles) !== JSON.stringify(indexedSchemaFiles)) {
  throw new Error(`Schema index mismatch. Actual: ${actualSchemaFiles.join(", ")}; indexed: ${indexedSchemaFiles.join(", ")}`);
}

function validateFile(schemaId, relativePath) {
  const validator = validatorFor(ajv, schemaId);
  const value = readJson(relativePath);
  if (!validator(value)) {
    throw new Error(`${relativePath} failed ${schemaId}:\n${JSON.stringify(validator.errors, null, 2)}`);
  }
  return value;
}

validateFile("https://schemas.openrails.dev/openrails/1.0.1/schema-index.schema.json", "schemas/schemas.json");
validateFile("https://schemas.openrails.dev/openrails/1.0.1/manifest-index.schema.json", "manifests/index.json");
const capabilityList = validateFile("https://schemas.openrails.dev/openrails/1.0.1/capability-list.schema.json", "registries/capability-list.json");
const registry = validateFile("https://schemas.openrails.dev/openrails/1.0.1/operation-registry.schema.json", "registries/operation-registry.json");
const transitions = validateFile("https://schemas.openrails.dev/openrails/1.0.1/transition-rules.schema.json", "registries/transition-rules.json");
const manifest = validateFile("https://schemas.openrails.dev/openrails/1.0.1/network-manifest.schema.json", "manifests/arc-testnet.json");

const capabilities = capabilityList.capabilities;
const operationCapabilities = registry.operations.map((operation) => operation.capability);
if (new Set(operationCapabilities).size !== operationCapabilities.length) throw new Error("Operation registry contains duplicate capabilities");
if (JSON.stringify(capabilities) !== JSON.stringify(operationCapabilities)) throw new Error("Operation registry does not exactly cover capability-list.json in canonical order");
if (manifest.capabilities.length !== capabilities.length || !capabilities.every((capability) => manifest.capabilities.some((item) => item.capability === capability))) {
  throw new Error("Arc manifest does not declare every registry capability");
}
for (const operation of registry.operations) {
  validatorFor(ajv, operation.requestSchema);
  validatorFor(ajv, operation.responseSchema);
  validatorFor(ajv, operation.requestDataSchema);
  validatorFor(ajv, operation.responseDataSchema);
}
if (manifest.runtime.workspaceRuntimeStatus === "LIVE") throw new Error("Arc manifest must not claim Workspace Runtime is live");
if (transitions.outcomeRules.find((rule) => rule.outcome === "success")?.receiptRequirement !== "exact-verified-receipt-and-reconciliation") {
  throw new Error("Successful lifecycle outcome does not require exact receipt and reconciliation");
}

const secretNames = /privateKey|private_key|seedPhrase|mnemonic|rpcToken|rpcSecret|bearerToken/i;
function scan(value, location = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (secretNames.test(key)) throw new Error(`Secret-like field ${location}.${key} is prohibited`);
    scan(child, `${location}.${key}`);
  }
}
for (const file of ["registries/operation-registry.json", "registries/transition-rules.json", "manifests/arc-testnet.json"]) scan(readJson(file), file);

console.log(`Schema/reference validation passed: ${actualSchemaFiles.length} schemas, ${registry.operations.length} operations, ${transitions.allowedTransitions.length} transitions, ${manifest.capabilities.length} Arc capabilities.`);
