import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as api from "../dist/index.js";
import * as runtimeSignature from "../dist/runtime-signature.js";

const NETWORK = { networkId: "arc-testnet", chainId: "5042002" };
const FIXTURE_ROOT = new URL("../../interface/fixtures/", import.meta.url);

function fixture(name) {
  return JSON.parse(fs.readFileSync(fileURLToPath(new URL(name, FIXTURE_ROOT)), "utf8"));
}

function envelope(operationId, data, references = {}) {
  const binding = data.signatureBinding;
  return {
    interfaceVersion: "1.2.0",
    executionProfile: "delegated-runtime",
    operationId,
    capability: operationId,
    authorizationClass: "RELAY_SIGNED_ENVELOPE",
    subject: { walletAddress: binding.signer, role: "owner" },
    network: NETWORK,
    data,
    provenance: {
      source: "runtime-evaluation",
      authority: "OpenRails SDK test",
      evidenceLevel: "runtime-observed",
      observedAt: "2026-08-08T00:00:00Z",
    },
    createdAt: "2026-08-08T00:00:00Z",
    ...references,
  };
}

test("ships the canonical Shared Interface 1.2 registry and Arc manifest", () => {
  assert.equal(api.OPENRAILS_SHARED_INTERFACE_VERSION, "1.2.0");
  assert.equal(api.getArcTestnetManifest().interfaceVersion, "1.2.0");
  assert.deepEqual(api.SIGNED_RUNTIME_TRANSITION_OPERATIONS, [
    "workspace.register",
    "actor.register",
    "path.activate",
    "path.revoke",
    "intent.prepare",
    "proposal.evaluate",
    "proposal.submit",
    "pact.sign",
    "proof.submit",
    "proof.verify",
  ]);
  assert.equal(api.resolveOperation("workspace.register").introducedIn, "1.2.0");
  assert.equal(api.resolveOperation("pact.sign").requestDataSchema.includes("1.2.0"), true);
});

test("matches the canonical runtime payload hash and EIP-712 domain", () => {
  const payload = fixture("workspace-register.json");
  const binding = payload.signatureBinding;

  assert.equal(
    runtimeSignature.hashRuntimePayload(payload),
    binding.payloadHash,
  );
  assert.equal(
    runtimeSignature.hashRuntimePayload({ ...payload, signatureBinding: { ...binding, signature: "0x1234" } }),
    binding.payloadHash,
  );
  assert.deepEqual(runtimeSignature.runtimeTransitionDomain(binding), {
    name: "OpenRails Runtime",
    version: "1.2.0",
    chainId: "5042002",
    salt: binding.domain.salt,
  });
  assert.deepEqual(runtimeSignature.runtimeTransitionMessage(binding), {
    operationId: "workspace.register",
    payloadHash: binding.payloadHash,
    signer: binding.signer,
    nonce: "0",
    issuedAt: binding.issuedAt,
    expiresAt: binding.expiresAt,
    signaturePurpose: "offchain-runtime",
    anchorContract: binding.anchorContract,
  });
  assert.equal(runtimeSignature.recoverRuntimeTransitionSigner(binding), binding.signer);
});

test("validates all four signed runtime operation shapes and preserves decisionRef", () => {
  const workspace = fixture("workspace-register.json");
  const actor = fixture("actor-register.json");
  const proposal = fixture("proposal-submit.json");
  const pact = fixture("pact-sign.json");

  assert.equal(api.validateOperationRequest("workspace.register", envelope("workspace.register", workspace)).valid, true);
  assert.equal(api.validateOperationRequest("actor.register", envelope("actor.register", actor, {
    workspaceRef: actor.workspaceRef,
  })).valid, true);
  assert.equal(api.validateOperationRequest("proposal.submit", envelope("proposal.submit", proposal, {
    workspaceRef: proposal.proposal.workspaceRef,
    pathRef: proposal.proposal.pathRef,
    intentRef: proposal.proposal.intentRef,
    proposalRef: { type: "Proposal", id: proposal.proposal.id },
  })).valid, true);

  const pactEnvelope = envelope("pact.sign", pact, {
    workspaceRef: pact.pact.workspaceRef,
    pathRef: pact.pact.pathRef,
    intentRef: pact.intentRef,
    proposalRef: pact.pact.proposalRef,
    decisionRef: pact.pact.decisionRef,
    pactRef: { type: "Pact", id: pact.pact.id },
  });
  assert.equal(api.validateOperationRequest("pact.sign", pactEnvelope).valid, true);

  const prepared = api.createOperationRequest("pact.sign", pact);
  assert.equal(prepared.interfaceVersion, "1.2.0");
  assert.deepEqual(prepared.decisionRef, pactEnvelope.decisionRef);
  assert.equal(prepared.createdAt, pact.signatureBinding.issuedAt);
  assert.deepEqual(prepared.provenance, {
    source: "configuration",
    authority: "openrails-sdk",
    evidenceLevel: "configuration-only",
    observedAt: pact.signatureBinding.issuedAt,
    notes: "Derived from signed runtime payload fields. The external signature is present but not verified by createOperationRequest.",
  });
});

test("derives runtime wrapper truth and rejects every caller override", () => {
  const actor = fixture("actor-register.json");
  const prepared = api.createOperationRequest("actor.register", actor);
  const duplicate = {
    executionProfile: prepared.executionProfile,
    subject: prepared.subject,
    network: prepared.network,
    provenance: prepared.provenance,
    createdAt: prepared.createdAt,
    workspaceRef: prepared.workspaceRef,
  };
  assert.deepEqual(api.createOperationRequest("actor.register", actor, duplicate), prepared);

  const attempts = [
    { subject: { actorRef: { type: "Actor", id: "actor:attacker" }, role: "owner" } },
    { subject: { walletAddress: "0x1111111111111111111111111111111111111111", role: "owner" } },
    { executionProfile: "direct-wallet-authorized" },
    { network: { networkId: "arc-testnet", chainId: "1" } },
    { workspaceRef: { type: "Workspace", id: "workspace:attacker" } },
    { provenance: { ...prepared.provenance, authority: "caller-controlled" } },
    { createdAt: "2026-08-08T12:00:00Z" },
    { proofRefs: [{ type: "Proof", id: "proof:unsigned" }] },
  ];
  for (const context of attempts) {
    assert.throws(
      () => api.createOperationRequest("actor.register", actor, context),
      /must exactly match the SDK-derived value/,
    );
  }
});

test("rejects runtime payload and reference drift", () => {
  const proposal = fixture("proposal-submit.json");
  const valid = envelope("proposal.submit", proposal, {
    workspaceRef: proposal.proposal.workspaceRef,
    pathRef: proposal.proposal.pathRef,
    intentRef: proposal.proposal.intentRef,
    proposalRef: { type: "Proposal", id: proposal.proposal.id },
  });
  const payloadDrift = structuredClone(valid);
  payloadDrift.data.proposal.normalizedTerms.amount = "2000000";
  assert.equal(api.validateOperationRequest("proposal.submit", payloadDrift).valid, false);

  const referenceDrift = structuredClone(valid);
  referenceDrift.pathRef = { type: "Path", id: "path:other" };
  const result = api.validateOperationRequest("proposal.submit", referenceDrift);
  assert.equal(result.valid, false);
  assert.equal(result.issues.some((issue) => issue.message.includes("pathRef must equal")), true);
});
