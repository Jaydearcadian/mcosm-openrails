import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openrails-pack-"));
const npmCache = path.join(temporaryRoot, "npm-cache");
const commandEnvironment = { ...process.env, npm_config_cache: npmCache };

try {
  const packDestination = path.join(temporaryRoot, "archive");
  const consumerPrefix = path.join(temporaryRoot, "consumer");
  fs.mkdirSync(npmCache);
  fs.mkdirSync(packDestination);
  fs.mkdirSync(consumerPrefix);

  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", packDestination], {
    cwd: packageRoot,
    encoding: "utf8",
    env: commandEnvironment
  }));
  assert.equal(packed.length, 1, "npm pack should produce one archive");
  const archive = path.join(packDestination, packed[0].filename);

  execFileSync("npm", ["install", "--ignore-scripts", "--no-package-lock", "--prefix", consumerPrefix, archive], {
    cwd: packageRoot,
    stdio: "inherit",
    env: commandEnvironment
  });

  const installedRoot = path.join(consumerPrefix, "node_modules", "@openrails", "shared-interface");
  const installedPackage = JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"));
  assert.ok(installedPackage.dependencies?.ajv, "AJV must be a runtime dependency");
  assert.ok(fs.existsSync(path.join(installedRoot, "dist", "operations.js")), "runtime validator must be packed");
  assert.ok(fs.existsSync(path.join(installedRoot, "schemas", "common.schema.json")), "canonical schemas must be packed");

  const api = await import(pathToFileURL(path.join(installedRoot, "dist", "index.js")).href);
  assert.equal(typeof api.resolveOperation, "function");
  assert.equal(typeof api.validateOperation, "function");
  assert.equal(api.resolveOperation("network.list").operationId, "network.list");
  console.log("Packed artifact import smoke passed: runtime API loaded with packaged dependencies.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
