import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = require(path.join(sdkRoot, "dist", "index.js"));
const arc = require(path.join(sdkRoot, "dist", "arc.js"));

const NOW = "2026-08-03T00:00:00Z";
const SIGNED_AT = "2026-08-03T00:01:00Z";
const OBSERVED_AT = "2026-08-03T00:02:00Z";
const EXPIRES_AT = "2026-08-04T00:00:00Z";
const WALLET = "0x1111111111111111111111111111111111111111";
const HUB = "0x941C8029F0f912df3fAb7423890ab2359b996D0b";
const NETWORK = { networkId: "arc-testnet", chainId: "5042002" };
const TX_HASH = `0x${"ab".repeat(32)}`;
const BLOCK_HASH = `0x${"3".repeat(64)}`;
const STATE_HASH = `0x${"4".repeat(64)}`;

const provenance = {
  source: "runtime-evaluation",
  authority: "OpenRails SDK test",
  evidenceLevel: "runtime-observed",
  observedAt: NOW,
};

function prepared(overrides = {}) {
  return api.prepareWalletHandoff({
    id: "handoff:test:1",
    operationId: "paycard.open",
    correlationId: "correlation:test:1",
    subject: { walletAddress: WALLET, role: "payer" },
    network: NETWORK,
    preparedRequest: {
      kind: "evm-transaction",
      from: WALLET,
      to: HUB,
      data: "0x1234",
      value: "0",
      chainId: NETWORK.chainId,
    },
    expiresAt: EXPIRES_AT,
    provenance,
    now: NOW,
    ...overrides,
  });
}

function authorized() {
  return api.recordWalletAuthorization(prepared(), {
    signer: WALLET,
    signature: "0x1234",
    signedAt: SIGNED_AT,
    now: SIGNED_AT,
  });
}

function confirmedTransaction(financialEffect = "RECONCILIATION_REQUIRED") {
  return {
    interfaceVersion: "1.1.0",
    status: "CONFIRMED",
    network: NETWORK,
    txHash: TX_HASH,
    blockHash: BLOCK_HASH,
    blockNumber: "123",
    confirmations: "1",
    submittedAt: SIGNED_AT,
    confirmedAt: OBSERVED_AT,
    observedAt: OBSERVED_AT,
    financialEffect,
  };
}

function receipt(status, transactionHash = TX_HASH) {
  const verified = status === "VERIFIED";
  const transaction = confirmedTransaction();
  transaction.txHash = transactionHash;
  return {
    interfaceVersion: "1.1.0",
    id: verified ? "receipt:test:verified" : "receipt:test:unverified",
    executionProfile: "direct-wallet-authorized",
    receiptType: "SETTLEMENT",
    operationId: "paycard.open",
    network: NETWORK,
    transaction,
    receiptStatus: status,
    financialOutcome: verified ? "RECONCILED" : "PENDING",
    verification: verified
      ? {
          status: "VERIFIED",
          reasons: [],
          exact: {
            eventIndex: "0",
            contractAddress: HUB,
            eventName: "PaycardProvisioned",
            eventSignature: "PaycardProvisioned(bytes32,address,address,bytes32,uint256,uint256,uint256,uint256)",
            observedValuesHash: STATE_HASH,
          },
        }
      : {
          status: "UNVERIFIED",
          reasons: ["Canonical Vault reconciliation is pending."],
        },
    canonicalReconciliation: verified
      ? { status: "MATCHED", observedAt: OBSERVED_AT, stateHash: STATE_HASH }
      : { status: "PENDING", observedAt: OBSERVED_AT },
    provenance: {
      ...provenance,
      source: "network-observation",
      observedAt: OBSERVED_AT,
    },
    createdAt: OBSERVED_AT,
  };
}

test("prepares a canonical external-wallet handoff without custody fields", () => {
  const handoff = prepared({ privateKey: "must-not-survive" });
  assert.equal(handoff.interfaceVersion, "1.1.0");
  assert.equal(handoff.operationId, "paycard.open");
  assert.equal(handoff.correlationId, "correlation:test:1");
  assert.equal(handoff.preparedRequest.chainId, NETWORK.chainId);
  assert.equal(handoff.expiresAt, EXPIRES_AT);
  assert.equal(handoff.walletAuthorization.mode, "external-wallet");
  assert.equal(handoff.walletAuthorization.status, "AWAITING_SIGNATURE");
  assert.equal(handoff.transaction.status, "WALLET_REQUIRED");
  assert.equal("privateKey" in handoff, false);
  assert.equal(JSON.stringify(handoff).includes("must-not-survive"), false);
});

test("expires an unsubmitted handoff with an explicit signature-expired error", () => {
  const handoff = api.expireWalletHandoff(prepared(), EXPIRES_AT);
  assert.equal(handoff.lifecycleState, "FAILED");
  assert.equal(handoff.walletAuthorization.status, "EXPIRED");
  assert.equal(handoff.transaction.status, "NOT_REQUESTED");
  assert.equal(handoff.errors.some((error) => error.code === "SIGNATURE_EXPIRED"), true);
});

test("rejects a prepared request for the wrong network", () => {
  assert.throws(
    () => prepared({
      preparedRequest: {
        kind: "evm-transaction",
        from: WALLET,
        to: HUB,
        data: "0x1234",
        value: "0",
        chainId: "1",
      },
    }),
    (error) => error instanceof api.WalletHandoffValidationError && error.code === "WRONG_NETWORK",
  );

  const verification = api.verifyWalletHandoff(prepared(), { networkId: "ethereum", chainId: "1" }, NOW);
  assert.equal(verification.valid, false);
  assert.equal(verification.errors.some((error) => error.code === "WRONG_NETWORK"), true);
});

test("rejects an external signature recorded at or after handoff expiry", () => {
  assert.throws(
    () => api.recordWalletAuthorization(prepared(), {
      signer: WALLET,
      signature: "0x1234",
      signedAt: EXPIRES_AT,
      now: EXPIRES_AT,
    }),
    (error) => error instanceof api.WalletHandoffValidationError && error.code === "SIGNATURE_EXPIRED",
  );
});

test("records a reverted external-wallet transaction as failed", () => {
  const handoff = api.recordWalletSubmission(authorized(), {
    interfaceVersion: "1.1.0",
    status: "REVERTED",
    network: NETWORK,
    txHash: TX_HASH,
    submittedAt: SIGNED_AT,
    failureCode: "TRANSACTION_REVERTED",
    failureReason: "Execution reverted.",
    financialEffect: "NONE",
    observedAt: OBSERVED_AT,
  });
  const verification = api.verifyWalletHandoff(handoff, NETWORK, OBSERVED_AT);
  assert.equal(handoff.lifecycleState, "FAILED");
  assert.equal(verification.valid, false);
  assert.equal(handoff.errors.some((error) => error.code === "TRANSACTION_REVERTED"), true);
});

test("does not claim financial success for an unverified receipt", () => {
  const confirmed = api.recordWalletSubmission(authorized(), confirmedTransaction());
  const handoff = api.recordWalletReceiptVerification(confirmed, receipt("UNVERIFIED"), OBSERVED_AT);
  const verification = api.verifyWalletHandoff(handoff, NETWORK, OBSERVED_AT);
  assert.equal(handoff.lifecycleState, "SETTLING");
  assert.equal(handoff.receiptVerification.status, "UNVERIFIED");
  assert.equal(verification.valid, true);
  assert.equal(verification.receiptVerified, false);
  assert.equal(verification.financialSuccess, false);
  assert.equal(handoff.errors.some((error) => error.code === "RECEIPT_UNVERIFIED"), true);
});

test("rejects receipt verification before a confirmed submission is recorded", () => {
  const handoff = authorized();
  const snapshot = structuredClone(handoff);
  assert.throws(
    () => api.recordWalletReceiptVerification(handoff, receipt("VERIFIED"), OBSERVED_AT),
    (error) => error instanceof api.WalletHandoffValidationError
      && error.code === "STATE_STALE"
      && /previously recorded confirmed transaction/.test(error.message),
  );
  assert.deepEqual(handoff, snapshot);
});

test("rejects a receipt bound to a different transaction hash", () => {
  const handoff = api.recordWalletSubmission(authorized(), confirmedTransaction());
  const snapshot = structuredClone(handoff);
  assert.throws(
    () => api.recordWalletReceiptVerification(handoff, receipt("VERIFIED", `0x${"cd".repeat(32)}`), OBSERVED_AT),
    (error) => error instanceof api.WalletHandoffValidationError
      && error.code === "RECEIPT_UNVERIFIED"
      && /does not match/.test(error.message),
  );
  assert.deepEqual(handoff, snapshot);
});

test("requires a verified receipt and matched reconciliation for financial success", () => {
  const confirmed = api.recordWalletSubmission(authorized(), confirmedTransaction());
  const uppercaseHash = `0x${TX_HASH.slice(2).toUpperCase()}`;
  const handoff = api.recordWalletReceiptVerification(confirmed, receipt("VERIFIED", uppercaseHash), OBSERVED_AT);
  const verification = api.verifyWalletHandoff(handoff, NETWORK, OBSERVED_AT);
  assert.equal(handoff.lifecycleState, "SETTLED");
  assert.equal(handoff.receiptVerification.status, "VERIFIED");
  assert.equal(verification.valid, true);
  assert.equal(verification.receiptVerified, true);
  assert.equal(verification.financialSuccess, true);
  assert.equal(api.assertWalletHandoffReadyForFinancialSuccess(handoff), handoff);
});

test("keeps private-key, signer creation, and broadcast APIs out of the safe root", () => {
  const prohibitedExports = [
    "LeptonOpenRailsClient",
    "OpenRailsArcClient",
    "RelayClient",
    "approveOpenRailsSpend",
    "payGasless",
    "claimGasless",
    "signPermissionEnvelopeWithSigner",
    "submitOpenPaycardWithSigner",
    "submitSettleWithSigner",
    "submitFlushWithSigner",
    "ethersToSubmitter",
  ];
  for (const name of prohibitedExports) assert.equal(api[name], undefined, `${name} leaked into the safe root`);

  const autonomousKeys = Object.keys(api).filter((name) => /private.?key|^(?:sign|submit|broadcast|sendTransaction|createSigner)/i.test(name));
  assert.deepEqual(autonomousKeys, []);
  assert.equal(typeof api.prepareWalletHandoff, "function");
  assert.equal(typeof api.recordWalletSubmission, "function");
  assert.equal(typeof arc.LeptonOpenRailsClient, "function");

  const safeDeclarations = ["index.d.ts", "shared-interface.d.ts", "operations.d.ts", "wallet-handoff.d.ts"]
    .map((file) => fs.readFileSync(path.join(sdkRoot, "dist", file), "utf8"))
    .join("\n");
  assert.doesNotMatch(safeDeclarations, /\bprivateKey\b|\bPrivateKey\b|\bcreateSigner\b|\bsendTransaction\b|\bbroadcastTransaction\b/);
});
