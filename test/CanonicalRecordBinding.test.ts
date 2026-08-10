import { expect } from "chai";
import { ethers } from "hardhat";
import {
  assertValidSchema,
  bindCircleExecutionEvidence,
  canonicalRecordEnvelopeCommitment,
  createCanonicalRecord,
  RECEIPT_SCHEMA,
  type Receipt,
} from "../sdk/src/index";

const NETWORK = { networkId: "arc-testnet", chainId: "5042002" } as const;
const HASH = `0x${"11".repeat(32)}`;
const OBSERVED_AT = "2099-08-03T00:00:00Z";

function actor(id: string) {
  return { type: "Actor" as const, id, network: NETWORK };
}

describe("Canonical Record transaction binding", () => {
  it("binds an actual local transaction receipt to a signature-committed record envelope", async () => {
    const [payer, recipient] = await ethers.getSigners();
    const transaction = await payer.sendTransaction({ to: recipient.address, value: 1n });
    const mined = await transaction.wait();
    expect(mined).to.not.equal(null);

    const transactionHash = mined!.hash;
    const transactionReference = {
      type: "TransactionState" as const,
      id: transactionHash,
      network: NETWORK,
    };
    const recordBase = {
      interfaceVersion: "1.1.0" as const,
      id: "canonical-record:local-transaction:1",
      executionProfile: "direct-wallet-authorized" as const,
      pactRef: { type: "Pact" as const, id: "pact:local-transaction:1", network: NETWORK },
      sequence: "0",
      previousCommitment: HASH,
      plaintextCommitment: HASH,
      ciphertextHash: HASH,
      encryption: { mode: "encrypted" as const, algorithm: "xchacha20-poly1305" as const, keyAgreement: "x25519" as const },
      encryptedKeys: [
        { counterpartyRef: actor("actor:payer"), encryptedKey: "0xaa", keyId: "key:payer" },
        { counterpartyRef: actor("actor:recipient"), encryptedKey: "0xbb", keyId: "key:recipient" },
      ],
      storageLocators: [{ uri: "ipfs://local-transaction", contentHash: HASH, kind: "ciphertext" as const }],
      signatures: [
        { actorRef: actor("actor:payer"), algorithm: "eip-712" as const, signature: "0x1234", signedAt: OBSERVED_AT, signedCommitment: HASH },
        { actorRef: actor("actor:recipient"), algorithm: "eip-712" as const, signature: "0x5678", signedAt: OBSERVED_AT, signedCommitment: HASH },
      ],
      settlementReferences: [{ kind: "transaction" as const, reference: transactionReference }],
      createdAt: OBSERVED_AT,
      provenance: {
        authority: "canonical-record-local-test",
        evidenceLevel: "runtime-observed" as const,
        observedAt: OBSERVED_AT,
        source: "network-observation" as const,
      },
    };
    const commitment = canonicalRecordEnvelopeCommitment(recordBase);
    const record = createCanonicalRecord({
      ...recordBase,
      signatures: recordBase.signatures.map((signature) => ({ ...signature, signedCommitment: commitment })),
    });

    const receipt: Receipt = {
      interfaceVersion: "1.1.0",
      id: "receipt:local-transaction:1",
      executionProfile: "direct-wallet-authorized",
      receiptType: "SETTLEMENT",
      operationId: "paycard.open",
      network: NETWORK,
      transaction: {
        interfaceVersion: "1.1.0",
        status: "CONFIRMED",
        network: NETWORK,
        txHash: transactionHash,
        blockHash: mined!.blockHash,
        blockNumber: String(mined!.blockNumber),
        confirmations: "1",
        financialEffect: "RECONCILIATION_REQUIRED",
        observedAt: OBSERVED_AT,
        confirmedAt: OBSERVED_AT,
      },
      receiptStatus: "VERIFIED",
      financialOutcome: "PENDING",
      verification: { status: "VERIFIED", reasons: [] },
      canonicalReconciliation: { status: "PENDING", observedAt: OBSERVED_AT },
      provenance: {
        authority: "canonical-record-local-test",
        evidenceLevel: "runtime-observed",
        observedAt: OBSERVED_AT,
        source: "network-observation",
      },
      createdAt: OBSERVED_AT,
    };
    assertValidSchema(RECEIPT_SCHEMA, receipt);

    const bound = bindCircleExecutionEvidence(receipt, {
      transactionHash,
      transactionRef: transactionReference,
      observedAt: OBSERVED_AT,
    }, record);

    expect(bound.receipt.canonicalRecordRef?.id).to.equal(record.id);
    expect(bound.canonicalRecordVerification?.valid).to.equal(true);
    expect(bound.requiresResignatures).to.equal(false);
    expect(bound.settlementReferences[0].reference.id).to.equal(transactionHash);
  });
});
