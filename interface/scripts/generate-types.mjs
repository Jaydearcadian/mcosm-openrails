import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = path.join(packageRoot, "schemas");
const outputPath = path.join(packageRoot, "src", "generated.ts");
const artifactOutputPath = path.join(packageRoot, "src", "artifacts.ts");
const validatorsOutputPath = path.join(packageRoot, "src", "generated", "validators.ts");
const schemaFiles = fs.readdirSync(schemaRoot).filter((file) => file.endsWith(".schema.json")).sort();
const schemas = schemaFiles.map((file) => JSON.parse(fs.readFileSync(path.join(schemaRoot, file), "utf8")));
const operationRegistry = JSON.parse(fs.readFileSync(path.join(packageRoot, "registries", "operation-registry.json"), "utf8"));
const arcManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "manifests", "arc-testnet.json"), "utf8"));
const definitions = new Map();
const namesByRef = new Map();

function addName(ref, name, schema, currentId) {
  if (!namesByRef.has(ref)) namesByRef.set(ref, name);
  if (!definitions.has(name)) definitions.set(name, { schema, currentId });
}

for (const schema of schemas) {
  const currentId = schema.$id;
  if (schema.$defs) {
    for (const [name, definition] of Object.entries(schema.$defs)) {
      addName(`${currentId}#/$defs/${name}`, name, definition, currentId);
    }
  }
}

for (const schema of schemas) {
  const currentId = schema.$id;
  if (!schema.$defs && schema.title) {
    addName(currentId, schema.title, schema, currentId);
  }
}

function refName(ref, currentId) {
  const absolute = ref.startsWith("#") ? `${currentId}${ref}` : ref;
  if (namesByRef.has(absolute)) return namesByRef.get(absolute);
  const fragment = absolute.split("#")[1];
  if (fragment?.startsWith("/$defs/")) return fragment.slice("/$defs/".length);
  const base = absolute.split("#")[0];
  return namesByRef.get(base) ?? "unknown";
}

function literal(value) {
  return JSON.stringify(value);
}

function propertyName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : literal(name);
}

function additionalPropertyKeyType(schema) {
  if (schema.propertyNames?.pattern === "^x-[a-z0-9][a-z0-9._-]*$") return "`x-${string}`";
  return "string";
}

function objectType(schema, currentId, indent, inheritedProperties = undefined, requiredOnly = false) {
  const properties = schema.properties ?? inheritedProperties ?? {};
  const required = new Set(schema.required ?? []);
  const lines = ["{"];
  const names = requiredOnly
    ? [...required].filter((name) => Object.hasOwn(properties, name)).sort()
    : Object.keys(properties).sort();
  for (const name of names) {
    const optional = required.has(name) ? "" : "?";
    lines.push(`${indent}  ${propertyName(name)}${optional}: ${schemaType(properties[name], currentId, `${indent}  `)};`);
  }
  if (schema.additionalProperties === true) {
    lines.push(`${indent}  [key: ${additionalPropertyKeyType(schema)}]: unknown;`);
  } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    lines.push(`${indent}  [key: string]: ${schemaType(schema.additionalProperties, currentId, `${indent}  `)};`);
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function schemaType(schema, currentId, indent = "", inheritedProperties = undefined) {
  if (!schema || typeof schema !== "object") return "unknown";
  if (schema.$ref) return refName(schema.$ref, currentId);
  if (Object.hasOwn(schema, "const")) return literal(schema.const);
  if (schema.enum) return schema.enum.map(literal).join(" | ");

  const alternatives = schema.oneOf ?? schema.anyOf;
  const hasObjectShape = schema.type === "object" || schema.properties || schema.additionalProperties;
  if (hasObjectShape) {
    const base = objectType(schema, currentId, indent);
    if (alternatives) {
      const variants = alternatives
        .map((item) => schemaType(item, currentId, indent, schema.properties ?? inheritedProperties))
        .filter((item) => item !== "never");
      return variants.length ? `${base} & (${variants.join(" | ")})` : base;
    }
    return base;
  }

  if (alternatives) {
    return alternatives.map((item) => schemaType(item, currentId, indent, inheritedProperties)).filter((item) => item !== "never").join(" | ") || "unknown";
  }
  if (schema.allOf) {
    const parts = [];
    if (schema.type || schema.properties || schema.$ref) parts.push(schemaType({ ...schema, allOf: undefined }, currentId, indent));
    for (const item of schema.allOf) {
      if (item.if || item.then || item.else || item.not) continue;
      parts.push(schemaType(item, currentId, indent));
    }
    return parts.filter(Boolean).join(" & ") || "unknown";
  }
  if (schema.required) return objectType(schema, currentId, indent, inheritedProperties, true);
  if (schema.type === "array") return `Array<${schemaType(schema.items ?? {}, currentId, indent)}>`;
  if (Array.isArray(schema.type)) return schema.type.map((type) => primitiveType(type)).join(" | ");
  if (schema.type) return primitiveType(schema.type);
  return "unknown";
}

function primitiveType(type) {
  switch (type) {
    case "string": return "string";
    case "integer":
    case "number": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "object": return "Record<string, unknown>";
    case "array": return "unknown[]";
    default: return "unknown";
  }
}

const output = [
  "// Generated by scripts/generate-types.mjs. Do not edit.",
  "// Canonical source: JSON Schema 2020-12, OpenRails Shared Interface 1.2.0.",
  "",
  ...[...definitions.keys()].sort().map((name) => {
    const entry = definitions.get(name);
    return `export type ${name} = ${schemaType(entry.schema, entry.currentId, "")};`;
  }),
  ""
].join("\n");

const artifactOutput = [
  "// Generated by scripts/generate-types.mjs. Do not edit.",
  "// Canonical sources: JSON Schema 2020-12, OpenRails operation registry, and network manifests.",
  "",
  `export const SHARED_INTERFACE_SCHEMAS: unknown[] = ${JSON.stringify(schemas, null, 2)};`,
  "",
  `export const OPERATION_REGISTRY_ARTIFACT: unknown = ${JSON.stringify(operationRegistry, null, 2)};`,
  "",
  `export const ARC_TESTNET_MANIFEST_ARTIFACT: unknown = ${JSON.stringify(arcManifest, null, 2)};`,
  "",
].join("\n");

function standaloneValidatorsOutput() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true, code: { source: true, esm: true } });
  ajv.addFormat("date-time", /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/);
  for (const schema of schemas) ajv.addSchema(schema);

  const refs = [...new Set([
    ...schemas.map((schema) => schema.$id),
    ...operationRegistry.operations.flatMap((entry) => [
      entry.requestSchema,
      entry.responseSchema,
      entry.requestDataSchema,
      entry.responseDataSchema,
    ]),
  ])];
  const names = {};
  const standaloneSchemas = {};
  refs.forEach((ref, index) => {
    const name = `validateSchema${index}`;
    names[ref] = name;
    standaloneSchemas[name] = ref;
  });
  const validatorExports = refs.map((_, index) => `validateSchema${index}`).join(", ");
  let standalone = standaloneCode(ajv, standaloneSchemas);
  standalone = standalone
    .replace(
      /const (func\d+) = require\("ajv\/dist\/runtime\/equal"\)\.default;/,
      `const $1 = (a, b) => { if (a === b) return true; if (a && b && typeof a === "object" && typeof b === "object") { if (a.constructor !== b.constructor) return false; if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = a.length; i-- !== 0;) if (!$1(a[i], b[i])) return false; return true; } if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags; if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf(); if (a.toString !== Object.prototype.toString) return a.toString() === b.toString(); const keys = Object.keys(a); if (keys.length !== Object.keys(b).length) return false; for (let i = keys.length; i-- !== 0;) if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false; for (let i = keys.length; i-- !== 0;) if (!$1(a[keys[i]], b[keys[i]])) return false; return true; } return a !== a && b !== b; };`,
    )
    .replace(
      /const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/,
      "const $1 = (str) => { const len = str.length; let length = 0; let pos = 0; let value; while (pos < len) { length++; value = str.charCodeAt(pos++); if (value >= 0xd800 && value <= 0xdbff && pos < len) { value = str.charCodeAt(pos); if ((value & 0xfc00) === 0xdc00) pos++; } } return length; };"
    );
  if (/require\("ajv\/dist\/runtime\//.test(standalone)) {
    throw new Error("Standalone validator generation left an unsupported AJV runtime require");
  }
  return [
    "// Generated by scripts/generate-types.mjs. Do not edit.",
    "// AJV validators are compiled at build time for runtimes that disallow eval/new Function.",
    "// @ts-nocheck",
    "",
    `export const schemaNames = ${JSON.stringify(names)};`,
    standalone,
    `export const validators = { ${validatorExports} };`,
    "",
  ].join("\n");
}

const validatorsOutput = standaloneValidatorsOutput();

const collapsedTypes = [...output.matchAll(/^export type ([A-Za-z_$][A-Za-z0-9_$]*) = unknown(?: \| unknown)*;$/gm)].map((match) => match[1]);
if (collapsedTypes.length > 0) {
  throw new Error(`Generated public schema types collapsed to unknown: ${collapsedTypes.join(", ")}`);
}

const extensionDataStart = output.indexOf("export type ExtensionData = ");
const extensionDataEnd = output.indexOf("\nexport type ", extensionDataStart + 1);
const extensionDataOutput = extensionDataStart >= 0
  ? output.slice(extensionDataStart, extensionDataEnd >= 0 ? extensionDataEnd : output.length)
  : "";
if (!extensionDataOutput.includes("[key: `x-${string}`]: unknown;") && !extensionDataOutput.includes("[key: string]: unknown;")) {
  throw new Error("Generated ExtensionData lost its object index shape");
}

const check = process.argv.includes("--check");
if (check) {
  let current;
  try {
    current = fs.readFileSync(outputPath, "utf8");
  } catch {
    console.error(`Generated file is missing: ${path.relative(packageRoot, outputPath)}`);
    process.exit(1);
  }
  if (current !== output) {
    console.error(`Generated output is stale: ${path.relative(packageRoot, outputPath)}`);
    process.exit(1);
  }
  let currentArtifacts;
  try {
    currentArtifacts = fs.readFileSync(artifactOutputPath, "utf8");
  } catch {
    console.error(`Generated file is missing: ${path.relative(packageRoot, artifactOutputPath)}`);
    process.exit(1);
  }
  if (currentArtifacts !== artifactOutput) {
    console.error(`Generated output is stale: ${path.relative(packageRoot, artifactOutputPath)}`);
    process.exit(1);
  }
  let currentValidators;
  try {
    currentValidators = fs.readFileSync(validatorsOutputPath, "utf8");
  } catch {
    console.error(`Generated file is missing: ${path.relative(packageRoot, validatorsOutputPath)}`);
    process.exit(1);
  }
  if (currentValidators !== validatorsOutput) {
    console.error(`Generated output is stale: ${path.relative(packageRoot, validatorsOutputPath)}`);
    process.exit(1);
  }
  console.log(`Generated output is current: ${path.relative(packageRoot, outputPath)}`);
} else {
  fs.writeFileSync(outputPath, output);
  fs.writeFileSync(artifactOutputPath, artifactOutput);
  fs.mkdirSync(path.dirname(validatorsOutputPath), { recursive: true });
  fs.writeFileSync(validatorsOutputPath, validatorsOutput);
  console.log(`Generated ${path.relative(packageRoot, outputPath)} from ${schemaFiles.length} schemas.`);
}
