import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline";

import dotenv from "dotenv";
import { ethers } from "ethers";

type Scope = "root" | "cockpit";
type ValueKind = "text" | "url" | "address" | "chainId" | "privateKey" | "token";

interface Spec {
  name: string;
  scope: Scope;
  kind: ValueKind;
  required?: boolean;
  secret?: boolean;
  defaultValue?: string;
}

interface LoadedFile {
  path: string;
  values: Record<string, string>;
}

interface ProbeResult {
  ok: boolean;
  detail: string;
}

interface CommandInvocation {
  command: string;
  prefix: string[];
}

const repoRoot = path.resolve(__dirname, "..");
const rootEnvPath = path.join(repoRoot, ".env");
const cockpitEnvPath = path.join(repoRoot, "cockpit", ".env.local");
const checkOnly = process.argv.includes("--check");
const replaceExisting = process.argv.includes("--replace-existing");
const syncCloudflare = process.argv.includes("--sync-cloudflare");
const useNpxWrangler = process.argv.includes("--npx-wrangler");

const loadedRoot = loadEnvFile(rootEnvPath);
const loadedCockpit = loadEnvFile(cockpitEnvPath);
const collectedRoot: Record<string, string> = {};
const collectedCockpit: Record<string, string> = {};
const warnings: string[] = [];
const failures: string[] = [];

const rootSpecs: Spec[] = [
  { name: "ARC_RPC_URL", scope: "root", kind: "url", required: true, defaultValue: "https://rpc.testnet.arc.io" },
  { name: "ARC_CANTEEN_RPC_URL", scope: "root", kind: "url", required: true, secret: true },
  { name: "ARC_RPC_FALLBACK_URL", scope: "root", kind: "url", required: false, defaultValue: "https://rpc.drpc.testnet.arc.io" },
  { name: "ARC_CHAIN_ID", scope: "root", kind: "chainId", required: true, defaultValue: "5042002" },
  { name: "ARC_USDC_ADDRESS", scope: "root", kind: "address", required: true, defaultValue: "0x3600000000000000000000000000000000000000" },
  { name: "ARC_OPENRAILS_HUB_ADDRESS", scope: "root", kind: "address", required: true, defaultValue: "0x941C8029F0f912df3fAb7423890ab2359b996D0b" },
  { name: "ARC_EXPLORER_BASE_URL", scope: "root", kind: "url", required: true, defaultValue: "https://testnet.arcscan.app" },
  { name: "OPENRAILS_DASHBOARD_MODE", scope: "root", kind: "text", required: true, defaultValue: "arc-testnet" },
  { name: "OPENRAILS_DEPLOYMENT_REGISTRY_PATH", scope: "root", kind: "text", required: true, defaultValue: "deployments/openrails-addresses.local.json" },
  { name: "DEPLOYER_PRIVATE_KEY", scope: "root", kind: "privateKey", required: true, secret: true },
  { name: "OPENRAILS_PAYER_PRIVATE_KEY", scope: "root", kind: "privateKey", required: true, secret: true },
  { name: "OPENRAILS_RELAYER_PRIVATE_KEY", scope: "root", kind: "privateKey", required: false, secret: true },
  { name: "OPENRAILS_RECIPIENT_ADDRESS", scope: "root", kind: "address", required: true },
  { name: "OPENRAILS_CLAIM_RECIPIENT_ADDRESS", scope: "root", kind: "address", required: true },
  { name: "OPENRAILS_RECOVERY_ADDRESS", scope: "root", kind: "address", required: true },
  { name: "OPENRAILS_DEMO_FLUSH_PRIVATE_KEY", scope: "root", kind: "privateKey", required: false, secret: true },
];

const cockpitSpecs: Spec[] = [
  { name: "VITE_PRIVY_APP_ID", scope: "cockpit", kind: "text", required: true },
  { name: "VITE_CIRCLE_CLIENT_KEY", scope: "cockpit", kind: "token", required: false, secret: true },
  { name: "VITE_CIRCLE_CLIENT_URL", scope: "cockpit", kind: "url", required: false, defaultValue: "https://modular-sdk.circle.com/v1/rpc/w3s/buidl" },
  { name: "VITE_ARC_RPC_URL", scope: "cockpit", kind: "url", required: false, defaultValue: "https://rpc.testnet.arc.io" },
  { name: "VITE_OPENRAILS_API_BASE", scope: "cockpit", kind: "url", required: false },
  { name: "VITE_OPENRAILS_RELAY_URL", scope: "cockpit", kind: "url", required: false },
  { name: "VITE_OPENRAILS_FAUCET_BASE", scope: "cockpit", kind: "url", required: false },
  { name: "VITE_OPENRAILS_INDEXER_BASE", scope: "cockpit", kind: "url", required: false },
];

const workerSecrets = [
  { directory: "workers/faucet-worker", workerName: "openrails-faucet-worker", names: ["ARC_CANTEEN_RPC_URL", "FAUCET_SIGNER_KEY", "FAUCET_ADMIN_TOKEN"] },
  { directory: "workers/indexer-worker", workerName: "openrails-indexer-worker", names: ["ARC_CANTEEN_RPC_URL", "INDEXER_ADMIN_TOKEN"] },
  { directory: "workers/music-scrobble-worker", workerName: "openrails-music-scrobble-worker", names: ["ARC_CANTEEN_RPC_URL"] },
  { directory: "workers/reconciliation-worker", workerName: "openrails-reconciliation-worker", names: ["ARC_CANTEEN_RPC_URL", "RECONCILIATION_SIGNER_KEY", "RECONCILIATION_ADMIN_TOKEN"] },
  { directory: "workers/x402-gateway-worker", workerName: "openrails-x402-gateway", names: ["ARC_CANTEEN_RPC_URL", "X402_ADMIN_TOKEN"] },
];

function loadEnvFile(filePath: string): LoadedFile {
  if (!fs.existsSync(filePath)) return { path: filePath, values: {} };
  return { path: filePath, values: dotenv.parse(fs.readFileSync(filePath, "utf8")) };
}

function currentValue(spec: Spec): string | undefined {
  const file = spec.scope === "root" ? loadedRoot.values : loadedCockpit.values;
  return process.env[spec.name] ?? file[spec.name];
}

function valueSource(spec: Spec): string {
  if (process.env[spec.name] !== undefined) return "shell";
  if (spec.scope === "root" && loadedRoot.values[spec.name] !== undefined) return ".env";
  if (spec.scope === "cockpit" && loadedCockpit.values[spec.name] !== undefined) return "cockpit/.env.local";
  return "none";
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "0" ||
    normalized === "" ||
    normalized.includes("replace-with") ||
    normalized.includes("example.invalid") ||
    normalized.includes("your-") ||
    normalized.includes("test_client_key") ||
    normalized.includes("test-client-key") ||
    normalized.includes("<") ||
    normalized.includes(">");
}

function validateValue(spec: Spec, value: string | undefined): string | undefined {
  if (!value || isPlaceholder(value)) return spec.required ? "missing or placeholder" : undefined;
  const trimmed = value.trim();

  if (spec.kind === "url") {
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/u.test(parsed.protocol)) return "must use http or https";
    } catch {
      return "must be a valid http(s) URL";
    }
  }
  if (spec.kind === "address" && !ethers.isAddress(trimmed)) return "must be a valid EVM address";
  if (spec.kind === "chainId" && (!/^\d+$/u.test(trimmed) || Number(trimmed) <= 0)) return "must be a positive integer";
  if (spec.kind === "privateKey" && !/^(0x)?[0-9a-fA-F]{64}$/u.test(trimmed)) return "must be a 32-byte hex private key";
  if (spec.name === "OPENRAILS_DASHBOARD_MODE" && !["local", "arc-testnet"].includes(trimmed)) return "must be local or arc-testnet";
  return undefined;
}

function destination(scope: Scope): Record<string, string> {
  return scope === "root" ? collectedRoot : collectedCockpit;
}

function formatEnvValue(value: string): string {
  return JSON.stringify(value);
}

function upsertEnvFile(filePath: string, values: Record<string, string>): void {
  let contents = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (contents && !contents.endsWith("\n")) contents += "\n";

  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${formatEnvValue(value)}`;
    const matcher = new RegExp(`^${escapeRegExp(name)}=.*$`, "mu");
    if (matcher.test(contents)) contents = contents.replace(matcher, line);
    else contents += `${line}\n`;
  }

  fs.writeFileSync(filePath, contents, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function askLine(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(label, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(label: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdin.setRawMode) {
    return Promise.reject(new Error(`${label.trim()} requires an interactive terminal`));
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("input cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
    };

    stdout.write(label);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function persistCollected(scope: Scope): void {
  const values = scope === "root" ? collectedRoot : collectedCockpit;
  if (Object.keys(values).length === 0) return;
  upsertEnvFile(scope === "root" ? rootEnvPath : cockpitEnvPath, values);
}

async function collectSpec(spec: Spec): Promise<void> {
  const existing = currentValue(spec);
  const existingError = validateValue(spec, existing);

  if (existing && !existingError && !replaceExisting) {
    console.log(`${spec.name}: existing (${valueSource(spec)})`);
    destination(spec.scope)[spec.name] = existing;
    return;
  }

  if (checkOnly) {
    if (existingError) {
      const message = `${spec.name}: ${existingError}`;
      if (spec.required) failures.push(message);
      else warnings.push(message);
    } else if (existing) {
      console.log(`${spec.name}: configured (${valueSource(spec)})`);
      destination(spec.scope)[spec.name] = existing;
    } else if (spec.defaultValue) {
      console.log(`${spec.name}: optional, default available`);
      destination(spec.scope)[spec.name] = spec.defaultValue;
    } else {
      console.log(`${spec.name}: optional, not configured`);
    }
    return;
  }

  const suffix = spec.defaultValue ? ` [${spec.defaultValue}]` : spec.required ? "" : " (optional, blank to skip)";
  let answer: string;
  if (spec.secret) answer = await askSecret(`${spec.name}${suffix}: `);
  else answer = await askLine(`${spec.name}${suffix}: `);
  if (!answer && spec.defaultValue) answer = spec.defaultValue;

  const error = validateValue(spec, answer);
  if (error) {
    throw new Error(`${spec.name}: ${error}`);
  }
  if (answer) {
    destination(spec.scope)[spec.name] = answer;
    persistCollected(spec.scope);
  }
}

function commandExists(command: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function runBounded(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    stdio?: "ignore" | ["ignore" | "pipe", "ignore" | "pipe", "ignore" | "pipe"];
    encoding?: "utf8";
    timeout: number;
  },
) {
  const seconds = Math.max(1, Math.ceil(options.timeout / 1_000));
  const boundedArgs = [`${seconds}s`, command, ...args];
  if (commandExists("timeout")) {
    return spawnSync("timeout", boundedArgs, {
      cwd: options.cwd,
      input: options.input,
      stdio: options.stdio,
      encoding: "utf8",
      timeout: options.timeout + 2_000,
    });
  }
  return spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    stdio: options.stdio,
    encoding: "utf8",
    timeout: options.timeout,
  });
}

function runProbe(command: string, args: string[], cwd = repoRoot, timeout = 15_000): ProbeResult {
  if (!commandExists(command)) return { ok: false, detail: `${command} not found on PATH` };
  const result = runBounded(command, args, {
    cwd,
    stdio: "ignore",
    timeout,
  });
  if (result.status === 124 || result.error?.name === "ETIMEDOUT") return { ok: false, detail: `${command} timed out` };
  if (result.status === 0) return { ok: true, detail: "authenticated and responding" };
  return { ok: false, detail: `${command} returned a non-zero status` };
}

async function checkRpc(name: string, url: string | undefined, chainId: number): Promise<void> {
  if (!url) {
    warnings.push(`${name}: not configured`);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    });
    if (!response.ok) {
      failures.push(`${name}: HTTP ${response.status}`);
      return;
    }
    const body = await response.json() as { result?: string; error?: unknown };
    if (body.error || !body.result) {
      failures.push(`${name}: JSON-RPC error`);
      return;
    }
    const actualChainId = Number.parseInt(body.result, 16);
    if (actualChainId !== chainId) {
      failures.push(`${name}: reported chain ${actualChainId}, expected ${chainId}`);
      return;
    }
    console.log(`${name}: reachable on chain ${actualChainId}`);
  } catch {
    failures.push(`${name}: unreachable or timed out`);
  } finally {
    clearTimeout(timeout);
  }
}

function checkLocalFile(file: LoadedFile): void {
  if (!fs.existsSync(file.path)) {
    failures.push(`${path.relative(repoRoot, file.path)}: missing`);
    return;
  }
  const mode = fs.statSync(file.path).mode & 0o777;
  if ((mode & 0o077) !== 0) warnings.push(`${path.relative(repoRoot, file.path)}: permissions are ${mode.toString(8)}, expected 600`);
  else console.log(`${path.relative(repoRoot, file.path)}: present with private permissions`);
}

function checkTrackedSecrets(): void {
  let tracked = false;
  for (const filePath of [".env", "cockpit/.env.local"]) {
    const result = spawnSync("git", ["ls-files", "--error-unmatch", filePath], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    if (result.status === 0) {
      tracked = true;
      failures.push(`${filePath}: secret-bearing env file is tracked by git`);
    }
  }
  if (!tracked) console.log("git: local env files are not tracked");
}

function getCollected(name: string): string | undefined {
  return collectedRoot[name] ?? collectedCockpit[name] ?? process.env[name] ?? loadedRoot.values[name] ?? loadedCockpit.values[name];
}

function extractKnownNames(output: string, names: string[]): Set<string> {
  return new Set(names.filter((name) => output.includes(name)));
}

function summarizeCommandFailure(value: unknown): string {
  return String(value ?? "")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/((?:token|secret|key)\s*[=:]\s*)\S+/giu, "$1[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function wranglerInvocation(): CommandInvocation | undefined {
  if (commandExists("wrangler")) return { command: "wrangler", prefix: [] };
  if (useNpxWrangler && commandExists("npx")) return { command: "npx", prefix: ["--yes", "wrangler"] };
  return undefined;
}

function listWorkerSecrets(directory: string, workerName: string, names: string[], wrangler: CommandInvocation): Set<string> | undefined {
  const result = runBounded(wrangler.command, [
    ...wrangler.prefix,
    "secret",
    "list",
    "--config",
    "wrangler.toml",
    "--name",
    workerName,
    "--format",
    "json",
  ], {
    cwd: path.join(repoRoot, directory),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  });
  if (result.status !== 0 || !result.stdout) {
    const detail = summarizeCommandFailure(result.stderr || result.stdout);
    warnings.push(`${directory}: could not list existing Worker secrets${detail ? ` (${detail})` : ""}`);
    return undefined;
  }
  return extractKnownNames(result.stdout, names);
}

function putWorkerSecret(directory: string, workerName: string, name: string, value: string, wrangler: CommandInvocation): boolean {
  const result = runBounded(wrangler.command, [
    ...wrangler.prefix,
    "secret",
    "put",
    name,
    "--config",
    "wrangler.toml",
    "--name",
    workerName,
  ], {
    cwd: path.join(repoRoot, directory),
    input: `${value}\n`,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 30_000,
  });
  return result.status === 0;
}

async function syncWorkerSecrets(): Promise<void> {
  const wrangler = wranglerInvocation();
  if (!wrangler) {
    failures.push("Cloudflare sync: wrangler not found on PATH");
    return;
  }
  const auth = runProbe(wrangler.command, [...wrangler.prefix, "whoami"], repoRoot, 60_000);
  if (!auth.ok) {
    failures.push(`Cloudflare sync: ${auth.detail}`);
    return;
  }
  console.log("Cloudflare: Wrangler authentication confirmed");

  for (const worker of workerSecrets) {
    const existing = listWorkerSecrets(worker.directory, worker.workerName, worker.names, wrangler);
    if (!existing) continue;
    console.log(`${worker.directory}: checked ${worker.names.length} secret names`);
    for (const name of worker.names) {
      if (existing.has(name) && !replaceExisting) {
        console.log(`${worker.directory}/${name}: existing, retained`);
        continue;
      }

      let value = getCollected(name);
      if (!value && !checkOnly) {
        value = await askSecret(`${worker.directory}/${name}: `);
      }
      if (!value) {
        warnings.push(`${worker.directory}/${name}: not supplied`);
        continue;
      }
      if (!putWorkerSecret(worker.directory, worker.workerName, name, value, wrangler)) {
        failures.push(`${worker.directory}/${name}: Wrangler rejected secret update`);
      } else {
        console.log(`${worker.directory}/${name}: provisioned`);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(checkOnly ? "OpenRails harness check" : "OpenRails harness setup");
  console.log("Existing valid values are retained. Secret values are never printed.\n");

  for (const spec of [...rootSpecs, ...cockpitSpecs]) {
    await collectSpec(spec);
  }

  if (!checkOnly) {
    if (Object.keys(collectedRoot).length > 0) upsertEnvFile(rootEnvPath, collectedRoot);
    if (Object.keys(collectedCockpit).length > 0) upsertEnvFile(cockpitEnvPath, collectedCockpit);
    console.log("\nLocal configuration written to ignored env files.");
  }

  const merged = { ...loadedRoot.values, ...loadedCockpit.values, ...collectedRoot, ...collectedCockpit, ...process.env };
  const chainId = Number(merged.ARC_CHAIN_ID || "5042002");
  await Promise.all([
    checkRpc("Arc Canteen RPC", merged.ARC_CANTEEN_RPC_URL, chainId),
    checkRpc("Arc fallback RPC", merged.ARC_RPC_URL, chainId),
  ]);

  for (const [label, command, args] of [
    ["GitHub CLI", "gh", ["auth", "status"]],
    ["Arc Canteen CLI", "arc-canteen", ["rpc", "eth_blockNumber"]],
  ] as const) {
    const probeTimeout = label === "Arc Canteen CLI" ? 15_000 : 5_000;
    const result = runProbe(command, [...args], repoRoot, probeTimeout);
    if (result.ok) console.log(`${label}: ${result.detail}`);
    else warnings.push(`${label}: ${result.detail}`);
  }

  const wrangler = wranglerInvocation();
  if (wrangler && !syncCloudflare) {
    const result = runProbe(wrangler.command, [...wrangler.prefix, "whoami"], repoRoot, 30_000);
    if (result.ok) console.log(`Wrangler CLI: ${result.detail}`);
    else warnings.push(`Wrangler CLI: ${result.detail}`);
  } else if (!wrangler && useNpxWrangler) {
    warnings.push("Wrangler CLI: npx is not available on PATH");
  } else if (!wrangler && commandExists("npx")) {
    warnings.push("Wrangler CLI: not checked; use --npx-wrangler to run npx wrangler");
  } else if (!wrangler) {
    warnings.push("Wrangler CLI: wrangler and npx are not available on PATH");
  }

  if (process.env.NPM_TOKEN) {
    const npmResult = runProbe("npm", ["whoami"], repoRoot, 5_000);
    if (npmResult.ok) console.log(`NPM registry: ${npmResult.detail}`);
    else warnings.push(`NPM registry: ${npmResult.detail}`);
  } else {
    console.log("NPM registry: skipped (publication-only; set NPM_TOKEN only for the release gate)");
  }

  const chromium = ["chromium", "chromium-browser", "google-chrome"].find(commandExists);
  if (chromium) console.log(`Browser: ${chromium} found`);
  else warnings.push("Browser: Chromium executable not found on PATH");

  checkLocalFile({ path: rootEnvPath, values: loadedRoot.values });
  checkLocalFile({ path: cockpitEnvPath, values: loadedCockpit.values });
  checkTrackedSecrets();

  if (syncCloudflare) await syncWorkerSecrets();
  else console.log("Cloudflare Worker secrets: not changed (use --sync-cloudflare to inspect and provision them)");

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("\nHarness preflight completed without blocking failures.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Harness setup failed");
  process.exitCode = 1;
});
