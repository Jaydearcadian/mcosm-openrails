/**
 * Compatibility barrel for the pre-1.0 Arc-specific SDK surface.
 *
 * This namespace retains the signer, relay, and transaction helpers shipped by
 * the 0.x Arc line. The package root is the Shared Interface 1.1 safe surface.
 */

export * from "./client";
export * from "./account";
export * from "./permit";
export * from "./relay";
export * from "./errors";
export * from "./serialization";
export * from "./nonce";
export * from "./factory";
export * from "./policy";
export * from "./proof";
export * from "./metadata";
export * from "./links";
export * from "./access";
export * from "./wallet";
export * from "./receipts";
