import { ARC_TESTNET_MANIFEST_ARTIFACT } from "./artifacts.js";
import type { NetworkManifest } from "./generated.js";

/** Canonical Arc Testnet manifest shipped with the shared-interface package. */
export const ARC_TESTNET_MANIFEST: NetworkManifest = ARC_TESTNET_MANIFEST_ARTIFACT as NetworkManifest;

/** Return a fresh copy so callers cannot mutate the package-level manifest. */
export function getArcTestnetManifest(): NetworkManifest {
  return JSON.parse(JSON.stringify(ARC_TESTNET_MANIFEST)) as NetworkManifest;
}
