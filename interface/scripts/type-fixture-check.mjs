import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(packageRoot, "test", "type-fixtures", "generated-types.ts");
const tscPath = path.join(packageRoot, "node_modules", "typescript", "bin", "tsc");

if (!fs.existsSync(tscPath)) throw new Error(`TypeScript compiler is missing: ${tscPath}`);

const result = spawnSync(process.execPath, [
  tscPath,
  "--noEmit",
  "--strict",
  "--target", "ES2022",
  "--module", "NodeNext",
  "--moduleResolution", "NodeNext",
  "--types", "node",
  "--skipLibCheck",
  fixturePath
], { cwd: packageRoot, encoding: "utf8" });

if (result.status !== 0) {
  process.stderr.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

console.log("Generated type fixture passed: ExtensionData rejects primitive and non-x-* assignments.");
