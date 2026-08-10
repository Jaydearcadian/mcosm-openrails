import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openrails-sdk-pack-"));
const npmCache = path.join(temporaryRoot, "npm-cache");
const packDestination = path.join(temporaryRoot, "archive");
const consumerPrefix = path.join(temporaryRoot, "consumer");
const commandEnvironment = { ...process.env, npm_config_cache: npmCache };

const publicSpecifiers = [
  "openrails-sdk",
  "openrails-sdk/shared-interface",
  "openrails-sdk/operations",
  "openrails-sdk/runtime-signature",
  "openrails-sdk/wallet-handoff",
  "openrails-sdk/canonical-record",
  "openrails-sdk/circle-gas-station",
  "openrails-sdk/arc",
  "openrails-sdk/adapters/ethers",
  "openrails-sdk/adapters/privy",
  "openrails-sdk/adapters/turnkey",
  "openrails-sdk/adapters/circle",
  "openrails-sdk/gateway",
];

try {
  fs.mkdirSync(npmCache);
  fs.mkdirSync(packDestination);
  fs.mkdirSync(consumerPrefix);

  const packed = JSON.parse(execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", packDestination],
    { cwd: packageRoot, encoding: "utf8", env: commandEnvironment },
  ));
  assert.equal(packed.length, 1, "npm pack should produce one archive");

  const files = packed[0].files.map((file) => file.path).sort();
  const expectedFiles = [
    "CHANGELOG.md",
    "MIGRATION.md",
    "NOTICE.md",
    "README.md",
    "THIRD_PARTY_LICENSES.md",
    "dist/adapters/circle.js",
    "dist/adapters/ethers.js",
    "dist/adapters/privy.js",
    "dist/adapters/turnkey.js",
    "dist/arc.d.ts",
    "dist/arc.js",
    "dist/canonical-record.d.ts",
    "dist/canonical-record.js",
    "dist/circle-gas-station.d.ts",
    "dist/circle-gas-station.js",
    "dist/generated/shared-interface-runtime.js",
    "dist/generated/shared-interface-operations.js",
    "dist/generated/shared-interface-runtime-signature.js",
    "dist/generated/shared-interface-canonicalize.js",
    "dist/generated/shared-interface.d.ts",
    "dist/gateway.js",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/operations.d.ts",
    "dist/operations.js",
    "dist/runtime-signature.d.ts",
    "dist/runtime-signature.js",
    "dist/shared-interface.d.ts",
    "dist/shared-interface.js",
    "dist/wallet-handoff.d.ts",
    "dist/wallet-handoff.js",
    "package.json",
  ];
  for (const expected of expectedFiles) assert.ok(files.includes(expected), `packed artifact is missing ${expected}`);
  assert.equal(files.some((file) => file.startsWith("src/")), false, "src must not be packed");
  assert.equal(files.some((file) => file.startsWith("test/")), false, "tests must not be packed");
  assert.equal(files.some((file) => file.startsWith("scripts/")), false, "release scripts must not be packed");

  const archive = path.join(packDestination, packed[0].filename);
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-package-lock", "--prefix", consumerPrefix, archive],
    { cwd: temporaryRoot, stdio: "inherit", env: commandEnvironment },
  );

  const consumerRequire = createRequire(path.join(consumerPrefix, "consumer.cjs"));
  for (const specifier of publicSpecifiers) {
    const required = consumerRequire(specifier);
    assert.ok(required && (typeof required === "object" || typeof required === "function"), `${specifier} did not load with require`);
    const resolved = consumerRequire.resolve(specifier);
    const imported = await import(pathToFileURL(resolved).href);
    assert.ok(imported && typeof imported === "object", `${specifier} did not load with import`);
  }

  const packageJson = consumerRequire("openrails-sdk/package.json");
  assert.equal(packageJson.version, "1.1.0-rc.2");
  assert.equal(packageJson.dependencies?.["@openrails/shared-interface"], undefined);
  const installedPackageRoot = path.dirname(consumerRequire.resolve("openrails-sdk/package.json"));
  const notice = fs.readFileSync(path.join(installedPackageRoot, "NOTICE.md"), "utf8");
  const thirdPartyLicenses = fs.readFileSync(path.join(installedPackageRoot, "THIRD_PARTY_LICENSES.md"), "utf8");
  assert.match(notice, /adapted and modified from `canonicalize` 3\.0\.0/);
  assert.match(thirdPartyLicenses, /Apache License/);
  assert.match(thirdPartyLicenses, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.match(thirdPartyLicenses, /END OF TERMS AND CONDITIONS/);

  const root = consumerRequire("openrails-sdk");
  const sharedInterface = consumerRequire("openrails-sdk/shared-interface");
  const operations = consumerRequire("openrails-sdk/operations");
  const runtimeSignature = consumerRequire("openrails-sdk/runtime-signature");
  const walletHandoff = consumerRequire("openrails-sdk/wallet-handoff");
  const arc = consumerRequire("openrails-sdk/arc");
  assert.equal(typeof root.prepareWalletHandoff, "function");
  assert.equal(root.LeptonOpenRailsClient, undefined);
  assert.equal(typeof sharedInterface.resolveOperation, "function");
  assert.equal(typeof operations.createOperationRequest, "function");
  assert.equal(typeof runtimeSignature.hashRuntimePayload, "function");
  assert.equal(sharedInterface.OPENRAILS_SHARED_INTERFACE_VERSION, "1.2.0");
  assert.equal(typeof walletHandoff.verifyWalletHandoff, "function");
  assert.equal(typeof arc.LeptonOpenRailsClient, "function");

  console.log(`Packed SDK clean-consumer smoke passed for ${publicSpecifiers.length + 1} public exports.`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
