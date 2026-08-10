import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const scratch = join(root, ".pack-smoke");

await rm(scratch, { recursive: true, force: true });
try {
  await mkdir(scratch, { recursive: true });
  await execFileAsync("npm", ["pack", "--ignore-scripts", "--pack-destination", scratch, "--cache", "/tmp/openrails-npm-cache"], { cwd: root });
  const archive = (await readdir(scratch)).find((entry) => entry.endsWith(".tgz"));
  assert.ok(archive);

  await execFileAsync("tar", ["-xzf", join(scratch, archive), "-C", scratch]);
  const packedRoot = join(scratch, "package");
  for (const file of ["dist/index.js", "README.md", "SECURITY.md", "NOTICE.md", "migrations/001_runtime.sql"]) {
    await readFile(join(packedRoot, file));
  }
  await mkdir(join(packedRoot, "node_modules", "@openrails"), { recursive: true });
  for (const dependency of ["ethers", "canonicalize"]) {
    await symlink(resolve(root, "node_modules", dependency), join(packedRoot, "node_modules", dependency));
  }
  await symlink(resolve(root, "node_modules", "@openrails", "shared-interface"), join(packedRoot, "node_modules", "@openrails", "shared-interface"));
  const packedApi = await import(pathToFileURL(join(packedRoot, "dist", "index.js")).href);
  assert.equal(typeof packedApi.Runtime, "function");
  assert.equal(typeof packedApi.MemoryRuntimeStore, "function");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
