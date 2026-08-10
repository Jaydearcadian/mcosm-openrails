import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Wallet } from "ethers";
import pg from "pg";

import {
  ARC_TESTNET_MANIFEST,
  PostgresRuntimeStore,
  Runtime,
  RuntimeError,
  RUNTIME_TRANSITION_TYPES,
  hashRuntimePayload,
  runtimeTransitionMessage
} from "../dist/index.js";

const { Pool } = pg;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const integrationTest = TEST_DATABASE_URL ? test : test.skip;
if (!TEST_DATABASE_URL) console.log("Postgres integration skipped: TEST_DATABASE_URL is unset.");
const MIGRATION = await readFile(new URL("../migrations/001_runtime.sql", import.meta.url), "utf8");
const NOW = new Date("2026-08-08T12:00:00.000Z");
const NETWORK = {
  networkId: ARC_TESTNET_MANIFEST.networkId,
  chainId: ARC_TESTNET_MANIFEST.chainId
};
const DOMAIN = ARC_TESTNET_MANIFEST.runtime.signatureDomain;
const HUB = ARC_TESTNET_MANIFEST.runtime.anchorContract;
const USDC = ARC_TESTNET_MANIFEST.settlementAssets[0];
const OWNER = Wallet.createRandom();
const DELEGATE = Wallet.createRandom();
const pool = TEST_DATABASE_URL ? new Pool({ connectionString: TEST_DATABASE_URL, max: 4 }) : null;

function ref(type, id) {
  return { type, id };
}

function provenance(source = "wallet-signed", authority = "OpenRails Postgres integration") {
  return {
    source,
    authority,
    evidenceLevel: source === "operator-record" ? "independently-verified" : "runtime-observed",
    observedAt: NOW.toISOString(),
    evidenceRefs: ["TEST-OR-R5-PG"]
  };
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

function workspace() {
  return {
    interfaceVersion: "1.2.0",
    id: "workspace:runtime:postgres",
    name: "Postgres Runtime Workspace",
    ownerActorRef: ref("Actor", "actor:postgres-owner"),
    status: "DRAFT",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    provenance: provenance()
  };
}

function ownerActor() {
  return {
    interfaceVersion: "1.2.0",
    id: "actor:postgres-owner",
    kind: "person",
    displayName: "Postgres Workspace Owner",
    authorityStatus: "VERIFIED",
    walletAddress: OWNER.address,
    createdAt: NOW.toISOString(),
    provenance: provenance()
  };
}

function delegateActor() {
  return {
    interfaceVersion: "1.2.0",
    id: "actor:postgres-delegate",
    kind: "agent",
    displayName: "Postgres Authorized Delegate",
    authorityStatus: "VERIFIED",
    walletAddress: DELEGATE.address,
    createdAt: NOW.toISOString(),
    provenance: provenance()
  };
}

function pathObject(limit) {
  return {
    interfaceVersion: "1.2.0",
    id: "path:runtime:postgres",
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", workspace().id),
    issuerActorRef: ref("Actor", ownerActor().id),
    delegateActorRef: ref("Actor", delegateActor().id),
    capabilities: ["CREATE_RAILSFLOW"],
    limits: [limit],
    status: "ACTIVE",
    signatureBinding: genericSignatureBinding(OWNER.address),
    provenance: provenance()
  };
}

function intentObject() {
  return {
    interfaceVersion: "1.2.0",
    id: "intent:runtime:postgres",
    executionProfile: "delegated-runtime",
    subject: { actorRef: ref("Actor", delegateActor().id), role: "delegate" },
    action: "CREATE_RAILSFLOW",
    paymentTerms: {
      asset: USDC,
      amount: "1000000",
      settlementShape: "one-time"
    },
    requestedNetwork: NETWORK,
    workspaceRef: ref("Workspace", workspace().id),
    pathRef: ref("Path", pathObject({
      asset: USDC,
      maxAmount: "10000000",
      maxTransactionsPerPeriod: "10",
      periodSeconds: "3600"
    }).id),
    nonce: "0",
    expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    status: "DRAFT",
    createdAt: NOW.toISOString(),
    provenance: provenance()
  };
}

function proposalObject(id) {
  const intent = intentObject();
  return {
    interfaceVersion: "1.2.0",
    id,
    executionProfile: "delegated-runtime",
    workspaceRef: intent.workspaceRef,
    pathRef: intent.pathRef,
    intentRef: ref("Intent", intent.id),
    normalizedTerms: intent.paymentTerms,
    inputHash: `0x${"cc".repeat(32)}`,
    policyVersion: "policy:runtime:postgres",
    status: "EVALUATING",
    createdAt: NOW.toISOString(),
    provenance: provenance("runtime-evaluation")
  };
}

class MockArcProvider {
  async getCode() {
    return "0x";
  }
}

async function signedData(operationId, unsignedData, signer, nonce) {
  const binding = {
    signatureStandard: "eip-712",
    primaryType: "OpenRailsRuntimeTransition",
    signaturePurpose: "offchain-runtime",
    operationId,
    payloadHash: hashRuntimePayload(unsignedData),
    signer: signer.address,
    signature: "0x",
    nonce: String(nonce),
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    chainId: NETWORK.chainId,
    anchorContract: HUB,
    domain: DOMAIN
  };
  binding.signature = await signer.signTypedData(binding.domain, RUNTIME_TRANSITION_TYPES, runtimeTransitionMessage(binding));
  return { ...unsignedData, signatureBinding: binding };
}

function request(operationId, data, signer, refs = {}) {
  return {
    interfaceVersion: "1.2.0",
    executionProfile: "delegated-runtime",
    operationId,
    capability: operationId,
    authorizationClass: "RELAY_SIGNED_ENVELOPE",
    subject: { walletAddress: signer.address, role: "delegate" },
    network: NETWORK,
    ...refs,
    data,
    provenance: provenance(),
    createdAt: NOW.toISOString()
  };
}

function limit(overrides = {}) {
  return {
    asset: USDC,
    maxAmount: "10000000",
    maxTransactionsPerPeriod: "10",
    periodSeconds: "3600",
    ...overrides
  };
}

function store() {
  assert.ok(pool, "TEST_DATABASE_URL is required for PostgreSQL integration tests.");
  return new PostgresRuntimeStore(pool);
}

async function resetDatabase() {
  if (!pool) return;
  await pool.query("TRUNCATE openrails_runtime_replay_nonces, openrails_runtime_state");
}

async function bootstrapRuntime(pathLimit) {
  const runtime = new Runtime({
    store: store(),
    provider: new MockArcProvider(),
    now: () => new Date(NOW),
    pathAttestor: {
      async attest() {
        return provenance("operator-record", "Postgres Runtime Path Attestor");
      }
    }
  });
  const currentWorkspace = workspace();
  const currentOwner = ownerActor();
  const currentDelegate = delegateActor();
  const workspaceData = await signedData("workspace.register", { workspace: currentWorkspace }, OWNER, 0);
  await runtime.execute(request("workspace.register", workspaceData, OWNER));
  const ownerData = await signedData("actor.register", { workspaceRef: ref("Workspace", currentWorkspace.id), actor: currentOwner }, OWNER, 1);
  await runtime.execute(request("actor.register", ownerData, OWNER, { workspaceRef: ref("Workspace", currentWorkspace.id) }));
  const delegateData = await signedData("actor.register", { workspaceRef: ref("Workspace", currentWorkspace.id), actor: currentDelegate }, OWNER, 2);
  await runtime.execute(request("actor.register", delegateData, OWNER, { workspaceRef: ref("Workspace", currentWorkspace.id) }));
  await runtime.ingestPath(pathObject(pathLimit));
  return runtime;
}

async function concurrentProposalResults(pathLimit, nonceBase) {
  const runtime = await bootstrapRuntime(pathLimit);
  const proposals = [proposalObject(`proposal:runtime:postgres:${nonceBase}:a`), proposalObject(`proposal:runtime:postgres:${nonceBase}:b`)];
  const envelopes = await Promise.all(proposals.map(async (proposal, index) => {
    const data = await signedData("proposal.submit", { proposal }, DELEGATE, nonceBase + index);
    return request("proposal.submit", data, DELEGATE, {
      workspaceRef: proposal.workspaceRef,
      pathRef: proposal.pathRef,
      intentRef: proposal.intentRef,
      proposalRef: ref("Proposal", proposal.id)
    });
  }));
  return Promise.allSettled(envelopes.map((envelope) => runtime.execute(envelope)));
}

test.before(async () => {
  if (!pool) return;
  await pool.query(MIGRATION);
  await resetDatabase();
});

test.after(async () => {
  await pool?.end();
});

test.beforeEach(async () => {
  await resetDatabase();
});

integrationTest("rolls back replay insertion and state mutation together", async () => {
  const runtimeStore = store();
  const scope = {
    domainSalt: DOMAIN.salt,
    chainId: NETWORK.chainId,
    anchorContract: HUB,
    signer: OWNER.address,
    nonce: "rollback-0"
  };

  await assert.rejects(() => runtimeStore.transact(async (transaction) => {
    await transaction.consumeReplayNonce(scope);
    transaction.state.workspaceAuthorities["workspace:rollback"] = OWNER.address;
    throw new Error("force rollback");
  }), /force rollback/);
  assert.deepEqual((await runtimeStore.snapshot()).workspaceAuthorities, {});

  await runtimeStore.transact(async (transaction) => {
    await transaction.consumeReplayNonce(scope);
    transaction.state.workspaceAuthorities["workspace:rollback"] = OWNER.address;
  });
  assert.equal((await runtimeStore.snapshot()).workspaceAuthorities["workspace:rollback"], OWNER.address);
});

integrationTest("rejects a real PostgreSQL replay conflict", async () => {
  const runtimeStore = store();
  const scope = {
    domainSalt: DOMAIN.salt,
    chainId: NETWORK.chainId,
    anchorContract: HUB,
    signer: OWNER.address,
    nonce: "replay-0"
  };
  await runtimeStore.transact((transaction) => transaction.consumeReplayNonce(scope));
  await assert.rejects(
    () => runtimeStore.transact((transaction) => transaction.consumeReplayNonce(scope)),
    (error) => error instanceof RuntimeError && error.code === "NONCE_CONFLICT"
  );
});

integrationTest("serializes concurrent Path count and amount enforcement in PostgreSQL", async () => {
  let results = await concurrentProposalResults(limit({ maxTransactionsPerPeriod: "1" }), 10);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "POLICY_BLOCKED").length, 1);

  await resetDatabase();
  results = await concurrentProposalResults(limit({ maxAmount: "1500000" }), 20);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === "POLICY_BLOCKED").length, 1);
});
