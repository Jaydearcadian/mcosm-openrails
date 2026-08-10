import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  assertInvalid,
  assertValid,
  createAjv,
  PACKAGE_ROOT,
  readJson,
  validatorFor
} from "../scripts/validation-lib.mjs";
import {
  assertValidOperation,
  hashRuntimePayload,
  hashRuntimeTransition,
  recoverRuntimeTransitionSigner,
  resolveOperation,
  validateOperation,
  isSignedRuntimeTransitionOperation,
  SIGNED_RUNTIME_TRANSITION_OPERATIONS
} from "../dist/index.js";
import {
  hasValidProfileReferences,
  hasValidProofPlacement,
  isAllowedTransition,
  outcomeRule
} from "../scripts/contract-rules.mjs";

const ajv = createAjv();
const schema = (name) => `https://schemas.openrails.dev/openrails/1.2.0/${name}.schema.json`;
const timestamp = "2026-08-02T00:00:00Z";
const provenance = {
  source: "runtime-evaluation",
  authority: "OpenRails interface tests",
  evidenceLevel: "runtime-observed",
  observedAt: timestamp,
  repository: "Jaydearcadian/mcosm-OpenRails",
  commit: "e153dca6d46a8531c3ad45aad5906dbf0a2088ed",
  evidenceRefs: ["TEST-OR-PR1"]
};

function fixture(name) {
  return readJson(`fixtures/${name}.json`);
}

function ref(type, id) {
  return { type, id };
}

function delegatedEnvelope(data, lifecycleState, transaction, errors = []) {
  return {
    interfaceVersion: "1.1.0",
    executionProfile: "delegated-runtime",
    operationId: "proposal.evaluate",
    capability: "proposal.evaluate",
    lifecycleState,
    authorizationClass: "PREPARE_ONLY",
    subject: { actorRef: ref("Actor", "actor:1"), role: "delegate" },
    network: { networkId: "arc-testnet", chainId: "5042002" },
    workspaceRef: ref("Workspace", "workspace:1"),
    pathRef: ref("Path", "path:1"),
    intentRef: ref("Intent", "intent:1"),
    proposalRef: ref("Proposal", "proposal:1"),
    data,
    transaction,
    errors,
    provenance,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function operationEnvelope(operationId, data, direction = "request", overrides = {}) {
  const operation = readJson("registries/operation-registry.json").operations.find((entry) => entry.operationId === operationId);
  if (!operation) throw new Error(`Unknown test operation ${operationId}`);
  const envelope = {
    interfaceVersion: "1.1.0",
    executionProfile: "direct-wallet-authorized",
    operationId,
    capability: operation.capability,
    authorizationClass: operation.authorizationClass,
    subject: { walletAddress: "0x1111111111111111111111111111111111111111", role: "payer" },
    network: { networkId: "arc-testnet", chainId: "5042002" },
    data,
    provenance,
    createdAt: timestamp,
    ...overrides
  };
  if (direction === "response") {
    if (!("lifecycleState" in envelope)) envelope.lifecycleState = "PREPARED";
    if (!("errors" in envelope)) envelope.errors = [];
  }
  return envelope;
}

function oneTimeTerms(overrides = {}) {
  return {
    asset: { symbol: "USDC", decimals: 6, address: "0x3600000000000000000000000000000000000000", kind: "erc20" },
    amount: "1",
    settlementShape: "one-time",
    ...overrides
  };
}

function validPath(signatureBinding) {
  return {
    interfaceVersion: "1.1.0",
    id: "path:test:1",
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", "workspace:test"),
    issuerActorRef: ref("Actor", "actor:issuer"),
    delegateActorRef: ref("Actor", "actor:delegate"),
    capabilities: ["paycard.settle"],
    limits: [{
      asset: oneTimeTerms().asset,
      maxAmount: "1",
      maxTransactionsPerPeriod: "1",
      periodSeconds: "60"
    }],
    status: "PREPARED",
    signatureBinding,
    provenance
  };
}

test("direct RailsFlow financial success has exact receipt and canonical reconciliation", () => {
  const envelope = fixture("direct-railsflow-success");
  assertValid(ajv, schema("operation-envelope"), envelope, "direct success envelope");
  assertValid(ajv, schema("paycard-stream"), envelope.data, "settled paycard");
  assert.equal(envelope.lifecycleState, "SETTLED");
  assert.equal(envelope.transaction.status, "CONFIRMED");
  assert.equal(envelope.receipts[0].receiptStatus, "VERIFIED");
  assert.equal(envelope.receipts[0].financialOutcome, "RECONCILED");
  assert.equal(envelope.receipts[0].canonicalReconciliation.status, "MATCHED");
  assert.ok(envelope.receipts[0].verification.exact);

  const incomplete = structuredClone(envelope.receipts[0]);
  delete incomplete.verification.exact;
  assertInvalid(ajv, schema("receipt"), incomplete, "reconciled receipt without exact verification");

  const unconfirmed = structuredClone(envelope.receipts[0]);
  unconfirmed.transaction.status = "SUBMITTED";
  assertInvalid(ajv, schema("receipt"), unconfirmed, "reconciled receipt before confirmation");
});

test("generated named public types retain their canonical shape", () => {
  const generated = fs.readFileSync(path.join(PACKAGE_ROOT, "src", "generated.ts"), "utf8");
  assert.doesNotMatch(generated, /^export type [A-Za-z_$][A-Za-z0-9_$]* = unknown(?: \| unknown)*;$/m);
  const subject = generated.match(/export type Subject = [\s\S]*?;\nexport type SubjectObjectRef/)[0];
  assert.match(subject, /actorRef\?: ActorRef;/);
  assert.match(subject, /walletAddress\?: NonZeroAddress;/);
  assert.match(subject, /role\?:/);
  assert.match(subject, /actorRef: ActorRef;/);
  assert.match(subject, /walletAddress: NonZeroAddress;/);

  const extensionData = generated.match(/export type ExtensionData = \{[\s\S]*?\n\};/)[0];
  assert.notEqual(extensionData, "export type ExtensionData = {};\n");
  assert.ok(extensionData.includes("[key: `x-${string}`]: unknown;"));
});

test("contract-bound paycard IDs use bytes32 hashes and replay lanes accept zero", () => {
  const envelope = fixture("direct-railsflow-success");
  assert.match(envelope.data.paycardId, /^0x[a-fA-F0-9]{64}$/);
  const decimalPaycardId = structuredClone(envelope.data);
  decimalPaycardId.paycardId = "1";
  assertInvalid(ajv, schema("paycard-stream"), decimalPaycardId, "decimal paycard ID");

  const zeroNonceCard = fixture("bearer-railscard-claim");
  zeroNonceCard.signatureBinding.nonce = "0";
  assertValid(ajv, schema("railscard"), zeroNonceCard, "RailsCard nonce lane zero");
  assertValid(ajv, schema("common") + "#/$defs/SignatureBinding", zeroNonceCard.signatureBinding, "signature nonce lane zero");
});

test("payment terms distinguish positive value and streamed velocity from one-time instant semantics", () => {
  const instant = oneTimeTerms();
  assertValid(ajv, schema("common") + "#/$defs/PaymentTerms", instant, "one-time payment terms");

  const zeroAmount = structuredClone(instant);
  zeroAmount.amount = "0";
  assertInvalid(ajv, schema("common") + "#/$defs/PaymentTerms", zeroAmount, "zero payment amount");

  const zeroStreamVelocity = oneTimeTerms({ settlementShape: "streamed", lifespanSeconds: "60", velocityPerSecond: "0" });
  assertInvalid(ajv, schema("common") + "#/$defs/PaymentTerms", zeroStreamVelocity, "zero streamed velocity");

  const instantWithAdapterZeros = oneTimeTerms({ lifespanSeconds: "0", velocityPerSecond: "0" });
  assertInvalid(ajv, schema("common") + "#/$defs/PaymentTerms", instantWithAdapterZeros, "adapter zero fields in shared payment terms");
});

test("semantic contract addresses reject the zero address while generic wire addresses remain separate", () => {
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  assertValid(ajv, schema("common") + "#/$defs/Address", zeroAddress, "generic address sentinel");

  const zeroRecipient = oneTimeTerms({ recipient: zeroAddress });
  assertInvalid(ajv, schema("common") + "#/$defs/PaymentTerms", zeroRecipient, "zero payment recipient");

  const zeroSigner = fixture("bearer-railscard-claim");
  zeroSigner.signatureBinding.signer = zeroAddress;
  assertInvalid(ajv, schema("railscard"), zeroSigner, "zero RailsCard signer");

  const zeroClaimant = { railscardRef: ref("RailsCard", "railscard:1"), claimant: zeroAddress };
  assertInvalid(ajv, schema("operation-payloads") + "#/$defs/RailsCardClaimRequest", zeroClaimant, "zero claim recipient");

  const zeroPaycardAddress = fixture("direct-railsflow-success");
  zeroPaycardAddress.data.payer = zeroAddress;
  assertInvalid(ajv, schema("paycard-stream"), zeroPaycardAddress.data, "zero Paycard payer");

  const manifest = readJson("manifests/arc-testnet.json");
  manifest.contracts[0].address = zeroAddress;
  assertInvalid(ajv, schema("network-manifest"), manifest, "zero manifest contract address");
});

test("RailsCard bearer and recipient-bound variants enforce their claim policies", () => {
  const bearer = fixture("bearer-railscard-claim");
  const recipientBound = fixture("recipient-bound-railscard-claim");
  assertValid(ajv, schema("railscard"), bearer, "bearer RailsCard");
  assertValid(ajv, schema("railscard"), recipientBound, "recipient-bound RailsCard");
  assert.equal(bearer.claimPolicy, "first-claimant");
  assert.equal(bearer.recipient, undefined);
  assert.equal(recipientBound.claimPolicy, "recipient-only");
  assert.equal(recipientBound.paymentTerms.recipient, "0x3333333333333333333333333333333333333333");
  assert.equal(recipientBound.recipient, undefined);

  const invalidBearer = structuredClone(bearer);
  invalidBearer.recipient = "0x3333333333333333333333333333333333333333";
  assertInvalid(ajv, schema("railscard"), invalidBearer, "bearer card with recipient");

  const invalidBearerTerms = structuredClone(bearer);
  invalidBearerTerms.paymentTerms.recipient = "0x3333333333333333333333333333333333333333";
  assertInvalid(ajv, schema("railscard"), invalidBearerTerms, "bearer card with signed recipient");

  const contradictoryRecipient = structuredClone(recipientBound);
  contradictoryRecipient.recipient = "0x4444444444444444444444444444444444444444";
  assertInvalid(ajv, schema("railscard"), contradictoryRecipient, "recipient-bound card with duplicate recipient");

  const oldSignedDuplicates = structuredClone(bearer);
  oldSignedDuplicates.payer = "0x4444444444444444444444444444444444444444";
  oldSignedDuplicates.nonce = "0";
  oldSignedDuplicates.expiresAt = "2026-08-04T00:00:00Z";
  assertInvalid(ajv, schema("railscard"), oldSignedDuplicates, "RailsCard duplicate signed fields");
});

test("Path keeps signed nonce and timestamps in one authoritative binding", () => {
  const binding = fixture("bearer-railscard-claim").signatureBinding;
  const pathValue = validPath(binding);
  assertValid(ajv, schema("path"), pathValue, "Path with signature binding");

  const oldPathDuplicates = structuredClone(pathValue);
  oldPathDuplicates.nonce = "0";
  oldPathDuplicates.issuedAt = timestamp;
  oldPathDuplicates.expiresAt = "2026-08-03T00:00:00Z";
  assertInvalid(ajv, schema("path"), oldPathDuplicates, "Path duplicate signed fields");

  const models = readJson("schemas/models.schema.json").$defs;
  for (const modelName of ["Path", "SettlementIntent", "Pact", "RailsCard"]) {
    assert.ok(models[modelName].properties.signatureBinding, `${modelName} has signatureBinding`);
  }
  for (const field of ["nonce", "issuedAt", "expiresAt"]) {
    assert.equal(Object.hasOwn(models.Path.properties, field), false, `Path has no top-level ${field}`);
    assert.equal(Object.hasOwn(models.RailsCard.properties, field), false, `RailsCard has no top-level ${field}`);
    assert.equal(Object.hasOwn(models.SettlementIntent.properties, field), false, `SettlementIntent has no top-level ${field}`);
    assert.equal(Object.hasOwn(models.Pact.properties, field), false, `Pact has no top-level ${field}`);
  }
  assert.equal(Object.hasOwn(models.RailsCard.properties, "payer"), false);
});

test("RailsFlow and RailsCard use exactly one authoritative fixed recipient", () => {
  const railsflow = {
    interfaceVersion: "1.1.0",
    id: "railsflow:test:1",
    executionProfile: "direct-wallet-authorized",
    paymentTerms: oneTimeTerms({ recipient: "0x3333333333333333333333333333333333333333" }),
    proofPolicy: fixture("bearer-railscard-claim").proofPolicy,
    nonce: "0",
    expiresAt: "2026-08-03T00:00:00Z",
    status: "PREPARED",
    createdAt: timestamp,
    provenance
  };
  assertValid(ajv, schema("railsflow"), railsflow, "RailsFlow fixed recipient");

  const duplicateRailsFlowRecipient = structuredClone(railsflow);
  duplicateRailsFlowRecipient.recipient = "0x4444444444444444444444444444444444444444";
  assertInvalid(ajv, schema("railsflow"), duplicateRailsFlowRecipient, "RailsFlow duplicate recipient");

  const missingRailsFlowRecipient = structuredClone(railsflow);
  delete missingRailsFlowRecipient.paymentTerms.recipient;
  assertInvalid(ajv, schema("railsflow"), missingRailsFlowRecipient, "RailsFlow without fixed recipient");
});

test("receipt transaction identity is single-source and exact verification cannot contradict it", () => {
  const receipt = fixture("direct-railsflow-success").receipts[0];
  assert.equal(Object.hasOwn(receipt.verification.exact, "txHash"), false);
  assert.equal(Object.hasOwn(receipt.verification.exact, "blockHash"), false);
  assert.equal(Object.hasOwn(receipt.verification.exact, "blockNumber"), false);

  const contradictoryEvidence = structuredClone(receipt);
  contradictoryEvidence.verification.exact.txHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assertInvalid(ajv, schema("receipt"), contradictoryEvidence, "receipt with duplicate transaction identity");

  const confirmedOnly = structuredClone(receipt);
  delete confirmedOnly.verification.exact;
  confirmedOnly.financialOutcome = "PENDING";
  confirmedOnly.receiptStatus = "UNVERIFIED";
  confirmedOnly.verification.status = "UNVERIFIED";
  confirmedOnly.verification.reasons = ["Exact event evidence is absent."];
  confirmedOnly.canonicalReconciliation.status = "PENDING";
  assertValid(ajv, schema("receipt"), confirmedOnly, "confirmed transaction without financial success");
});

test("WalletHandoff carries prepared context and keeps external-wallet states explicit", () => {
  const prepared = fixture("wallet-handoff-prepared");
  assertValid(ajv, schema("wallet-handoff"), prepared, "prepared wallet handoff");
  assert.equal(prepared.preparedRequest.kind, "evm-transaction");
  assert.equal(prepared.preparedRequest.chainId, prepared.network.chainId);
  assert.equal(prepared.walletAuthorization.mode, "external-wallet");
  assert.equal(prepared.transaction.status, "WALLET_REQUIRED");
  assert.equal(prepared.receiptVerification.status, "NOT_REQUESTED");
  assert.equal(prepared.errors.length, 0);

  for (const name of [
    "wallet-handoff-wrong-network",
    "wallet-handoff-signature-expired",
    "wallet-handoff-transaction-reverted",
    "wallet-handoff-unverified-receipt"
  ]) {
    assertValid(ajv, schema("wallet-handoff"), fixture(name), name);
  }

  const unexpectedSecret = structuredClone(prepared);
  unexpectedSecret.privateKey = "0xnot-accepted";
  assertInvalid(ajv, schema("wallet-handoff"), unexpectedSecret, "WalletHandoff private key");

  const expired = fixture("wallet-handoff-signature-expired");
  assert.equal(expired.lifecycleState, "FAILED");
  assert.equal(expired.transaction.status, "NOT_REQUESTED");
  assert.equal(expired.errors[0].code, "SIGNATURE_EXPIRED");

  const reverted = fixture("wallet-handoff-transaction-reverted");
  assert.equal(reverted.transaction.status, "REVERTED");
  assert.equal(reverted.lifecycleState, "FAILED");
  assert.equal(reverted.receiptVerification.status, "UNVERIFIED");

  const unverified = fixture("wallet-handoff-unverified-receipt");
  assert.equal(unverified.transaction.status, "CONFIRMED");
  assert.equal(unverified.receiptVerification.status, "UNVERIFIED");
  assert.notEqual(unverified.transaction.financialEffect, "RECONCILIATION_REQUIRED");

  const prepareRequest = operationEnvelope("wallet.handoff.prepare", { walletHandoff: prepared });
  assert.equal(validateOperation("wallet.handoff.prepare", prepareRequest, "request").valid, true);
  const verifyRequest = operationEnvelope("wallet.handoff.verify", {
    handoffRef: ref("WalletHandoff", prepared.id),
    receipt: fixture("unverified-receipt")
  });
  assert.equal(validateOperation("wallet.handoff.verify", verifyRequest, "request").valid, true);
});

test("delegated ALLOW and BLOCK preserve the Pact boundary and financial effect", () => {
  const allow = fixture("delegated-allow");
  const block = fixture("delegated-block");
  assertValid(ajv, schema("decision"), allow, "delegated ALLOW decision");
  assertValid(ajv, schema("decision"), block, "delegated BLOCK decision");
  assert.equal(allow.decision, "ALLOW");
  assert.ok(allow.pactRef);
  assert.equal(block.decision, "BLOCK");
  assert.equal(block.pactRef, undefined);
  assert.deepEqual(block.effects, {
    financialEffect: "NONE",
    walletAction: "NONE",
    paycardCreated: false,
    valueMoved: false
  });

  const blockedEnvelope = delegatedEnvelope(block, "BLOCKED", {
    interfaceVersion: "1.1.0",
    status: "NOT_REQUESTED",
    network: { networkId: "arc-testnet", chainId: "5042002" },
    financialEffect: "NONE",
    observedAt: timestamp
  }, [fixture("wrong-network")]);
  blockedEnvelope.operationId = "proposal.evaluate";
  blockedEnvelope.capability = "proposal.evaluate";
  blockedEnvelope.authorizationClass = "PREPARE_ONLY";
  blockedEnvelope.errors = [{
    ...fixture("wrong-network"),
    code: "POLICY_BLOCKED",
    message: "Baphomet blocked the proposal before Pact creation.",
    lifecycleState: "BLOCKED",
    transactionState: "NOT_REQUESTED",
    financialEffect: "NONE",
    expectedNetwork: undefined,
    actualNetwork: undefined
  }];
  delete blockedEnvelope.errors[0].expectedNetwork;
  delete blockedEnvelope.errors[0].actualNetwork;
  assertValid(ajv, schema("operation-envelope"), blockedEnvelope, "delegated BLOCK envelope");
  assert.equal(blockedEnvelope.pactRef, undefined);
  assert.equal(blockedEnvelope.transaction.status, "NOT_REQUESTED");
});

test("error fixtures and every Product Foundry error taxonomy code are structured", () => {
  for (const name of ["signature-expired", "wrong-network", "transaction-reverted", "rpc-unavailable"]) {
    assertValid(ajv, schema("interface-error"), fixture(name), name);
  }

  const codes = readJson("schemas/common.schema.json").$defs.ErrorCode.enum;
  for (const code of codes) {
    const value = {
      interfaceVersion: "1.1.0",
      code,
      message: `Structured ${code} error.`,
      retryable: false,
      financialEffect: code === "RPC_UNAVAILABLE" ? "UNKNOWN" : "NONE",
      lifecycleState: code === "POLICY_BLOCKED" ? "BLOCKED" : "FAILED",
      transactionState: "NOT_REQUESTED",
      operationId: "network.get",
      occurredAt: timestamp,
      provenance
    };
    if (code === "WRONG_NETWORK") {
      value.expectedNetwork = { networkId: "arc-testnet", chainId: "5042002" };
      value.actualNetwork = { networkId: "other", chainId: "1" };
    }
    if (code === "SIGNATURE_EXPIRED") value.expiresAt = "2026-08-01T00:00:00Z";
    if (code === "RPC_UNAVAILABLE") value.retryable = true;
    if (code === "TRANSACTION_REVERTED") value.transactionState = "REVERTED";
    if (code === "TRANSACTION_REPLACED") value.transactionState = "REPLACED";
    if (code === "TRANSACTION_DROPPED") value.transactionState = "DROPPED";
    assertValid(ajv, schema("interface-error"), value, code);
  }
});

test("transaction and receipt failure fixtures never imply financial success", () => {
  for (const name of ["signature-expired", "wrong-network", "transaction-reverted", "rpc-unavailable"]) {
    const error = fixture(name);
    assert.equal(error.lifecycleState, "FAILED");
    assert.notEqual(error.financialEffect, "PENDING");
    assert.notEqual(error.financialEffect, "RECONCILIATION_REQUIRED");
  }

  const receipt = fixture("unverified-receipt");
  assertValid(ajv, schema("receipt"), receipt, "unverified receipt");
  assert.equal(receipt.receiptStatus, "UNVERIFIED");
  assert.equal(receipt.financialOutcome, "PENDING");
  const claimed = structuredClone(receipt);
  claimed.financialOutcome = "RECONCILED";
  assertInvalid(ajv, schema("receipt"), claimed, "unverified receipt claimed as reconciled");
});

test("lifecycle transition rules reject shortcuts and expose all required outcomes", () => {
  assert.equal(isAllowedTransition(fixture("invalid-transition")), false);
  assert.equal(isAllowedTransition({
    from: "SUBMITTED",
    to: "CONFIRMED",
    trigger: "CONFIRM_TRANSACTION",
    executionProfile: "direct-wallet-authorized"
  }), true);

  const expected = {
    success: ["SETTLED", "CONFIRMED", "RECONCILED", "exact-verified-receipt-and-reconciliation"],
    blocked: ["BLOCKED", "NOT_REQUESTED", "NONE", "none"],
    failed: ["FAILED", "UNKNOWN", "UNKNOWN", "unverified-receipt-only"],
    cancelled: ["CANCELLED", "NOT_REQUESTED", "NONE", "none"],
    "signature-expired": ["FAILED", "NOT_REQUESTED", "NONE", "none"],
    "transaction-reverted": ["FAILED", "REVERTED", "NONE", "unverified-receipt-only"],
    "wrong-network": ["FAILED", "NOT_REQUESTED", "NONE", "none"],
    "rpc-unavailable": ["FAILED", "UNKNOWN", "UNKNOWN", "unverified-receipt-only"]
  };
  for (const [name, [lifecycleState, transactionState, financialEffect, receiptRequirement]] of Object.entries(expected)) {
    const rule = outcomeRule(name);
    assert.equal(rule.lifecycleState, lifecycleState, `${name} lifecycle`);
    assert.equal(rule.transactionState, transactionState, `${name} transaction`);
    assert.equal(rule.financialEffect, financialEffect, `${name} financial effect`);
    assert.equal(rule.receiptRequirement, receiptRequirement, `${name} receipt requirement`);
  }
});

test("direct and delegated reference constraints are explicit", () => {
  assert.equal(hasValidProfileReferences(fixture("invalid-direct-references")), false);
  assert.equal(hasValidProfileReferences(fixture("invalid-delegated-references")), false);
  const invalidDirectCard = structuredClone(fixture("bearer-railscard-claim"));
  invalidDirectCard.pathRef = ref("Path", "path:orphan");
  assertInvalid(ajv, schema("railscard"), invalidDirectCard, "direct card with orphan Path");
  const invalidDelegatedCard = structuredClone(fixture("bearer-railscard-claim"));
  invalidDelegatedCard.executionProfile = "delegated-runtime";
  invalidDelegatedCard.workspaceRef = ref("Workspace", "workspace:1");
  invalidDelegatedCard.pathRef = ref("Path", "path:1");
  invalidDelegatedCard.intentRef = ref("Intent", "intent:1");
  invalidDelegatedCard.proposalRef = ref("Proposal", "proposal:1");
  assertInvalid(ajv, schema("railscard"), invalidDelegatedCard, "delegated card without Pact");
  assert.equal(hasValidProfileReferences({
    executionProfile: "direct-wallet-authorized",
    workspaceRef: ref("Workspace", "workspace:1"),
    pathRef: ref("Path", "path:1")
  }), true);
  assert.equal(hasValidProfileReferences({
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", "workspace:1"),
    pathRef: ref("Path", "path:1"),
    intentRef: ref("Intent", "intent:1"),
    proposalRef: ref("Proposal", "proposal:1"),
    pactRef: ref("Pact", "pact:1")
  }), true);
  assert.equal(hasValidProfileReferences({
    executionProfile: "delegated-runtime",
    lifecycleState: "BLOCKED",
    workspaceRef: ref("Workspace", "workspace:1"),
    pathRef: ref("Path", "path:1"),
    intentRef: ref("Intent", "intent:1"),
    proposalRef: ref("Proposal", "proposal:1")
  }), true);
});

test("Proof gate placement is immediately before the mapped transition", () => {
  assertInvalid(ajv, schema("proof-policy"), fixture("invalid-proof-placement"), "invalid proof policy");
  assert.equal(hasValidProofPlacement(fixture("invalid-proof-placement")), false);
  const validPolicy = fixture("recipient-bound-railscard-claim").proofPolicy;
  assertValid(ajv, schema("proof-policy"), validPolicy, "claim proof policy");
  assert.equal(hasValidProofPlacement(validPolicy), true);
});

test("operation registry is complete, typed, and never equates submission with success", () => {
  const registry = readJson("registries/operation-registry.json");
  const capabilities = readJson("registries/capability-list.json").capabilities;
  assert.equal(registry.operations.length, 45);
  assert.deepEqual(registry.operations.map((operation) => operation.capability), capabilities);
  for (const operation of registry.operations) {
    assert.equal(operation.requestSchema, schema("operation-request"));
    assert.equal(operation.responseSchema, schema("operation-response"));
    assert.ok(validatorFor(ajv, operation.requestDataSchema));
    assert.ok(validatorFor(ajv, operation.responseDataSchema));
    assert.ok(operation.allowedExecutionProfiles.length > 0);
    assert.equal(operation.transactionBehavior.submissionMeansFinancialSuccess, false);
    assert.ok(operation.capabilityStatusBehavior.onUnavailable);
  }
});

test("Shared Interface 1.2 signed runtime transitions bind operation, payload, and signature without custody", () => {
  const manifest = readJson("manifests/arc-testnet.json");
  const cases = [
    ["workspace.register", "workspace-register", "delegated-runtime", "PREPARED", {}],
    ["actor.register", "actor-register", "delegated-runtime", "PREPARED", {
      workspaceRef: ref("Workspace", "workspace:runtime:1")
    }],
    ["proposal.submit", "proposal-submit", "delegated-runtime", "EVALUATING", {
      workspaceRef: ref("Workspace", "workspace:runtime:1"),
      pathRef: ref("Path", "path:runtime:1"),
      intentRef: ref("Intent", "intent:runtime:1"),
      proposalRef: ref("Proposal", "proposal:runtime:1")
    }],
    ["pact.sign", "pact-sign", "delegated-runtime", "COMMITTED", {
      workspaceRef: ref("Workspace", "workspace:runtime:1"),
      pathRef: ref("Path", "path:runtime:1"),
      intentRef: ref("Intent", "intent:runtime:1"),
      proposalRef: ref("Proposal", "proposal:runtime:1"),
      decisionRef: ref("BaphometDecision", "decision:runtime:1"),
      pactRef: ref("Pact", "pact:runtime:1")
    }]
  ];

  assert.deepEqual([...SIGNED_RUNTIME_TRANSITION_OPERATIONS], [
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
  for (const [operationId, fixtureName, executionProfile, lifecycleState, references] of cases) {
    const operation = resolveOperation(operationId);
    const payload = fixture(fixtureName);
    assertValid(ajv, operation.requestDataSchema, payload, `${operationId} request payload`);
    assertValid(ajv, operation.responseDataSchema, payload, `${operationId} response payload`);
    assert.equal(isSignedRuntimeTransitionOperation(operationId), true);
    assert.equal(operation.authorizationClass, "RELAY_SIGNED_ENVELOPE");
    assert.equal(operation.introducedIn, "1.2.0");
    assert.equal(operation.transactionBehavior.kind, "relay-signed-envelope");
    assert.equal(operation.transactionBehavior.submissionMeansFinancialSuccess, false);

    const subject = { walletAddress: payload.signatureBinding.signer, role: "delegate" };
    const request = operationEnvelope(operationId, payload, "request", { interfaceVersion: "1.2.0", executionProfile, subject, ...references });
    assert.equal(validateOperation(operationId, request, "request").valid, true);
    const response = operationEnvelope(operationId, payload, "response", { interfaceVersion: "1.2.0", executionProfile, lifecycleState, subject, ...references });
    assert.equal(validateOperation(operationId, response, "response").valid, true);
    assertValid(ajv, schema("operation-envelope"), response, `${operationId} generic operation envelope`);

    const legacyVersion = structuredClone(request);
    legacyVersion.interfaceVersion = "1.1.0";
    assert.equal(validateOperation(operationId, legacyVersion, "request").valid, false);
    assertInvalid(ajv, schema("operation-request"), legacyVersion, `${operationId} raw 1.1 request`);
    const legacyResponse = structuredClone(response);
    legacyResponse.interfaceVersion = "1.1.0";
    assertInvalid(ajv, schema("operation-response"), legacyResponse, `${operationId} raw 1.1 response`);
    assertInvalid(ajv, schema("operation-envelope"), legacyResponse, `${operationId} raw 1.1 generic envelope`);

    assert.equal(payload.signatureBinding.signatureStandard, "eip-712");
    assert.equal(payload.signatureBinding.primaryType, "OpenRailsRuntimeTransition");
    assert.equal(payload.signatureBinding.chainId, payload.signatureBinding.domain.chainId);
    assert.deepEqual(payload.signatureBinding.domain, manifest.runtime.signatureDomain);
    assert.equal(payload.signatureBinding.anchorContract, manifest.runtime.anchorContract);
    assert.equal(payload.signatureBinding.signaturePurpose, "offchain-runtime");
    assert.equal("purpose" in payload.signatureBinding.domain, false);
    assert.equal("verifyingContract" in payload.signatureBinding.domain, false);
    assert.ok(Date.parse(payload.signatureBinding.issuedAt) < Date.parse(payload.signatureBinding.expiresAt));
    assert.equal(payload.signatureBinding.payloadHash, hashRuntimePayload(payload));
    assert.match(hashRuntimeTransition(payload.signatureBinding), /^0x[0-9a-f]{64}$/);
    assert.equal(recoverRuntimeTransitionSigner(payload.signatureBinding), payload.signatureBinding.signer);

    const wrongOperationBinding = structuredClone(payload);
    wrongOperationBinding.signatureBinding.operationId = operationId === "workspace.register"
      ? "actor.register"
      : "workspace.register";
    assertInvalid(ajv, operation.requestDataSchema, wrongOperationBinding, `${operationId} wrong signature operation binding`);

    const wrongPayloadHash = structuredClone(request);
    const artifact = wrongPayloadHash.data.workspace ?? wrongPayloadHash.data.actor ?? wrongPayloadHash.data.proposal ?? wrongPayloadHash.data.pact;
    artifact.id = `${artifact.id}:tampered`;
    const wrongPayloadHashResult = validateOperation(operationId, wrongPayloadHash, "request");
    assert.equal(wrongPayloadHashResult.valid, false);
    assert.ok(wrongPayloadHashResult.issues.some((issue) => issue.message.includes("payloadHash")));

    const nonCanonicalPayload = structuredClone(request);
    const nonCanonicalArtifact = nonCanonicalPayload.data.workspace ?? nonCanonicalPayload.data.actor ?? nonCanonicalPayload.data.proposal ?? nonCanonicalPayload.data.pact;
    nonCanonicalArtifact.id = 1n;
    assert.doesNotThrow(() => validateOperation(operationId, nonCanonicalPayload, "request"));
    assert.equal(validateOperation(operationId, nonCanonicalPayload, "request").valid, false);

    if (operationId !== "workspace.register") {
      const wrongReference = structuredClone(request);
      wrongReference.workspaceRef.id = "workspace:other";
      const wrongReferenceResult = validateOperation(operationId, wrongReference, "request");
      assert.equal(wrongReferenceResult.valid, false);
      assert.ok(wrongReferenceResult.issues.some((issue) => issue.message.includes("workspaceRef")));
    }

    const wrongLifecycle = structuredClone(response);
    wrongLifecycle.lifecycleState = lifecycleState === "PREPARED" ? "EVALUATING" : "PREPARED";
    assert.equal(validateOperation(operationId, wrongLifecycle, "response").valid, false);

    const unexpectedReference = operationId === "workspace.register"
      ? { workspaceRef: ref("Workspace", "workspace:other") }
      : operationId === "actor.register"
        ? { pathRef: ref("Path", "path:other") }
        : operationId === "proposal.submit"
          ? { pactRef: ref("Pact", "pact:other") }
          : { proofRefs: [ref("Proof", "proof:other")] };
    const requestWithUnexpectedReference = Object.assign(structuredClone(request), unexpectedReference);
    assertInvalid(ajv, schema("operation-request"), requestWithUnexpectedReference, `${operationId} unexpected request reference`);
    assert.equal(validateOperation(operationId, requestWithUnexpectedReference, "request").valid, false);
    const responseWithUnexpectedReference = Object.assign(structuredClone(response), unexpectedReference);
    assertInvalid(ajv, schema("operation-response"), responseWithUnexpectedReference, `${operationId} unexpected response reference`);
    assertInvalid(ajv, schema("operation-envelope"), responseWithUnexpectedReference, `${operationId} unexpected generic reference`);

    const custodyField = structuredClone(payload);
    custodyField.privateKey = "0xnot-a-secret";
    assertInvalid(ajv, operation.requestDataSchema, custodyField, `${operationId} custody field`);
  }
  assert.equal(isSignedRuntimeTransitionOperation("network.get"), false);
});

test("signed runtime transition lifecycle rules require a runtime signature and no financial effect", () => {
  assert.equal(isAllowedTransition({ from: "DRAFT", to: "PREPARED", trigger: "REGISTER_WORKSPACE", executionProfile: "delegated-runtime" }), true);
  assert.equal(isAllowedTransition({ from: "DRAFT", to: "PREPARED", trigger: "REGISTER_ACTOR", executionProfile: "delegated-runtime" }), true);
  assert.equal(isAllowedTransition({ from: "DRAFT", to: "EVALUATING", trigger: "SUBMIT_PROPOSAL", executionProfile: "delegated-runtime" }), true);
  assert.equal(isAllowedTransition({ from: "ALLOWED", to: "COMMITTED", trigger: "SIGN_PACT", executionProfile: "delegated-runtime" }), true);
  assert.equal(isAllowedTransition({ from: "DRAFT", to: "COMMITTED", trigger: "SIGN_PACT", executionProfile: "delegated-runtime" }), false);
  assert.equal(isAllowedTransition({ from: "DRAFT", to: "EVALUATING", trigger: "SUBMIT_PROPOSAL", executionProfile: "direct-wallet-authorized" }), false);

  const transitions = readJson("registries/transition-rules.json").allowedTransitions;
  for (const trigger of ["REGISTER_WORKSPACE", "REGISTER_ACTOR", "SUBMIT_PROPOSAL"]) {
    const transition = transitions.find((candidate) => candidate.trigger === trigger);
    assert.deepEqual(transition.requires, ["RUNTIME_SIGNATURE"]);
    assert.equal(transition.financialEffect, "NONE");
  }
  const pactTransition = transitions.find((candidate) => candidate.trigger === "SIGN_PACT");
  assert.deepEqual(pactTransition.requires, ["ALLOW_DECISION", "PACT", "RUNTIME_SIGNATURE"]);
  assert.equal(pactTransition.financialEffect, "NONE");
});

test("the exported operation validator binds wrapper metadata and exact payload schemas", () => {
  const validRequest = operationEnvelope("network.get", { networkId: "arc-testnet" });
  const validRequestResult = validateOperation("network.get", validRequest, "request");
  assert.equal(validRequestResult.valid, true);
  assert.deepEqual(validRequestResult.issues, []);
  assert.equal(resolveOperation("network.get").capability, "network.get");
  assert.equal(assertValidOperation("network.get", validRequest), validRequest);

  const validResponse = operationEnvelope("network.get", { network: readJson("manifests/arc-testnet.json") }, "response");
  assert.equal(validateOperation("network.get", validResponse, "response").valid, true);

  const nullSuccess = structuredClone(validResponse);
  nullSuccess.data = null;
  const nullSuccessResult = validateOperation("network.get", nullSuccess, "response");
  assert.equal(nullSuccessResult.valid, false);
  assert.ok(nullSuccessResult.issues.some((issue) => issue.stage === "wrapper"));
  assert.ok(nullSuccessResult.issues.some((issue) => issue.stage === "payload"));

  const payloadFromAnotherOperation = structuredClone(validRequest);
  payloadFromAnotherOperation.data = { objectRef: ref("Workspace", "workspace:1") };
  const wrongPayloadResult = validateOperation("network.get", payloadFromAnotherOperation);
  assert.equal(wrongPayloadResult.valid, false);
  assert.ok(wrongPayloadResult.issues.some((issue) => issue.stage === "payload"));

  const capabilityMismatch = structuredClone(validRequest);
  capabilityMismatch.capability = "network.list";
  const capabilityMismatchResult = validateOperation("network.get", capabilityMismatch);
  assert.equal(capabilityMismatchResult.valid, false);
  assert.ok(capabilityMismatchResult.issues.some((issue) => issue.message.includes("capability")));

  const operationMismatch = structuredClone(validRequest);
  operationMismatch.operationId = "network.list";
  const operationMismatchResult = validateOperation("network.get", operationMismatch);
  assert.equal(operationMismatchResult.valid, false);
  assert.ok(operationMismatchResult.issues.some((issue) => issue.message.includes("operationId")));

  const authorizationMismatch = structuredClone(validRequest);
  authorizationMismatch.authorizationClass = "WALLET_TRANSACTION";
  const authorizationMismatchResult = validateOperation("network.get", authorizationMismatch);
  assert.equal(authorizationMismatchResult.valid, false);
  assert.ok(authorizationMismatchResult.issues.some((issue) => issue.message.includes("authorizationClass")));

  const profileMismatch = operationEnvelope("path.revoke", { objectRef: ref("Path", "path:1") });
  const profileMismatchResult = validateOperation("path.revoke", profileMismatch);
  assert.equal(profileMismatchResult.valid, false);
  assert.ok(profileMismatchResult.issues.some((issue) => issue.message.includes("executionProfile")));
});

test("operation-bound response validation accepts terminal null outcomes without financial success", () => {
  const cases = [
    "operation-response-signature-expired",
    "operation-response-wrong-network",
    "operation-response-transaction-reverted",
    "operation-response-rpc-unavailable",
    "operation-response-blocked",
    "operation-response-cancelled"
  ];

  for (const name of cases) {
    const response = fixture(name);
    assertValid(ajv, schema("operation-response"), response, `${name} response schema`);
    const result = validateOperation(response.operationId, response, "response");
    assert.equal(result.valid, true, `${name} operation-bound response`);
    assert.equal(response.data, null);
    assert.notEqual(response.lifecycleState, "SETTLED");
    assert.equal(response.receipts, undefined);
    assert.notEqual(response.transaction?.status, "CONFIRMED");
    assert.notEqual(response.transaction?.financialEffect, "RECONCILIATION_REQUIRED");
    if (["FAILED", "BLOCKED"].includes(response.lifecycleState)) assert.ok(response.errors.length > 0);
  }

  const blocked = fixture("operation-response-blocked");
  const blockedWithPact = structuredClone(blocked);
  blockedWithPact.pactRef = ref("Pact", "pact:blocked");
  assertInvalid(ajv, schema("operation-response"), blockedWithPact, "blocked response with Pact");

  const blockedWithFinancialEffect = structuredClone(blocked);
  blockedWithFinancialEffect.transaction.financialEffect = "PENDING";
  assertInvalid(ajv, schema("operation-response"), blockedWithFinancialEffect, "blocked response with financial effect");

  const failedWithoutError = structuredClone(fixture("operation-response-signature-expired"));
  failedWithoutError.errors = [];
  assertInvalid(ajv, schema("operation-response"), failedWithoutError, "failed response without structured error");
});

test("all operation reference-bearing request fields enforce their registry object types", () => {
  const cases = [
    { operationId: "workspace.get", data: { objectRef: ref("Workspace", "workspace:1") }, fields: [["objectRef", "Workspace"]] },
    { operationId: "path.revoke", data: { objectRef: ref("Path", "path:1") }, fields: [["objectRef", "Path"]] },
    { operationId: "pact.get", data: { objectRef: ref("Pact", "pact:1") }, fields: [["objectRef", "Pact"]] },
    { operationId: "proof.verify", data: { objectRef: ref("Proof", "proof:1") }, fields: [["objectRef", "Proof"]] },
    { operationId: "proof.get", data: { objectRef: ref("Proof", "proof:1") }, fields: [["objectRef", "Proof"]] },
    { operationId: "paycard.get", data: { objectRef: ref("PaycardStream", "paycard:1") }, fields: [["objectRef", "PaycardStream"]] },
    { operationId: "receipt.get", data: { objectRef: ref("Receipt", "receipt:1") }, fields: [["objectRef", "Receipt"]] },
    { operationId: "gaia.get", data: { objectRef: ref("GaiaCase", "case:1") }, fields: [["objectRef", "GaiaCase"]] },
    { operationId: "path.evaluate", data: { pathRef: ref("Path", "path:1"), intentRef: ref("Intent", "intent:1") }, fields: [["pathRef", "Path"], ["intentRef", "Intent"]] },
    { operationId: "railsflow.inspect", data: { railsflowRef: ref("RailsFlow", "railsflow:1") }, fields: [["railsflowRef", "RailsFlow"]] },
    { operationId: "railsflow.pay", data: { railsflowRef: ref("RailsFlow", "railsflow:1"), settlementIntentRef: ref("SettlementIntent", "settlement:1"), proofRef: ref("Proof", "proof:1") }, fields: [["railsflowRef", "RailsFlow"], ["settlementIntentRef", "SettlementIntent"], ["proofRef", "Proof"]] },
    { operationId: "railscard.inspect", data: { railscardRef: ref("RailsCard", "railscard:1") }, fields: [["railscardRef", "RailsCard"]] },
    { operationId: "railscard.claim", data: { railscardRef: ref("RailsCard", "railscard:1"), claimant: "0x1111111111111111111111111111111111111111", proofRef: ref("Proof", "proof:1") }, fields: [["railscardRef", "RailsCard"], ["proofRef", "Proof"]] },
    { operationId: "paycard.open", data: { paymentArtifactRef: ref("RailsFlow", "railsflow:1") }, fields: [["paymentArtifactRef", "RailsFlow"]] },
    { operationId: "paycard.open", data: { paymentArtifactRef: ref("RailsCard", "railscard:1") }, fields: [["paymentArtifactRef", "RailsCard"]] },
    { operationId: "paycard.settle", data: { paycardRef: ref("PaycardStream", "paycard:1"), proofRef: ref("Proof", "proof:1") }, fields: [["paycardRef", "PaycardStream"], ["proofRef", "Proof"]] },
    { operationId: "paycard.flushResidual", data: { paycardRef: ref("PaycardStream", "paycard:1"), proofRef: ref("Proof", "proof:1") }, fields: [["paycardRef", "PaycardStream"], ["proofRef", "Proof"]] },
    { operationId: "receipt.verify", data: { receiptRef: ref("Receipt", "receipt:1") }, fields: [["receiptRef", "Receipt"]] },
    { operationId: "wallet.handoff.get", data: { handoffRef: ref("WalletHandoff", "handoff:1") }, fields: [["handoffRef", "WalletHandoff"]] },
    { operationId: "gaia.resolve", data: { caseRef: ref("GaiaCase", "case:1"), obligationRefs: [ref("RectificationObligation", "obligation:1")] }, fields: [["caseRef", "GaiaCase"], ["obligationRefs", "RectificationObligation"]] }
  ];

  const registry = readJson("registries/operation-registry.json");
  for (const entry of cases) {
    const operation = registry.operations.find((candidate) => candidate.operationId === entry.operationId);
    assert.ok(operation, `registry entry for ${entry.operationId}`);
    assertValid(ajv, operation.requestDataSchema, entry.data, `${entry.operationId} typed references`);
    for (const [field, expectedType] of entry.fields) {
      const wrong = structuredClone(entry.data);
      const wrongType = expectedType === "Workspace" ? "Path" : "Workspace";
      wrong[field] = field.endsWith("Refs") ? [ref(wrongType, "wrong:1")] : ref(wrongType, "wrong:1");
      assertInvalid(ajv, operation.requestDataSchema, wrong, `${entry.operationId}.${field} wrong type`);
    }
  }
});

test("reusable model reference definitions reject wrong object types", () => {
  const cases = [
    ["WorkspaceRef", "Workspace"],
    ["WorkspaceMemberRef", "WorkspaceMember"],
    ["ActorRef", "Actor"],
    ["PathRef", "Path"],
    ["IntentRef", "Intent"],
    ["ProposalRef", "Proposal"],
    ["BaphometDecisionRef", "BaphometDecision"],
    ["SettlementIntentRef", "SettlementIntent"],
    ["PactRef", "Pact"],
    ["ProofPolicyRef", "ProofPolicy"],
    ["ProofRef", "Proof"],
    ["RailsFlowRef", "RailsFlow"],
    ["RailsCardRef", "RailsCard"],
    ["PaycardStreamRef", "PaycardStream"],
    ["ReceiptRef", "Receipt"],
    ["GaiaCaseRef", "GaiaCase"],
    ["RectificationObligationRef", "RectificationObligation"],
    ["WalletHandoffRef", "WalletHandoff"]
  ];
  for (const [definition, expectedType] of cases) {
    const refValue = ref(expectedType, `${definition}:1`);
    const refSchema = schema("common") + `#/$defs/${definition}`;
    assertValid(ajv, refSchema, refValue, `${definition} valid`);
    const wrong = { ...refValue, type: expectedType === "Workspace" ? "Path" : "Workspace" };
    assertInvalid(ajv, refSchema, wrong, `${definition} wrong type`);
  }

  const paymentArtifactSchema = schema("common") + "#/$defs/PaymentArtifactRef";
  assertValid(ajv, paymentArtifactSchema, ref("RailsFlow", "railsflow:1"), "RailsFlow payment artifact ref");
  assertValid(ajv, paymentArtifactSchema, ref("RailsCard", "railscard:1"), "RailsCard payment artifact ref");
  assertInvalid(ajv, paymentArtifactSchema, ref("Workspace", "workspace:1"), "wrong payment artifact ref");
  assertInvalid(ajv, schema("common") + "#/$defs/SubjectObjectRef", ref("Workspace", "workspace:1"), "wrong subject ref");

  const wrongCardRef = fixture("bearer-railscard-claim");
  wrongCardRef.intentRef = ref("Path", "path:wrong");
  assertInvalid(ajv, schema("railscard"), wrongCardRef, "wrong RailsCard intent ref");
});

test("Arc receipt mappings use the V2 event names and claim context", () => {
  const manifest = readJson("manifests/arc-testnet.json");
  const mappings = Object.fromEntries(manifest.receiptMappings.map((mapping) => [mapping.receiptType, mapping]));
  assert.equal(mappings.AUTHORIZATION.eventName, "PaycardProvisioned");
  assert.equal(mappings.CLAIM.eventName, "PaycardProvisioned");
  assert.equal(mappings.SETTLEMENT.eventName, "SettlementFlushed");
  assert.equal(mappings.RESIDUAL.eventName, "ResidualDeltaReclaimed");
  assert.deepEqual(mappings.CLAIM.contextRequirements, ["operationId", "signatureBinding", "recipient", "observedValues"]);
  for (const mapping of Object.values(mappings)) {
    assert.ok(mapping.verificationFields.includes("transaction.txHash"));
    assert.ok(mapping.verificationFields.includes("verification.exact.eventName"));
  }
  assert.doesNotMatch(JSON.stringify(manifest), /SettlementIntentAuthorized|RailsCardClaimed|"Settled"|ResidualFlushed/);
});

test("Arc Testnet manifest is typed and keeps delegated Runtime explicitly not live", () => {
  const manifest = readJson("manifests/arc-testnet.json");
  assertValid(ajv, schema("network-manifest"), manifest, "Arc Testnet manifest");
  assert.equal(manifest.chainId, "5042002");
  assert.equal(manifest.runtime.workspaceRuntimeStatus, "NOT_LIVE");
  assert.equal(manifest.runtime.delegatedRuntimeFinancialAuthority, "wallet-boundary");
  assert.equal(manifest.runtime.signatureDomain.name, "OpenRails Runtime");
  assert.equal(manifest.runtime.signatureDomain.version, "1.2.0");
  assert.equal(manifest.runtime.signatureDomain.chainId, manifest.chainId);
  assert.equal(manifest.runtime.signaturePurpose, "offchain-runtime");
  assert.equal("purpose" in manifest.runtime.signatureDomain, false);
  assert.equal("verifyingContract" in manifest.runtime.signatureDomain, false);
  assert.equal(manifest.runtime.anchorContract, manifest.contracts.find((contract) => contract.id === "arcOpenRailsHubV2").address);
  assert.deepEqual(manifest.capabilities.map((capability) => capability.capability), readJson("registries/capability-list.json").capabilities);
  for (const capability of ["workspace.register", "actor.register", "proposal.submit", "pact.sign"]) {
    const declaration = manifest.capabilities.find((item) => item.capability === capability);
    assert.equal(declaration.status, "UNAVAILABLE");
    assert.notEqual(declaration.status, "LIVE");
    assert.deepEqual(declaration.authorizationClasses, ["RELAY_SIGNED_ENVELOPE"]);
  }
});

test("public operation boundaries reject unknown payload properties", () => {
  assertInvalid(ajv, schema("operation-payloads") + "#/$defs/EmptyRequest", { unexpected: true }, "unknown request property");
  const requestData = { railsflowRef: ref("RailsFlow", "railsflow:1") };
  assertInvalid(ajv, schema("operation-payloads") + "#/$defs/RailsFlowInspectRequest", { ...requestData, unexpected: true }, "unknown inspect property");
});
