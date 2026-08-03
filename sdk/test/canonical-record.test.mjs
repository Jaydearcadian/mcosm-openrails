import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../dist/index.js";

const NETWORK = { networkId: "arc-testnet", chainId: "5042002" };
const HASH = `0x${"11".repeat(32)}`;
const OBSERVED_AT = "2099-08-03T00:00:00Z";

function actor(id) {
  return { type: "Actor", id, network: NETWORK };
}

function makeRecord() {
  const base = {
    interfaceVersion: "1.1.0",
    id: "canonical-record:test:1",
    executionProfile: "direct-wallet-authorized",
    pactRef: { type: "Pact", id: "pact:test:1", network: NETWORK },
    sequence: "0",
    previousCommitment: HASH,
    plaintextCommitment: HASH,
    ciphertextHash: HASH,
    encryption: { mode: "encrypted", algorithm: "xchacha20-poly1305", keyAgreement: "x25519" },
    encryptedKeys: [
      { counterpartyRef: actor("actor:a"), encryptedKey: "0xaa", keyId: "key:a" },
      { counterpartyRef: actor("actor:b"), encryptedKey: "0xbb", keyId: "key:b" },
    ],
    storageLocators: [{ uri: "ipfs://record-test", contentHash: HASH, kind: "ciphertext" }],
    signatures: [
      { actorRef: actor("actor:a"), algorithm: "eip-712", signature: "0x1234", signedAt: OBSERVED_AT, signedCommitment: HASH },
      { actorRef: actor("actor:b"), algorithm: "eip-712", signature: "0x5678", signedAt: OBSERVED_AT, signedCommitment: HASH },
    ],
    settlementReferences: [],
    createdAt: OBSERVED_AT,
    provenance: {
      authority: "canonical-record-test",
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

test("Pact policies can omit, allow, or require a Canonical Record", () => {
  const record = makeRecord();
  assert.equal(api.assertCanonicalRecordPolicy({}, undefined), undefined);
  assert.throws(() => api.assertCanonicalRecordPolicy({}, record), /omits/);
  assert.equal(api.assertCanonicalRecordPolicy({ canonicalRecordPolicy: {
    mode: "optional",
    exposure: "encrypted",
    signatureRequirement: "bilateral-typed-actor-signatures",
  } }, record).id, record.id);
  assert.equal(api.assertCanonicalRecordPolicy({ canonicalRecordPolicy: {
    mode: "optional",
    exposure: "encrypted",
    signatureRequirement: "bilateral-typed-actor-signatures",
  } }, undefined), undefined);
  assert.throws(() => api.assertCanonicalRecordPolicy({ canonicalRecordPolicy: {
    mode: "required",
    exposure: "encrypted",
    signatureRequirement: "bilateral-typed-actor-signatures",
  } }), /requires/);
});

test("verification binds both typed actor signatures to the same envelope commitment", () => {
  const record = makeRecord();
  const verification = api.verifyCanonicalRecord(record, {
    mode: "optional",
    exposure: "encrypted",
    signatureRequirement: "bilateral-typed-actor-signatures",
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.signatureVerification, "NOT_PERFORMED");
  const tampered = {
    ...record,
    signatures: record.signatures.map((signature, index) => index === 0
      ? { ...signature, signedCommitment: `0x${"22".repeat(32)}` }
      : signature),
  };
  assert.equal(api.verifyCanonicalRecord(tampered).valid, false);
});

test("verification enforces the Pact counterparties and an application verifier", async () => {
  const record = makeRecord();
  const counterparties = [actor("actor:a"), actor("actor:b")];
  assert.equal(api.verifyCanonicalRecord(record, undefined, counterparties).valid, true);
  assert.equal(api.verifyCanonicalRecord(record, undefined, [actor("actor:a"), actor("actor:c")]).valid, false);

  const verified = await api.verifyCanonicalRecordSignatures(
    record,
    ({ signature }) => signature.signature === "0x1234" || signature.signature === "0x5678",
    undefined,
    counterparties,
  );
  assert.equal(verified.valid, true);
  assert.equal(verified.signatureVerification, "VERIFIED");

  const rejected = await api.verifyCanonicalRecordSignatures(record, () => false, undefined, counterparties);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.signatureVerification, "FAILED");
});

test("public Canonical Records omit encrypted counterparty keys", () => {
  const encrypted = makeRecord();
  const base = {
    ...encrypted,
    encryption: { mode: "public", algorithm: "none", keyAgreement: "none" },
    encryptedKeys: [],
    signatures: encrypted.signatures.map((signature) => ({ ...signature, signedCommitment: HASH })),
  };
  const commitment = api.canonicalRecordEnvelopeCommitment(base);
  const record = api.createCanonicalRecord({
    ...base,
    signatures: base.signatures.map((signature) => ({ ...signature, signedCommitment: commitment })),
  });
  assert.equal(api.verifyCanonicalRecord(record, {
    mode: "optional",
    exposure: "public",
    signatureRequirement: "bilateral-typed-actor-signatures",
  }, [actor("actor:a"), actor("actor:b")]).valid, true);
  assert.throws(() => api.createCanonicalRecord({ ...record, encryptedKeys: encrypted.encryptedKeys }));
});
