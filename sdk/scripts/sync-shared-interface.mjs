import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(sdkRoot, "..");
const interfaceRoot = path.join(repositoryRoot, "interface");
const generatedRoot = path.join(sdkRoot, "src", "generated");
const typeSourcePath = path.join(interfaceRoot, "src", "generated.ts");
const typeOutputPath = path.join(generatedRoot, "shared-interface.ts");
const validatorsSourcePath = path.join(interfaceRoot, "src", "generated", "validators.ts");
const validatorsOutputPath = path.join(generatedRoot, "shared-interface-validators.ts");
const runtimeOutputPath = path.join(generatedRoot, "shared-interface-runtime.ts");
const operationsSourcePath = path.join(interfaceRoot, "src", "operations.ts");
const operationsOutputPath = path.join(generatedRoot, "shared-interface-operations.ts");
const runtimeSignatureSourcePath = path.join(interfaceRoot, "src", "runtime-signature.ts");
const runtimeSignatureOutputPath = path.join(generatedRoot, "shared-interface-runtime-signature.ts");
const canonicalizeSourcePath = path.join(sdkRoot, "node_modules", "canonicalize", "lib", "canonicalize.js");
const canonicalizeOutputPath = path.join(generatedRoot, "shared-interface-canonicalize.ts");

const schemaRoot = path.join(interfaceRoot, "schemas");
const schemaFiles = fs.readdirSync(schemaRoot)
  .filter((file) => file.endsWith(".schema.json"))
  .sort();
const schemas = schemaFiles.map((file) => JSON.parse(fs.readFileSync(path.join(schemaRoot, file), "utf8")));
const operationRegistry = JSON.parse(fs.readFileSync(path.join(interfaceRoot, "registries", "operation-registry.json"), "utf8"));
const arcManifest = JSON.parse(fs.readFileSync(path.join(interfaceRoot, "manifests", "arc-testnet.json"), "utf8"));

const typeOutput = fs.readFileSync(typeSourcePath, "utf8");
const validatorsOutput = fs.readFileSync(validatorsSourcePath, "utf8");
const runtimeSignatureSource = fs.readFileSync(runtimeSignatureSourcePath, "utf8");
const operationSource = fs.readFileSync(operationsSourcePath, "utf8");
const canonicalizeSource = fs.readFileSync(canonicalizeSourcePath, "utf8");

function materializeCanonicalize(source) {
  const functionLine = "export default function canonicalize (object, seen = new Set()) {";
  if (!source.includes(functionLine)) {
    throw new Error(`Canonicalize source changed: missing ${functionLine}`);
  }
  return source
    .replace(functionLine, "export function canonicalizeRuntimeJson (object: any, seen = new Set<object>()): string {")
    .replaceAll("canonicalize(", "canonicalizeRuntimeJson(");
}

function materializeRuntimeSignature(source) {
  const importLine = 'import type { RuntimeSignatureBinding } from "./generated.js";';
  const canonicalizeImport = 'import canonicalize from "canonicalize";';
  if (!source.includes(importLine) || !source.includes(canonicalizeImport)) {
    throw new Error("Canonical runtime signature source changed: expected imports were not found");
  }
  return source
    .replace(importLine, 'import type { RuntimeSignatureBinding } from "./shared-interface";')
    .replace(canonicalizeImport, 'import { canonicalizeRuntimeJson } from "./shared-interface-canonicalize";')
    .replace("const canonical = canonicalize(unsignedPayload);", "const canonical = canonicalizeRuntimeJson(unsignedPayload);");
}

function materializeOperations(source) {
  const filesystemImports = [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
  ].join("\n");
  const runtimeImport = 'import { hashRuntimePayload } from "./runtime-signature.js";';
  const validatorsImport = 'import { schemaNames, validators } from "./generated/validators.js";';
  const embeddedImports = [
    'import { OPERATION_REGISTRY_ARTIFACT } from "./artifacts.js";',
    validatorsImport,
    runtimeImport,
  ].join("\n");
  if (!source.includes(runtimeImport)) {
    throw new Error("Canonical operation source changed: expected import boundary was not found");
  }

  if (!source.includes(filesystemImports)) {
    if (!source.includes(embeddedImports)) {
      throw new Error("Canonical operation source changed: expected embedded artifact imports were not found");
    }
    return source.replace(
      embeddedImports,
      [
        'import { OPERATION_REGISTRY_ARTIFACT } from "./shared-interface-runtime";',
        'import { schemaNames, validators } from "./shared-interface-validators";',
        'import { hashRuntimePayload } from "./shared-interface-runtime-signature";',
      ].join("\n"),
    );
  }

  let output = source.replace(`${filesystemImports}\n`, "");
  output = output.replace(
    runtimeImport,
    [
      'import { OPERATION_REGISTRY_ARTIFACT } from "./shared-interface-runtime";',
      'import { schemaNames, validators } from "./shared-interface-validators";',
      'import { hashRuntimePayload } from "./shared-interface-runtime-signature";',
    ].join("\n"),
  );

  const filesystemStart = output.indexOf("const PACKAGE_ROOT =");
  const typeMarker = "export type OperationDirection";
  const typeStart = output.indexOf(typeMarker);
  if (filesystemStart < 0 || typeStart < 0 || filesystemStart > typeStart) {
    throw new Error("Canonical operation source changed: filesystem source boundary was not found");
  }
  output = `${output.slice(0, filesystemStart)}${output.slice(typeStart)}`;

  const readJsonStart = output.indexOf("function readJson<T>");
  const isRecordStart = output.indexOf("function isRecord", readJsonStart);
  if (readJsonStart < 0 || isRecordStart < 0 || readJsonStart > isRecordStart) {
    throw new Error("Canonical operation source changed: JSON reader boundary was not found");
  }
  output = `${output.slice(0, readJsonStart)}${output.slice(isRecordStart)}`;

  const schemaLoopStart = output.indexOf("  for (const file of fs.readdirSync(SCHEMA_ROOT)");
  const schemaLoopEnd = output.indexOf("  return ajv;", schemaLoopStart);
  if (schemaLoopStart < 0 || schemaLoopEnd < 0) {
    throw new Error("Canonical operation source changed: schema loading loop was not found");
  }
  output = `${output.slice(0, schemaLoopStart)}${output.slice(schemaLoopEnd)}`;

  const registryLine = 'const registry = readJson<OperationRegistryFile>(REGISTRY_PATH);';
  if (!output.includes(registryLine)) {
    throw new Error(`Canonical operation source changed: missing ${registryLine}`);
  }
  output = output.replace(registryLine, "const registry = OPERATION_REGISTRY_ARTIFACT as OperationRegistryFile;");
  return output;
}

const generatedRuntimeSignature = [
  "// Generated by scripts/sync-shared-interface.mjs. Do not edit.",
  "// Canonical source: interface/src/runtime-signature.ts.",
  "",
  materializeRuntimeSignature(runtimeSignatureSource),
].join("\n");

const generatedCanonicalize = [
  "// Generated by scripts/sync-shared-interface.mjs. Do not edit.",
  "// Adapted and modified from canonicalize 3.0.0, licensed under Apache-2.0.",
  "// Modifications rename the export and add TypeScript annotations for the packed SDK.",
  "// See NOTICE.md and THIRD_PARTY_LICENSES.md in the published package.",
  "",
  materializeCanonicalize(canonicalizeSource),
].join("\n");

const generatedOperations = [
  "// Generated by scripts/sync-shared-interface.mjs. Do not edit.",
  "// Canonical source: interface/src/operations.ts.",
  "",
  materializeOperations(operationSource),
].join("\n");

const runtimeOutput = [
  "// Generated by scripts/sync-shared-interface.mjs. Do not edit.",
  "// Canonical sources: interface/schemas, interface/registries, and interface/manifests.",
  "",
  `export const SHARED_INTERFACE_SCHEMAS: unknown[] = ${JSON.stringify(schemas, null, 2)};`,
  "",
  `export const OPERATION_REGISTRY_ARTIFACT: unknown = ${JSON.stringify(operationRegistry, null, 2)};`,
  "",
  `export const ARC_TESTNET_MANIFEST_ARTIFACT: unknown = ${JSON.stringify(arcManifest, null, 2)};`,
  "",
].join("\n");

const outputs = [
  [typeOutputPath, typeOutput],
  [validatorsOutputPath, validatorsOutput],
  [runtimeOutputPath, runtimeOutput],
  [operationsOutputPath, generatedOperations],
  [runtimeSignatureOutputPath, generatedRuntimeSignature],
  [canonicalizeOutputPath, generatedCanonicalize],
];
const check = process.argv.includes("--check");

if (check) {
  for (const [outputPath, expected] of outputs) {
    let actual;
    try {
      actual = fs.readFileSync(outputPath, "utf8");
    } catch {
      console.error(`Generated SDK interface file is missing: ${path.relative(sdkRoot, outputPath)}`);
      process.exit(1);
    }
    if (actual !== expected) {
      console.error(`Generated SDK interface file is stale: ${path.relative(sdkRoot, outputPath)}`);
      process.exit(1);
    }
  }
  console.error(`SDK interface artifacts are current: ${schemaFiles.length} schemas and ${operationRegistry.operations.length} operations.`);
} else {
  fs.mkdirSync(generatedRoot, { recursive: true });
  for (const [outputPath, output] of outputs) fs.writeFileSync(outputPath, output);
  console.log(`Generated SDK interface artifacts from ${schemaFiles.length} schemas and ${operationRegistry.operations.length} operations.`);
}
