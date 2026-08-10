import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const NETWORK = { networkId: "arc-testnet", chainId: "5042002" };
const WALLET = "0x1111111111111111111111111111111111111111";
const HUB = "0x941C8029F0f912df3fAb7423890ab2359b996D0b";
const TX_HASH = `0x${"ab".repeat(32)}`;
const HASH = `0x${"cd".repeat(32)}`;
const OBSERVED_AT = "2026-08-03T00:02:00Z";

function actor(id) {
  return { type: "Actor", id, network: NETWORK };
}

function record() {
  const base = {
    interfaceVersion: "1.1.0",
    id: "canonical-record:circle:1",
    executionProfile: "direct-wallet-authorized",
    pactRef: { type: "Pact", id: "pact:circle:1", network: NETWORK },
    sequence: "0",
    previousCommitment: HASH,
    plaintextCommitment: HASH,
    ciphertextHash: HASH,
    encryption: { mode: "encrypted", algorithm: "xchacha20-poly1305", keyAgreement: "x25519" },
    encryptedKeys: [
      { counterpartyRef: actor("actor:payer"), encryptedKey: "0xaaaa", keyId: "key:payer" },
      { counterpartyRef: actor("actor:recipient"), encryptedKey: "0xbbbb", keyId: "key:recipient" },
    ],
    storageLocators: [{ uri: "ipfs://circle-ciphertext", contentHash: HASH, kind: "ciphertext" }],
    signatures: [
      { actorRef: actor("actor:payer"), algorithm: "eip-712", signature: "0x1234", signedAt: OBSERVED_AT, signedCommitment: HASH },
      { actorRef: actor("actor:recipient"), algorithm: "eip-712", signature: "0x5678", signedAt: OBSERVED_AT, signedCommitment: HASH },
    ],
    settlementReferences: [{
      kind: "transaction",
      reference: { type: "TransactionState", id: TX_HASH, network: NETWORK },
    }],
    createdAt: OBSERVED_AT,
    provenance: {
      authority: "circle-test",
      evidenceLevel: "runtime-observed",
      observedAt: OBSERVED_AT,
      source: "operator-record",
    },
  };
  const commitment = api.canonicalRecordEnvelopeCommitment(base);
  return api.createCanonicalRecord({
    ...base,
    signatures: base.signatures.map((signature) => ({ ...signature, signedCommitment: commitment })),
  });
}

function receipt() {
  return {
    interfaceVersion: "1.1.0",
    id: "receipt:circle:1",
    executionProfile: "direct-wallet-authorized",
    receiptType: "SETTLEMENT",
    operationId: "paycard.open",
    network: NETWORK,
    transaction: {
      interfaceVersion: "1.1.0",
      status: "CONFIRMED",
      network: NETWORK,
      txHash: TX_HASH,
      financialEffect: "RECONCILIATION_REQUIRED",
      observedAt: OBSERVED_AT,
      confirmedAt: OBSERVED_AT,
    },
    receiptStatus: "VERIFIED",
    financialOutcome: "RECONCILED",
    verification: {
      status: "VERIFIED",
      reasons: [],
      exact: {
        eventIndex: "0",
        contractAddress: HUB,
        eventName: "PaycardProvisioned",
        eventSignature: "PaycardProvisioned(bytes32,address,address)",
        observedValuesHash: HASH,
      },
    },
    canonicalReconciliation: { status: "MATCHED", observedAt: OBSERVED_AT, stateHash: HASH },
    provenance: {
      authority: "circle-test",
      evidenceLevel: "runtime-observed",
      observedAt: OBSERVED_AT,
      source: "network-observation",
    },
    createdAt: OBSERVED_AT,
  };
}

const call = {
  walletId: "circle-wallet:1",
  walletAddress: WALLET,
  contractAddress: HUB,
  calldata: "0x1234",
  value: "0",
  operationId: "paycard.open",
  expiresAt: "2099-08-03T00:10:00Z",
};

test("prepares an Arc SCA Gas Station handoff without credentials or key custody", async () => {
  const adapter = new api.CircleGasStationAdapter({ credentialsPresent: false });
  const prepared = await adapter.prepare(call);
  assert.equal(prepared.circle.capability.status, "UNAVAILABLE");
  assert.equal(prepared.circle.requestId, null);
  assert.equal(prepared.circle.sponsorshipConfirmed, false);
  assert.equal(prepared.circle.liveExecutionProven, false);
  assert.equal(prepared.handoff.preparedRequest.from, WALLET);
  assert.equal(prepared.handoff.preparedRequest.to, HUB);
  assert.equal(prepared.handoff.walletAuthorization.mode, "external-wallet");
  assert.equal(JSON.stringify(prepared).includes("privateKey"), false);
});

test("uses an injected Circle runtime only as a credential-gated preparation adapter", async () => {
  let observed;
  const adapter = new api.CircleGasStationAdapter({
    credentialsPresent: true,
    runtime: {
      async prepareContractCall(request) {
        observed = request;
        return { requestId: "circle-request:1", providerStatus: "queued" };
      },
    },
  });
  const prepared = await adapter.prepare(call);
  assert.equal(observed.accountType, "SCA");
  assert.equal(observed.chain, "ARC-TESTNET");
  assert.equal(observed.chainId, "5042002");
  assert.equal(observed.gasStationContractAddress, api.CIRCLE_GAS_STATION_CONTRACT_ADDRESS);
  assert.equal(prepared.circle.capability.status, "DEMONSTRATION");
  assert.equal(prepared.circle.requestId, "circle-request:1");
  assert.equal(prepared.circle.liveExecutionProven, false);
});

test("binds Circle transaction evidence to receipt and record references", () => {
  const bound = api.bindCircleExecutionEvidence(receipt(), {
    transactionHash: TX_HASH,
    observedAt: OBSERVED_AT,
  }, record());
  assert.equal(bound.receipt.canonicalRecordRef.id, "canonical-record:circle:1");
  assert.equal(bound.canonicalRecordVerification.valid, true);
  assert.equal(bound.requiresResignatures, false);
  assert.equal(bound.settlementReferences[0].reference.id, TX_HASH);
});
