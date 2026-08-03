import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkManifest } from "./generated.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readManifest(fileName: string): NetworkManifest {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "manifests", fileName), "utf8")) as NetworkManifest;
}

/** Canonical Arc Testnet manifest shipped with the shared-interface package. */
export const ARC_TESTNET_MANIFEST: NetworkManifest = readManifest("arc-testnet.json");

/** Return a fresh copy so callers cannot mutate the package-level manifest. */
export function getArcTestnetManifest(): NetworkManifest {
  return JSON.parse(JSON.stringify(ARC_TESTNET_MANIFEST)) as NetworkManifest;
}
