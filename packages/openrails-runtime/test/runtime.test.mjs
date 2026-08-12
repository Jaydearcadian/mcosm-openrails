import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import canonicalize from "canonicalize";
import { Interface, Wallet, keccak256, toUtf8Bytes } from "ethers";

import {
  ARC_TESTNET_MANIFEST,
  EIP1271_MAGIC_VALUE,
  MemoryRuntimeStore,
  PostgresRuntimeStore,
  Runtime,
  RuntimeError,
  RUNTIME_OPERATION_IDS,
  RUNTIME_TRANSITION_TYPES,
  runtimeTransitionMessage,
  hashRuntimePayload
} from "../dist/index.js";

const NOW = new Date("2026-08-08T12:00:00.000Z");
const NETWORK = { networkId: ARC_TESTNET_MANIFEST.networkId, chainId: ARC_TESTNET_MANIFEST.chainId };
const PROVENANCE = {
  source: "runtime-evaluation",
  authority: "OpenRails Runtime tests",
  evidenceLevel: "runtime-observed",
  observedAt: NOW.toISOString(),
  repository: "Jaydearcadian/mcosm-OpenRails",
  commit: "d99d692",
  evidenceRefs: ["TEST-OR-R3"]
};
const PATH_PROVENANCE = {
  ...PROVENANCE,
  source: "operator-record",
  authority: "OpenRails Runtime Path Attestor",
  evidenceLevel: "independently-verified",
  evidenceRefs: ["TEST-OR-R5-PATH"]
};
const DOMAIN = ARC_TESTNET_MANIFEST.runtime.signatureDomain;
const HUB = ARC_TESTNET_MANIFEST.runtime.anchorContract;
const USDC = ARC_TESTNET_MANIFEST.settlementAssets[0];
const OWNER = Wallet.createRandom();
const DELEGATE = Wallet.createRandom();
const ROGUE = Wallet.createRandom();

function ref(type, id) {
  return { type, id };
}

function provenance(source = PROVENANCE.source) {
  return { ...PROVENANCE, source };
}

function genericSignatureBinding(signer) {
  return {
    signer,
    signature: "0x",
    nonce: "0",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    chainId: NETWORK.chainId,
    verifyingContract: HUB,
    domain: {
      name: "OpenRails Network",
      version: "2.0.0",
      chainId: NETWORK.chainId,
      verifyingContract: HUB
    }
  };
}

function baseWorkspace() {
  return {
    interfaceVersion: "1.2.0",
    id: "workspace:runtime:test",
    name: "Runtime Test Workspace",
    ownerActorRef: ref("Actor", "actor:owner"),
    status: "DRAFT",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    provenance: provenance("wallet-signed")
  };
}

function ownerActor() {
  return {
    interfaceVersion: "1.2.0",
    id: "actor:owner",
    kind: "person",
    displayName: "Workspace Owner",
    authorityStatus: "VERIFIED",
    walletAddress: OWNER.address,
    createdAt: NOW.toISOString(),
    provenance: provenance("wallet-signed")
  };
}

function delegateActor() {
  return {
    interfaceVersion: "1.2.0",
    id: "actor:delegate",
    kind: "agent",
    displayName: "Authorized Delegate",
    authorityStatus: "VERIFIED",
    walletAddress: DELEGATE.address,
    createdAt: NOW.toISOString(),
    provenance: provenance("wallet-signed")
  };
}

function pathObject() {
  return {
    interfaceVersion: "1.2.0",
    id: "path:runtime:test",
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", "workspace:runtime:test"),
    issuerActorRef: ref("Actor", "actor:owner"),
    delegateActorRef: ref("Actor", "actor:delegate"),
    capabilities: ["CREATE_RAILSFLOW"],
    limits: [{
      asset: USDC,
      maxAmount: "10000000",
      maxTransactionsPerPeriod: "10",
      periodSeconds: "3600"
    }],
    status: "ACTIVE",
    signatureBinding: genericSignatureBinding(OWNER.address),
    provenance: provenance("wallet-signed")
  };
}

function attestedPath(path = pathObject()) {
  return { ...path, provenance: { ...PATH_PROVENANCE } };
}

function setPath(state, path) {
  const acceptedPath = attestedPath(path);
  state.paths[acceptedPath.id] = acceptedPath;
  state.pathAttestations[acceptedPath.id] = {
    path: structuredClone(acceptedPath),
    provenance: structuredClone(acceptedPath.provenance)
  };
}

function syncPathAttestation(state, pathId) {
  state.pathAttestations[pathId].path = structuredClone(state.paths[pathId]);
}

function pathAttestor(provenance = PATH_PROVENANCE) {
  return {
    async attest() {
      return structuredClone(provenance);
    }
  };
}

function intentObject() {
  return {
    interfaceVersion: "1.2.0",
    id: "intent:runtime:test",
    executionProfile: "delegated-runtime",
    subject: { actorRef: ref("Actor", "actor:delegate"), role: "delegate" },
    action: "CREATE_RAILSFLOW",
    paymentTerms: {
      asset: USDC,
      amount: "1000000",
      settlementShape: "one-time"
    },
    requestedNetwork: NETWORK,
    workspaceRef: ref("Workspace", "workspace:runtime:test"),
    pathRef: ref("Path", "path:runtime:test"),
    nonce: "0",
    expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    status: "DRAFT",
    createdAt: NOW.toISOString(),
    provenance: provenance("wallet-signed")
  };
}

function proposalObject(status = "EVALUATING") {
  return {
    interfaceVersion: "1.2.0",
    id: "proposal:runtime:test",
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", "workspace:runtime:test"),
    pathRef: ref("Path", "path:runtime:test"),
    intentRef: ref("Intent", "intent:runtime:test"),
    normalizedTerms: intentObject().paymentTerms,
    inputHash: `0x${"cc".repeat(32)}`,
    policyVersion: "policy:runtime:test",
    status,
    createdAt: NOW.toISOString(),
    provenance: provenance("runtime-evaluation")
  };
}

function decisionObject(decision = "ALLOW") {
  return {
    interfaceVersion: "1.2.0",
    id: "decision:runtime:test",
    executionProfile: "delegated-runtime",
    proposalRef: ref("Proposal", "proposal:runtime:test"),
    decision,
    policyVersion: "policy:runtime:test",
    inputHash: proposalObject("ALLOWED").inputHash,
    reasonCodes: [decision === "ALLOW" ? "WITHIN_LIMITS" : "POLICY_BLOCKED"],
    ...(decision === "ALLOW" ? { pactRef: ref("Pact", "pact:runtime:test") } : {}),
    effects: { financialEffect: "NONE", walletAction: "NONE", paycardCreated: false, valueMoved: false },
    decidedAt: NOW.toISOString(),
    provenance: provenance("runtime-evaluation")
  };
}

function pactObject() {
  return {
    interfaceVersion: "1.2.0",
    id: "pact:runtime:test",
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", "workspace:runtime:test"),
    pathRef: ref("Path", "path:runtime:test"),
    proposalRef: ref("Proposal", "proposal:runtime:test"),
    decisionRef: ref("BaphometDecision", "decision:runtime:test"),
    parties: [ref("Actor", "actor:owner"), ref("Actor", "actor:delegate")],
    paymentTerms: intentObject().paymentTerms,
    proofPolicy: {
      interfaceVersion: "1.2.0",
      id: "proof-policy:runtime:test",
      executionProfile: "delegated-runtime",
      requiredGate: "NONE",
      beforeTransition: "NONE",
      placement: "immediately-before",
      required: false,
      policyVersion: "policy:runtime:test",
      termsHash: `0x${"ee".repeat(32)}`
    },
    status: "DRAFT",
    createdAt: NOW.toISOString(),
    signatureBinding: genericSignatureBinding(OWNER.address),
    provenance: provenance("wallet-signed")
  };
}

function canonicalRecordObject(pact) {
  const envelope = {
    pactRef: ref("Pact", pact.id),
    sequence: "0",
    previousCommitment: `0x${"00".repeat(32)}`,
    plaintextCommitment: `0x${"11".repeat(32)}`,
    ciphertextHash: `0x${"22".repeat(32)}`,
    encryption: { mode: "public", algorithm: "none", keyAgreement: "none" },
    encryptedKeys: [],
    storageLocators: [{
      uri: "ipfs://openrails-runtime-test-record",
      contentHash: `0x${"33".repeat(32)}`,
      kind: "metadata"
    }],
    settlementReferences: []
  };
  const commitment = keccak256(toUtf8Bytes(canonicalize(envelope)));
  return {
    interfaceVersion: "1.2.0",
    id: "record:runtime:full",
    executionProfile: "delegated-runtime",
    ...envelope,
    signatures: [
      {
        actorRef: ref("Actor", "actor:owner"),
        algorithm: "eip-712",
        signature: "0x12",
        signedAt: NOW.toISOString(),
        signedCommitment: commitment
      },
      {
        actorRef: ref("Actor", "actor:delegate"),
        algorithm: "eip-712",
        signature: "0x34",
        signedAt: NOW.toISOString(),
        signedCommitment: commitment
      }
    ],
    createdAt: NOW.toISOString(),
    provenance: provenance("runtime-evaluation")
  };
}

function proofObject(pact, proposal, intent) {
  return {
    interfaceVersion: "1.2.0",
    id: "proof:runtime:full",
    executionProfile: "delegated-runtime",
    policyRef: ref("ProofPolicy", pact.proofPolicy.id),
    workspaceRef: intent.workspaceRef,
    pathRef: intent.pathRef,
    intentRef: ref("Intent", intent.id),
    proposalRef: ref("Proposal", proposal.id),
    pactRef: ref("Pact", pact.id),
    gate: "FINAL_SETTLEMENT",
    beforeTransition: "SETTLEMENT",
    placement: "immediately-before",
    status: "SUBMITTED",
    subjectRef: ref("Actor", "actor:delegate"),
    evidenceHash: `0x${"44".repeat(32)}`,
    submittedAt: NOW.toISOString(),
    provenance: provenance("runtime-evaluation")
  };
}

function initialState({ proposal = undefined, decision = undefined } = {}) {
  const path = attestedPath();
  return {
    version: "openrails-runtime-state-1.2.0",
    workspaces: {},
    workspaceAuthorities: {},
    actors: {},
    paths: { [path.id]: path },
    pathAttestations: { [path.id]: { path: structuredClone(path), provenance: structuredClone(path.provenance) } },
    intents: { [intentObject().id]: intentObject() },
    proposals: proposal ? { [proposal.id]: proposal } : {},
    decisions: decision ? { [decision.id]: decision } : {},
    pacts: {},
    committedPacts: {},
    pathPeriodUsage: {}
  };
}

function proposalEnvelope(proposal, nonce) {
  return signedData("proposal.submit", { proposal }, DELEGATE, { nonce }).then((data) => request("proposal.submit", data, DELEGATE, {
    workspaceRef: proposal.workspaceRef,
    pathRef: proposal.pathRef,
    intentRef: proposal.intentRef,
    proposalRef: ref("Proposal", proposal.id)
  }));
}

function pactEnvelope(pact, nonce) {
  return signedData("pact.sign", { intentRef: ref("Intent", intentObject().id), pact }, DELEGATE, { nonce }).then((data) => request("pact.sign", data, DELEGATE, {
    workspaceRef: pact.workspaceRef,
    pathRef: pact.pathRef,
    intentRef: data.intentRef,
    proposalRef: pact.proposalRef,
    decisionRef: pact.decisionRef,
    pactRef: ref("Pact", pact.id)
  }));
}

class MockArcProvider {
  constructor({ code = "0x", callResult = null, failCode = null, failCall = null } = {}) {
    this.code = code;
    this.callResult = callResult;
    this.failCode = failCode;
    this.failCall = failCall;
    this.calls = [];
  }

  async getCode(address) {
    this.calls.push({ method: "getCode", address });
    if (this.failCode) throw new Error(this.failCode);
    return this.code;
  }

  async call(request) {
    this.calls.push({ method: "call", request });
    if (this.failCall) throw new Error(this.failCall);
    return this.callResult;
  }
}

async function signedData(operationId, unsignedData, signer, options = {}) {
  const binding = {
    signatureStandard: "eip-712",
    primaryType: "OpenRailsRuntimeTransition",
    signaturePurpose: "offchain-runtime",
    operationId,
    payloadHash: hashRuntimePayload(unsignedData),
    signer: options.bindingSigner ?? signer.address,
    signature: "0x",
    nonce: String(options.nonce ?? 0),
    issuedAt: options.issuedAt ?? NOW.toISOString(),
    expiresAt: options.expiresAt ?? new Date(NOW.getTime() + 60_000).toISOString(),
    chainId: options.chainId ?? NETWORK.chainId,
    anchorContract: options.anchorContract ?? HUB,
    domain: options.domain ?? DOMAIN
  };
  binding.signature = await signer.signTypedData(binding.domain, RUNTIME_TRANSITION_TYPES, runtimeTransitionMessage(binding));
  return { ...unsignedData, signatureBinding: binding };
}

const AUTHORIZATION_CLASSES = {
  "workspace.register": "RELAY_SIGNED_ENVELOPE",
  "actor.register": "RELAY_SIGNED_ENVELOPE",
  "path.activate": "WALLET_SIGNATURE",
  "path.revoke": "WALLET_SIGNATURE",
  "intent.prepare": "PREPARE_ONLY",
  "proposal.evaluate": "PREPARE_ONLY",
  "proposal.submit": "RELAY_SIGNED_ENVELOPE",
  "pact.sign": "RELAY_SIGNED_ENVELOPE",
  "proof.submit": "RELAY_SIGNED_ENVELOPE",
  "proof.verify": "PUBLIC_READ"
};

function request(operationId, data, signer, refs = {}, subject = { walletAddress: signer.address, role: "delegate" }) {
  const { authorizationClass, ...wrapperRefs } = refs;
  return {
    interfaceVersion: "1.2.0",
    executionProfile: "delegated-runtime",
    operationId,
    capability: operationId,
    authorizationClass: authorizationClass ?? AUTHORIZATION_CLASSES[operationId],
    subject,
    network: NETWORK,
    ...wrapperRefs,
    data,
    provenance: provenance("wallet-signed"),
    createdAt: NOW.toISOString()
  };
}

function runtime(options = {}) {
  return new Runtime({ now: () => new Date(NOW), pathAttestor: pathAttestor(), ...options });
}

function expectCode(code) {
  return (error) => error instanceof RuntimeError && error.code === code;
}

async function bootstrap(store, provider) {
  const rt = runtime({ store, provider });
  const workspaceData = await signedData("workspace.register", { workspace: baseWorkspace() }, OWNER, { nonce: 0 });
  await rt.execute(request("workspace.register", workspaceData, OWNER, {}));
  const ownerData = await signedData("actor.register", { workspaceRef: ref("Workspace", baseWorkspace().id), actor: ownerActor() }, OWNER, { nonce: 1 });
  await rt.execute(request("actor.register", ownerData, OWNER, { workspaceRef: ref("Workspace", baseWorkspace().id) }));
  const delegateData = await signedData("actor.register", { workspaceRef: ref("Workspace", baseWorkspace().id), actor: delegateActor() }, OWNER, { nonce: 2 });
  await rt.execute(request("actor.register", delegateData, OWNER, { workspaceRef: ref("Workspace", baseWorkspace().id) }));
  return rt;
}

test("preserves legacy signed transitions with valid EOA authorization", async () => {
  const store = new MemoryRuntimeStore(initialState());
  const provider = new MockArcProvider();
  const rt = await bootstrap(store, provider);
  const bootstrappedState = await rt.state();
  assert.equal(bootstrappedState.actorWorkspaces[ownerActor().id], baseWorkspace().id);
  assert.equal(bootstrappedState.actorWorkspaces[delegateActor().id], baseWorkspace().id);

  const proposal = proposalObject("EVALUATING");
  const proposalData = await signedData("proposal.submit", { proposal }, DELEGATE, { nonce: 3 });
  const proposalResponse = await rt.execute(request("proposal.submit", proposalData, DELEGATE, {
    workspaceRef: proposal.workspaceRef,
    pathRef: proposal.pathRef,
    intentRef: proposal.intentRef,
    proposalRef: ref("Proposal", proposal.id)
  }));
  assert.equal(proposalResponse.lifecycleState, "EVALUATING");
  assert.equal(proposalResponse.transaction.status, "NOT_REQUESTED");

  await store.transact(async (transaction) => {
    transaction.state.proposals[proposal.id].status = "ALLOWED";
    transaction.state.decisions["decision:runtime:test"] = decisionObject("ALLOW");
  });
  const pact = pactObject();
  const pactData = await signedData("pact.sign", { intentRef: ref("Intent", intentObject().id), pact }, DELEGATE, { nonce: 4 });
  const pactResponse = await rt.execute(request("pact.sign", pactData, DELEGATE, {
    workspaceRef: pact.workspaceRef,
    pathRef: pact.pathRef,
    intentRef: pactData.intentRef,
    proposalRef: pact.proposalRef,
    decisionRef: pact.decisionRef,
    pactRef: ref("Pact", pact.id)
  }));
  assert.equal(pactResponse.lifecycleState, "COMMITTED");
  assert.equal((await rt.state()).committedPacts[pact.id] !== undefined, true);
  assert.equal(provider.calls.filter((entry) => entry.method === "getCode").length, 5);
});

test("closes the delegated Workspace-to-proof lifecycle without moving value", async () => {
  const state = initialState();
  const preparedPath = attestedPath({ ...pathObject(), status: "PREPARED" });
  setPath(state, preparedPath);
  delete state.intents[intentObject().id];
  const store = new MemoryRuntimeStore(state);
  const provider = new MockArcProvider();
  const rt = await bootstrap(store, provider);
  const workspaceRef = ref("Workspace", baseWorkspace().id);
  const pathRef = ref("Path", preparedPath.id);

  const activationData = await signedData("path.activate", { path: preparedPath }, OWNER, { nonce: 3 });
  const activationResponse = await rt.execute(request("path.activate", activationData, OWNER, {
    workspaceRef,
    pathRef
  }, { walletAddress: OWNER.address, role: "owner" }));
  assert.equal(activationResponse.lifecycleState, "COMMITTED");

  const pactRef = ref("Pact", "pact:runtime:full");
  const intent = { ...intentObject(), pactRef };
  const intentData = await signedData("intent.prepare", { intent }, OWNER, { nonce: 4 });
  const intentResponse = await rt.execute(request("intent.prepare", intentData, OWNER, {
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", intent.id)
  }, { walletAddress: OWNER.address, role: "owner" }));
  assert.equal(intentResponse.lifecycleState, "PREPARED");

  const proposal = {
    ...proposalObject("EVALUATING"),
    id: "proposal:runtime:full",
    intentRef: ref("Intent", intent.id),
    policyVersion: "baphomet-runtime-1.2.0"
  };
  const proposalData = await signedData("proposal.evaluate", { proposal }, DELEGATE, { nonce: 0 });
  const proposalResponse = await rt.execute(request("proposal.evaluate", proposalData, DELEGATE, {
    workspaceRef,
    pathRef,
    intentRef: proposal.intentRef,
    proposalRef: ref("Proposal", proposal.id)
  }));
  assert.equal(proposalResponse.lifecycleState, "ALLOWED");
  assert.equal(proposalResponse.data.decision.decision, "ALLOW");

  const pact = {
    ...pactObject(),
    id: pactRef.id,
    proposalRef: ref("Proposal", proposal.id),
    decisionRef: ref("BaphometDecision", proposalResponse.data.decision.id),
    proofPolicy: {
      ...pactObject().proofPolicy,
      id: "proof-policy:runtime:full",
      requiredGate: "FINAL_SETTLEMENT",
      beforeTransition: "SETTLEMENT",
      required: true
    },
    canonicalRecordPolicy: {
      mode: "required",
      exposure: "public",
      signatureRequirement: "bilateral-typed-actor-signatures"
    },
    canonicalRecordRef: ref("CanonicalRecord", "record:runtime:full")
  };
  const canonicalRecord = canonicalRecordObject(pact);
  const pactData = await signedData("pact.sign", {
    intentRef: ref("Intent", intent.id),
    pact,
    canonicalRecord
  }, DELEGATE, { nonce: 1 });
  const pactResponse = await rt.execute(request("pact.sign", pactData, DELEGATE, {
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", intent.id),
    proposalRef: pact.proposalRef,
    decisionRef: pact.decisionRef,
    pactRef,
    canonicalRecordRef: canonicalRecord.pactRef.type === "Pact" ? ref("CanonicalRecord", canonicalRecord.id) : undefined
  }));
  assert.equal(pactResponse.lifecycleState, "COMMITTED");
  assert.equal(pactResponse.data.pact.status, "ACTIVE");

  const proof = proofObject(pact, proposal, intent);
  const proofSubmitData = await signedData("proof.submit", { proof }, DELEGATE, { nonce: 2 });
  const proofSubmitResponse = await rt.execute(request("proof.submit", proofSubmitData, DELEGATE, {
    workspaceRef,
    pathRef,
    intentRef: proof.intentRef,
    proposalRef: proof.proposalRef,
    pactRef: proof.pactRef,
    proofRefs: [ref("Proof", proof.id)]
  }));
  assert.equal(proofSubmitResponse.lifecycleState, "PROOF_PENDING");

  const proofVerifyData = await signedData("proof.verify", { objectRef: ref("Proof", proof.id) }, OWNER, { nonce: 5 });
  const proofVerifyResponse = await rt.execute(request("proof.verify", proofVerifyData, OWNER, {
    workspaceRef,
    pathRef,
    intentRef: proof.intentRef,
    proposalRef: proof.proposalRef,
    pactRef: proof.pactRef,
    proofRefs: [ref("Proof", proof.id)]
  }, { walletAddress: OWNER.address, role: "owner" }));
  assert.equal(proofVerifyResponse.lifecycleState, "PROOF_VERIFIED");
  assert.equal(proofVerifyResponse.data.proof.status, "VERIFIED");

  const revokeData = await signedData("path.revoke", { objectRef: pathRef }, OWNER, { nonce: 6 });
  const revokeResponse = await rt.execute(request("path.revoke", revokeData, OWNER, {
    workspaceRef,
    pathRef
  }, { walletAddress: OWNER.address, role: "owner" }));
  assert.equal(revokeResponse.lifecycleState, "CANCELLED");

  const finalState = await rt.state();
  assert.equal(finalState.paths[preparedPath.id].status, "REVOKED");
  assert.equal(finalState.intents[intent.id].status, "PREPARED");
  assert.equal(finalState.proposals[proposal.id].status, "ALLOWED");
  assert.equal(finalState.pacts[pact.id].status, "ACTIVE");
  assert.equal(finalState.proofs[proof.id].status, "VERIFIED");
  assert.ok(finalState.canonicalRecords[canonicalRecord.id]);
  assert.equal(proposalResponse.transaction.financialEffect, "NONE");
  assert.equal(pactResponse.transaction.financialEffect, "NONE");
  assert.equal(proofVerifyResponse.transaction.financialEffect, "NONE");
  assert.equal(provider.calls.some((entry) => entry.method === "sendTransaction"), false);
});

test("Baphomet blocks an over-limit delegated proposal with structured no-value outcome", async () => {
  const blockedTerms = { ...intentObject().paymentTerms, amount: "20000000" };
  const state = initialState();
  state.intents[intentObject().id] = { ...intentObject(), paymentTerms: blockedTerms };
  const store = new MemoryRuntimeStore(state);
  const rt = await bootstrap(store, new MockArcProvider());
  const proposal = {
    ...proposalObject("EVALUATING"),
    id: "proposal:runtime:blocked",
    normalizedTerms: blockedTerms
  };
  const data = await signedData("proposal.evaluate", { proposal }, DELEGATE, { nonce: 7 });
  const response = await rt.execute(request("proposal.evaluate", data, DELEGATE, {
    workspaceRef: proposal.workspaceRef,
    pathRef: proposal.pathRef,
    intentRef: proposal.intentRef,
    proposalRef: ref("Proposal", proposal.id)
  }));

  assert.equal(response.lifecycleState, "BLOCKED");
  assert.equal(response.data.decision.decision, "BLOCK");
  assert.equal(response.errors.length, 1);
  assert.equal(response.errors[0].code, "POLICY_BLOCKED");
  assert.equal(response.errors[0].financialEffect, "NONE");
  assert.equal(response.errors[0].transactionState, "NOT_REQUESTED");
  assert.equal(response.transaction.status, "NOT_REQUESTED");
  assert.equal(response.transaction.financialEffect, "NONE");

  const finalState = await rt.state();
  assert.equal(finalState.proposals[proposal.id].status, "BLOCKED");
  assert.equal(finalState.decisions[response.data.decision.id].decision, "BLOCK");
  assert.deepEqual(finalState.pacts, {});
  assert.deepEqual(finalState.committedPacts, {});
  assert.deepEqual(finalState.pathPeriodUsage, {});
});

test("Path ingestion requires an attestor and persists its provenance", async () => {
  const path = pathObject();
  const state = initialState();
  delete state.paths[path.id];
  delete state.pathAttestations[path.id];
  const store = new MemoryRuntimeStore(state);
  const rt = runtime({ store });

  const accepted = await rt.ingestPath(path);
  assert.deepEqual(accepted.provenance, PATH_PROVENANCE);
  assert.deepEqual((await rt.state()).pathAttestations[path.id].path, accepted);
  await assert.rejects(() => rt.ingestPath(path), expectCode("STATE_STALE"));

  const missingAttestor = new Runtime({ store: new MemoryRuntimeStore(initialState()), now: () => new Date(NOW) });
  await assert.rejects(() => missingAttestor.ingestPath(path), expectCode("AUTHORIZATION_REQUIRED"));
  const configurationOnly = runtime({
    store: new MemoryRuntimeStore({ ...initialState(), paths: {}, pathAttestations: {} }),
    pathAttestor: pathAttestor({
      ...PATH_PROVENANCE,
      source: "configuration",
      evidenceLevel: "configuration-only"
    })
  });
  await assert.rejects(() => configurationOnly.ingestPath(path), expectCode("AUTHORIZATION_REQUIRED"));
});

test("proposal authorization fails closed for a Path without authenticated ingestion", async () => {
  const state = initialState();
  state.pathAttestations = {};
  const store = new MemoryRuntimeStore(state);
  const rt = await bootstrap(store, new MockArcProvider());
  const envelope = await proposalEnvelope(proposalObject(), 5);
  await assert.rejects(() => rt.execute(envelope), expectCode("AUTHORIZATION_REQUIRED"));
});

test("Pact authorization fails closed for a Path without authenticated ingestion", async () => {
  const proposal = proposalObject("ALLOWED");
  const state = initialState({ proposal, decision: decisionObject() });
  state.pathAttestations = {};
  const store = new MemoryRuntimeStore(state);
  const rt = await bootstrap(store, new MockArcProvider());
  const envelope = await pactEnvelope(pactObject(), 6);
  await assert.rejects(() => rt.execute(envelope), expectCode("AUTHORIZATION_REQUIRED"));
});

test("verifies EIP-1271 success, rejection, and RPC failure", async () => {
  const contractSigner = "0x1000000000000000000000000000000000000001";
  const iface = new Interface(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
  const magicResult = iface.encodeFunctionResult("isValidSignature", [EIP1271_MAGIC_VALUE]);
  const unsigned = { workspace: baseWorkspace() };
  const data = await signedData("workspace.register", unsigned, OWNER, { bindingSigner: contractSigner, nonce: 9 });

  const successProvider = new MockArcProvider({ code: "0x6000", callResult: magicResult });
  await runtime({ store: new MemoryRuntimeStore(), provider: successProvider }).execute(request("workspace.register", data, OWNER, {}, { walletAddress: contractSigner, role: "owner" }));
  assert.equal(successProvider.calls.at(-1).method, "call");

  const rejectedProvider = new MockArcProvider({ code: "0x6000", callResult: iface.encodeFunctionResult("isValidSignature", ["0x00000000"]) });
  await assert.rejects(() => runtime({ store: new MemoryRuntimeStore(), provider: rejectedProvider }).execute(request("workspace.register", data, OWNER, {}, { walletAddress: contractSigner, role: "owner" })), expectCode("SIGNATURE_INVALID"));

  const malformedProvider = new MockArcProvider({ code: "0x6000", callResult: "0x1234" });
  await assert.rejects(() => runtime({ store: new MemoryRuntimeStore(), provider: malformedProvider }).execute(request("workspace.register", data, OWNER, {}, { walletAddress: contractSigner, role: "owner" })), expectCode("SIGNATURE_INVALID"));

  const rpcProvider = new MockArcProvider({ code: "0x6000", failCall: "RPC unavailable" });
  await assert.rejects(() => runtime({ store: new MemoryRuntimeStore(), provider: rpcProvider }).execute(request("workspace.register", data, OWNER, {}, { walletAddress: contractSigner, role: "owner" })), expectCode("RPC_UNAVAILABLE"));

  const invalidEoaBinding = { ...data, signatureBinding: { ...data.signatureBinding, signer: OWNER.address, signature: "0x1234" } };
  await assert.rejects(() => runtime({ store: new MemoryRuntimeStore(), provider: new MockArcProvider() }).execute(request("workspace.register", invalidEoaBinding, OWNER)), expectCode("SIGNATURE_INVALID"));
});

test("rejects expired, future, and overlong signatures before state mutation", async () => {
  const cases = [
    { issuedAt: new Date(NOW.getTime() - 120_000).toISOString(), expiresAt: new Date(NOW.getTime() - 60_000).toISOString() },
    { issuedAt: new Date(NOW.getTime() + 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + 120_000).toISOString() },
    { issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 901_000).toISOString() }
  ];
  for (const [index, times] of cases.entries()) {
    const store = new MemoryRuntimeStore();
    const provider = new MockArcProvider();
    const data = await signedData("workspace.register", { workspace: { ...baseWorkspace(), id: `workspace:time:${index}` } }, OWNER, { nonce: 20 + index, ...times });
    await assert.rejects(() => runtime({ store, provider }).execute(request("workspace.register", data, OWNER)), expectCode("SIGNATURE_EXPIRED"));
    assert.deepEqual((await runtime({ store, provider }).state()).workspaces, {});
  }
});

test("rejects wrong domain, chain, and anchor bindings", async () => {
  const wrongSalt = { ...DOMAIN, salt: `0x${"22".repeat(32)}` };
  const wrongDomainData = await signedData("workspace.register", { workspace: { ...baseWorkspace(), id: "workspace:wrong-domain" } }, OWNER, { nonce: 30, domain: wrongSalt });
  await assert.rejects(() => runtime({ provider: new MockArcProvider() }).execute(request("workspace.register", wrongDomainData, OWNER)), expectCode("AUTHORIZATION_REQUIRED"));

  const wrongChainData = await signedData("workspace.register", { workspace: { ...baseWorkspace(), id: "workspace:wrong-chain" } }, OWNER, { nonce: 31, chainId: "1" });
  await assert.rejects(() => runtime({ provider: new MockArcProvider() }).execute(request("workspace.register", wrongChainData, OWNER)), expectCode("INPUT_INVALID"));

  const wrongAnchorData = await signedData("workspace.register", { workspace: { ...baseWorkspace(), id: "workspace:wrong-anchor" } }, OWNER, { nonce: 32, anchorContract: "0x2000000000000000000000000000000000000002" });
  await assert.rejects(() => runtime({ provider: new MockArcProvider() }).execute(request("workspace.register", wrongAnchorData, OWNER)), expectCode("AUTHORIZATION_REQUIRED"));
});

test("rejects delegated wrapper and signer authorization mismatches", async () => {
  const store = new MemoryRuntimeStore(initialState());
  const provider = new MockArcProvider();
  const rt = await bootstrap(store, provider);
  const proposal = proposalObject();
  const data = await signedData("proposal.submit", { proposal }, DELEGATE, { nonce: 40 });
  const mismatch = request("proposal.submit", data, DELEGATE, {
    workspaceRef: ref("Workspace", "workspace:other"),
    pathRef: proposal.pathRef,
    intentRef: proposal.intentRef,
    proposalRef: ref("Proposal", proposal.id)
  });
  await assert.rejects(() => rt.execute(mismatch), expectCode("INPUT_INVALID"));

  const unauthorized = await signedData("proposal.submit", { proposal: { ...proposal, id: "proposal:rogue" } }, ROGUE, { nonce: 41 });
  await assert.rejects(() => rt.execute(request("proposal.submit", unauthorized, ROGUE, {
    workspaceRef: proposal.workspaceRef,
    pathRef: proposal.pathRef,
    intentRef: proposal.intentRef,
    proposalRef: ref("Proposal", "proposal:rogue")
  })), expectCode("AUTHORIZATION_REQUIRED"));
});

test("rejects Pact signing without an ALLOW Decision", async () => {
  const proposal = proposalObject("ALLOWED");
  const store = new MemoryRuntimeStore(initialState({ proposal }));
  const provider = new MockArcProvider();
  const rt = await bootstrap(store, provider);
  const pact = pactObject();
  const data = await signedData("pact.sign", { intentRef: ref("Intent", intentObject().id), pact }, DELEGATE, { nonce: 50 });
  await assert.rejects(() => rt.execute(request("pact.sign", data, DELEGATE, {
    workspaceRef: pact.workspaceRef,
    pathRef: pact.pathRef,
    intentRef: data.intentRef,
    proposalRef: pact.proposalRef,
    decisionRef: pact.decisionRef,
    pactRef: ref("Pact", pact.id)
  })), expectCode("AUTHORIZATION_REQUIRED"));
});

test("failed authorization rolls back nonce consumption and retry succeeds", async () => {
  const store = new MemoryRuntimeStore(initialState());
  const provider = new MockArcProvider();
  const rt = await bootstrap(store, provider);
  await store.transact(async (transaction) => {
    delete transaction.state.actors[delegateActor().id];
  });
  const proposal = proposalObject();
  const data = await signedData("proposal.submit", { proposal }, DELEGATE, { nonce: 60 });
  const envelope = request("proposal.submit", data, DELEGATE, {
    workspaceRef: proposal.workspaceRef,
    pathRef: proposal.pathRef,
    intentRef: proposal.intentRef,
    proposalRef: ref("Proposal", proposal.id)
  });
  await assert.rejects(() => rt.execute(envelope), expectCode("AUTHORIZATION_REQUIRED"));
  await store.transact(async (transaction) => {
    transaction.state.actors[delegateActor().id] = delegateActor();
  });
  const response = await rt.execute(envelope);
  assert.equal(response.lifecycleState, "EVALUATING");
});

test("malformed stored Path fails closed and does not consume the nonce", async () => {
  const malformedPath = { ...pathObject(), limits: [] };
  const state = initialState();
  state.paths[malformedPath.id] = malformedPath;
  const store = new MemoryRuntimeStore(state);
  const rt = await bootstrap(store, new MockArcProvider());
  const envelope = await proposalEnvelope(proposalObject(), 80);

  await assert.rejects(() => rt.execute(envelope), expectCode("STATE_STALE"));
  await store.transact(async (transaction) => {
    setPath(transaction.state, pathObject());
  });
  const response = await rt.execute(envelope);
  assert.equal(response.lifecycleState, "EVALUATING");
});

test("malformed stored ALLOW Decision fails closed and does not consume the nonce", async () => {
  const proposal = proposalObject("ALLOWED");
  const malformedDecision = decisionObject("ALLOW");
  delete malformedDecision.pactRef;
  const store = new MemoryRuntimeStore(initialState({ proposal, decision: malformedDecision }));
  const rt = await bootstrap(store, new MockArcProvider());
  const pact = pactObject();
  const envelope = await pactEnvelope(pact, 81);

  await assert.rejects(() => rt.execute(envelope), expectCode("STATE_STALE"));
  await store.transact(async (transaction) => {
    transaction.state.decisions[decisionObject().id] = decisionObject();
  });
  const response = await rt.execute(envelope);
  assert.equal(response.lifecycleState, "COMMITTED");
});

test("enforces Path capability, asset, amount, per-transaction, and stream bounds", async () => {
  const otherAsset = { ...USDC, address: "0x3000000000000000000000000000000000000003" };
  const baseLimit = pathObject().limits[0];
  const oneTimeCases = [
    { path: { ...pathObject(), capabilities: ["PAY_RAILSFLOW"] }, code: "AUTHORIZATION_REQUIRED" },
    { path: { ...pathObject(), limits: [{ ...baseLimit, asset: otherAsset }] }, code: "AUTHORIZATION_REQUIRED" },
    { path: { ...pathObject(), limits: [{ ...baseLimit, maxAmount: "999999" }] }, code: "POLICY_BLOCKED" },
    { path: { ...pathObject(), limits: [{ ...baseLimit, maxAmountPerTransaction: "999999" }] }, code: "POLICY_BLOCKED" }
  ];
  for (const [index, entry] of oneTimeCases.entries()) {
    const state = initialState();
    setPath(state, entry.path);
    const rt = await bootstrap(new MemoryRuntimeStore(state), new MockArcProvider());
    const envelope = await proposalEnvelope({ ...proposalObject(), id: `proposal:path-bound:${index}` }, 90 + index);
    await assert.rejects(() => rt.execute(envelope), expectCode(entry.code));
  }

  const streamTerms = {
    asset: USDC,
    amount: "1000000",
    settlementShape: "streamed",
    velocityPerSecond: "1000",
    lifespanSeconds: "120"
  };
  const streamCases = [
    { maxVelocityPerSecond: "999" },
    { maxLifespanSeconds: "119" }
  ];
  for (const [index, overrides] of streamCases.entries()) {
    const streamIntent = { ...intentObject(), paymentTerms: streamTerms };
    const streamProposal = { ...proposalObject(), id: `proposal:stream-bound:${index}`, normalizedTerms: streamTerms };
    const state = initialState();
    state.intents[streamIntent.id] = streamIntent;
    setPath(state, { ...pathObject(), limits: [{ ...baseLimit, ...overrides }] });
    const rt = await bootstrap(new MemoryRuntimeStore(state), new MockArcProvider());
    const envelope = await proposalEnvelope(streamProposal, 94 + index);
    await assert.rejects(() => rt.execute(envelope), expectCode("POLICY_BLOCKED"));
  }
});

test("rejects expired, future, and manifest-mismatched stored Path bindings", async () => {
  const binding = pathObject().signatureBinding;
  const cases = [
    { ...binding, issuedAt: new Date(NOW.getTime() - 120_000).toISOString(), expiresAt: new Date(NOW.getTime() - 60_000).toISOString() },
    { ...binding, issuedAt: new Date(NOW.getTime() + 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + 120_000).toISOString() },
    { ...binding, chainId: "1", domain: { ...binding.domain, chainId: "1" } },
    { ...binding, verifyingContract: "0x4000000000000000000000000000000000000004" },
    { ...binding, domain: { ...binding.domain, name: "Other Domain" } },
    genericSignatureBinding(ROGUE.address)
  ];
  for (const [index, signatureBinding] of cases.entries()) {
    const state = initialState();
    setPath(state, { ...pathObject(), signatureBinding });
    const rt = await bootstrap(new MemoryRuntimeStore(state), new MockArcProvider());
    const envelope = await proposalEnvelope({ ...proposalObject(), id: `proposal:path-binding:${index}` }, 100 + index);
    await assert.rejects(() => rt.execute(envelope), expectCode("AUTHORIZATION_REQUIRED"));
  }
});

test("enforces every applicable Path limit with distinct usage keys", async () => {
  const first = pathObject().limits[0];
  const state = initialState();
  setPath(state, {
    ...pathObject(),
    limits: [first, { ...first, periodSeconds: "7200", maxTransactionsPerPeriod: "2" }]
  });
  const store = new MemoryRuntimeStore(state);
  const rt = await bootstrap(store, new MockArcProvider());
  await rt.execute(await proposalEnvelope(proposalObject(), 110));
  const usage = Object.values((await rt.state()).pathPeriodUsage);
  assert.equal(usage.length, 2);
  assert.deepEqual(usage.map((entry) => entry.limitIndex).sort(), [0, 1]);
  assert.ok(usage.every((entry) => entry.transactionCount === "1" && entry.amount === "1000000"));
});

test("Path period usage rolls over deterministically", async () => {
  let currentTime = new Date(NOW);
  const first = pathObject().limits[0];
  const state = initialState();
  setPath(state, {
    ...pathObject(),
    limits: [{ ...first, maxTransactionsPerPeriod: "1", periodSeconds: "10" }]
  });
  const store = new MemoryRuntimeStore(state);
  const rt = new Runtime({ store, provider: new MockArcProvider(), now: () => new Date(currentTime) });
  await bootstrap(store, new MockArcProvider());
  await rt.execute(await proposalEnvelope({ ...proposalObject(), id: "proposal:period:first" }, 120));
  currentTime = new Date(NOW.getTime() + 11_000);
  await rt.execute(await proposalEnvelope({ ...proposalObject(), id: "proposal:period:second" }, 121));
  const usage = Object.values((await rt.state()).pathPeriodUsage);
  assert.equal(usage.length, 2);
  assert.notEqual(usage[0].bucketStartSeconds, usage[1].bucketStartSeconds);
});

async function concurrentLimitResults(limit, nonceBase) {
  const state = initialState();
  setPath(state, { ...pathObject(), limits: [limit] });
  const rt = await bootstrap(new MemoryRuntimeStore(state), new MockArcProvider());
  const envelopes = await Promise.all([
    proposalEnvelope({ ...proposalObject(), id: `proposal:concurrent:${nonceBase}:a` }, nonceBase),
    proposalEnvelope({ ...proposalObject(), id: `proposal:concurrent:${nonceBase}:b` }, nonceBase + 1)
  ]);
  return Promise.allSettled(envelopes.map((envelope) => rt.execute(envelope)));
}

test("concurrent proposals cannot exceed Path count or cumulative amount", async () => {
  const baseLimit = pathObject().limits[0];
  const countResults = await concurrentLimitResults({ ...baseLimit, maxTransactionsPerPeriod: "1" }, 130);
  assert.equal(countResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(countResults.filter((result) => result.status === "rejected" && result.reason.code === "POLICY_BLOCKED").length, 1);

  const amountResults = await concurrentLimitResults({ ...baseLimit, maxAmount: "1500000" }, 140);
  assert.equal(amountResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(amountResults.filter((result) => result.status === "rejected" && result.reason.code === "POLICY_BLOCKED").length, 1);
});

test("Pact signing rejects policy mismatch and mismatched pactRef", async () => {
  const cases = [
    { decision: { ...decisionObject(), policyVersion: "policy:other" }, code: "POLICY_BLOCKED" },
    { decision: { ...decisionObject(), pactRef: ref("Pact", "pact:other") }, code: "AUTHORIZATION_REQUIRED" }
  ];
  for (const [index, entry] of cases.entries()) {
    const proposal = proposalObject("ALLOWED");
    const store = new MemoryRuntimeStore(initialState({ proposal, decision: entry.decision }));
    const rt = await bootstrap(store, new MockArcProvider());
    const envelope = await pactEnvelope(pactObject(), 150 + index);
    await assert.rejects(() => rt.execute(envelope), expectCode(entry.code));
  }
});

test("Pact signing rechecks current Path authority", async () => {
  const proposal = proposalObject("ALLOWED");
  const store = new MemoryRuntimeStore(initialState({ proposal, decision: decisionObject() }));
  const rt = await bootstrap(store, new MockArcProvider());
  await store.transact(async (transaction) => {
    transaction.state.paths[pathObject().id].signatureBinding.expiresAt = new Date(NOW.getTime() - 1_000).toISOString();
    syncPathAttestation(transaction.state, pathObject().id);
  });
  const envelope = await pactEnvelope(pactObject(), 160);
  await assert.rejects(() => rt.execute(envelope), expectCode("AUTHORIZATION_REQUIRED"));
});

test("concurrent duplicate transitions produce one success and one nonce conflict", async () => {
  const store = new MemoryRuntimeStore();
  const provider = new MockArcProvider();
  const rt = runtime({ store, provider });
  const data = await signedData("workspace.register", { workspace: baseWorkspace() }, OWNER, { nonce: 70 });
  const envelope = request("workspace.register", data, OWNER);
  const results = await Promise.allSettled([rt.execute(envelope), rt.execute(envelope)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "NONCE_CONFLICT").length, 1);
});

test("Postgres store inserts replay scope and state in one transaction", async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.startsWith("SELECT state_json")) return { rows: [{ state_json: JSON.stringify({ version: "openrails-runtime-state-1.2.0", workspaces: {}, workspaceAuthorities: {}, actors: {}, paths: {}, intents: {}, proposals: {}, decisions: {}, pacts: {}, committedPacts: {} }) }] };
      if (text.includes("RETURNING nonce")) return { rows: [{ nonce: values.at(-1) }] };
      return { rows: [] };
    },
    release() {}
  };
  const db = {
    async query() { return { rows: [] }; },
    async connect() { return client; }
  };
  const store = new PostgresRuntimeStore(db);
  await store.transact(async (transaction) => {
    await transaction.consumeReplayNonce({ domainSalt: DOMAIN.salt, chainId: NETWORK.chainId, anchorContract: HUB, signer: OWNER.address, nonce: "0" });
    transaction.state.workspaceAuthorities["workspace:test"] = OWNER.address;
  });
  assert.equal(queries[0].text, "BEGIN");
  assert.ok(queries.some((query) => query.text.includes("openrails_runtime_replay_nonces")));
  assert.ok(queries.some((query) => query.text.includes("UPDATE openrails_runtime_state")));
  assert.equal(queries.at(-1).text, "COMMIT");
});

test("runtime and Arc provider expose no custody or broadcast surface", async () => {
  const providerSource = await readFile(new URL("../src/provider.ts", import.meta.url), "utf8");
  const runtimeSource = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(providerSource, /sendTransaction|privateKey|mnemonic|signMessage/);
  assert.doesNotMatch(runtimeSource, /sendTransaction|privateKey|mnemonic|signMessage/);
  assert.deepEqual(RUNTIME_OPERATION_IDS, [
    "workspace.register",
    "actor.register",
    "path.activate",
    "path.revoke",
    "intent.prepare",
    "proposal.evaluate",
    "proposal.submit",
    "pact.sign",
    "proof.submit",
    "proof.verify"
  ]);
});
