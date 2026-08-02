import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SCHEMA_ROOT = path.join(PACKAGE_ROOT, "schemas");

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, relativePath), "utf8"));
}

export function schemaFiles() {
  return fs.readdirSync(SCHEMA_ROOT).filter((file) => file.endsWith(".schema.json")).sort();
}

export function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(value) && !Number.isNaN(Date.parse(value))
  });
  for (const file of schemaFiles()) {
    ajv.addSchema(readJson(`schemas/${file}`));
  }
  for (const file of schemaFiles()) {
    const schema = readJson(`schemas/${file}`);
    ajv.getSchema(schema.$id);
  }
  return ajv;
}

export function validatorFor(ajv, schemaRef) {
  const validator = ajv.getSchema(schemaRef);
  if (!validator) {
    throw new Error(`No validator registered for ${schemaRef}`);
  }
  return validator;
}

export function assertValid(ajv, schemaRef, value, label = schemaRef) {
  const validator = validatorFor(ajv, schemaRef);
  if (!validator(value)) {
    throw new Error(`${label} is invalid:\n${JSON.stringify(validator.errors, null, 2)}`);
  }
}

export function assertInvalid(ajv, schemaRef, value, label = schemaRef) {
  const validator = validatorFor(ajv, schemaRef);
  if (validator(value)) {
    throw new Error(`${label} unexpectedly validated`);
  }
  return validator.errors ?? [];
}
