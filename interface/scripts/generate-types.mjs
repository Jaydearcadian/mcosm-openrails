import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = path.join(packageRoot, "schemas");
const outputPath = path.join(packageRoot, "src", "generated.ts");
const schemaFiles = fs.readdirSync(schemaRoot).filter((file) => file.endsWith(".schema.json")).sort();
const schemas = schemaFiles.map((file) => JSON.parse(fs.readFileSync(path.join(schemaRoot, file), "utf8")));
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
  "// Canonical source: JSON Schema 2020-12, OpenRails Shared Interface 1.1.0.",
  "",
  ...[...definitions.keys()].sort().map((name) => {
    const entry = definitions.get(name);
    return `export type ${name} = ${schemaType(entry.schema, entry.currentId, "")};`;
  }),
  ""
].join("\n");

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
  console.log(`Generated output is current: ${path.relative(packageRoot, outputPath)}`);
} else {
  fs.writeFileSync(outputPath, output);
  console.log(`Generated ${path.relative(packageRoot, outputPath)} from ${schemaFiles.length} schemas.`);
}
