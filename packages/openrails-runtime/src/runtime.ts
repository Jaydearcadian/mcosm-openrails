import canonicalize from "canonicalize";
import { getAddress, keccak256, toUtf8Bytes } from "ethers";

import {
  ARC_TESTNET_MANIFEST,
  RUNTIME_TRANSITION_PRIMARY_TYPE,
  assertValidSchema,
  hashRuntimePayload,
  resolveOperation,
  validateOperation,
  type Actor,
  type Asset,
  type BaphometDecision,
  type CanonicalRecord,
  type InterfaceError,
  type Intent,
  type NetworkReference,
  type Pact,
  type Path,
  type PathLimit,
  type Proof,
  type PaymentTerms,
  type Proposal,
  type Provenance,
  type RuntimeSignatureBinding,
  type Workspace
} from "@openrails/shared-interface";

import { asRuntimeError, RuntimeError } from "./errors.js";
import { ArcJsonRpcProvider } from "./provider.js";
import { ArcRuntimeSignatureVerifier } from "./signature.js";
import { MemoryRuntimeStore, pathPeriodUsageKey } from "./store.js";
import { assertValidStoredState } from "./stored-state.js";
import {
  RUNTIME_OPERATION_IDS,
  type ReplayScope,
  type RuntimeOptions,
  type RuntimeState,
  type RuntimeStore,
  type RuntimeTransaction,
  type RuntimeRequest,
  type RuntimeResponse,
  type PathPeriodUsage,
  type PathAttestor
} from "./types.js";

const MAX_SIGNATURE_LIFETIME_SECONDS = 15 * 60;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const BAPHOMET_POLICY_VERSION = "baphomet-runtime-1.2.0";
const REF_KEYS = ["workspaceRef", "pathRef", "intentRef", "proposalRef", "decisionRef", "pactRef", "canonicalRecordRef", "proofRefs"] as const;

type RecordValue = Record<string, unknown>;

interface PreparedTransition {
  response: RuntimeResponse;
  commit(state: RuntimeState): void;
}

interface UsageReservation {
  key: string;
  value: PathPeriodUsage;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function sameRef(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  return left.type === right.type && left.id === right.id;
}

function canonical(value: unknown): string {
  const result = canonicalize(value);
  if (typeof result !== "string") throw new Error("Value is not JSON-canonicalizable.");
  return result;
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return canonical(left) === canonical(right);
  } catch {
    return false;
  }
}

function canonicalRecordCommitment(record: Pick<CanonicalRecord,
  "pactRef" | "sequence" | "previousCommitment" | "plaintextCommitment" | "ciphertextHash" | "encryption" | "encryptedKeys" | "storageLocators" | "settlementReferences"
>): string {
  return keccak256(toUtf8Bytes(canonical({
    pactRef: record.pactRef,
    sequence: record.sequence,
    previousCommitment: record.previousCommitment,
    plaintextCommitment: record.plaintextCommitment,
    ciphertextHash: record.ciphertextHash,
    encryption: record.encryption,
    encryptedKeys: record.encryptedKeys,
    storageLocators: record.storageLocators,
    settlementReferences: record.settlementReferences
  })));
}

function refId(value: unknown, expectedType: string, field: string): string {
  if (!isRecord(value) || value.type !== expectedType || typeof value.id !== "string") {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", `${field} is not a valid ${expectedType} reference.`);
  }
  return value.id;
}

function recordData(value: unknown, operationId: string): RecordValue {
  if (!isRecord(value)) throw new RuntimeError("INPUT_INVALID", `${operationId} payload data must be an object.`);
  return value;
}

function runtimeBinding(data: unknown, operationId: string): RuntimeSignatureBinding {
  const value = recordData(data, operationId).signatureBinding;
  if (!isRecord(value)) throw new RuntimeError("INPUT_INVALID", `${operationId} payload is missing signatureBinding.`);
  return value as unknown as RuntimeSignatureBinding;
}

function expectedNetwork(): NetworkReference {
  return {
    networkId: ARC_TESTNET_MANIFEST.networkId,
    chainId: ARC_TESTNET_MANIFEST.chainId
  };
}

function runtimeProvenance(at: string) {
  return {
    source: "runtime-evaluation" as const,
    authority: "OpenRails Runtime",
    evidenceLevel: "runtime-observed" as const,
    observedAt: at
  };
}

function isUsableWorkspace(workspace: Workspace): boolean {
  return workspace.status === "DRAFT" || workspace.status === "ACTIVE";
}

function isUsableActor(actor: Actor): boolean {
  return actor.authorityStatus !== "SUSPENDED" && actor.authorityStatus !== "REVOKED";
}

function isUsableIntent(intent: Intent, nowMs: number): boolean {
  const expiry = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= nowMs) return false;
  return !["FAILED", "CANCELLED", "SETTLED", "RESOLVED"].includes(intent.status);
}

function requireWorkspace(state: RuntimeState, id: string): Workspace {
  const stored = state.workspaces[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Workspace is missing or not usable.");
  const workspace = assertValidStoredState("Workspace", stored, `Workspace ${id}`);
  if (workspace.id !== id) throw new RuntimeError("STATE_STALE", "Stored Workspace ID does not match its state key.");
  if (!isUsableWorkspace(workspace)) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Workspace is missing or not usable.");
  return workspace;
}

function requireActor(state: RuntimeState, id: string): Actor {
  const stored = state.actors[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Actor is missing or not active.");
  const actor = assertValidStoredState("Actor", stored, `Actor ${id}`);
  if (actor.id !== id) throw new RuntimeError("STATE_STALE", "Stored Actor ID does not match its state key.");
  if (!isUsableActor(actor)) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Actor is missing or not active.");
  return actor;
}

function requirePath(state: RuntimeState, id: string): Path {
  const stored = state.paths[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path is missing or not active.");
  const path = assertValidStoredState("Path", stored, `Path ${id}`);
  if (path.id !== id) throw new RuntimeError("STATE_STALE", "Stored Path ID does not match its state key.");
  if (path.status !== "ACTIVE") throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path is missing or not active.");
  return path;
}

function requireAttestedPath(state: RuntimeState, path: Path): void {
  const stored = state.pathAttestations?.[path.id];
  if (!stored || typeof stored !== "object") {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path has not passed authenticated ingestion.");
  }

  const attestedPath = assertValidStoredState("Path", stored.path, `Path attestation ${path.id}`);
  const attestedProvenance = assertValidStoredState("Provenance", stored.provenance, `Path attestation provenance ${path.id}`);
  if (
    attestedPath.id !== path.id
    || !sameValue(attestedPath, path)
    || !sameValue(attestedProvenance, path.provenance)
    || !sameValue(attestedPath.provenance, attestedProvenance)
  ) {
    throw new RuntimeError("STATE_STALE", "Path does not match its authenticated ingestion snapshot.");
  }
}

function requireIntent(state: RuntimeState, id: string, nowMs: number): Intent {
  const stored = state.intents[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Intent is missing, expired, or closed.");
  const intent = assertValidStoredState("Intent", stored, `Intent ${id}`);
  if (intent.id !== id) throw new RuntimeError("STATE_STALE", "Stored Intent ID does not match its state key.");
  if (!isUsableIntent(intent, nowMs)) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Intent is missing, expired, or closed.");
  return intent;
}

function requireProposal(state: RuntimeState, id: string): Proposal {
  const stored = state.proposals[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Proposal is missing.");
  const proposal = assertValidStoredState("Proposal", stored, `Proposal ${id}`);
  if (proposal.id !== id) throw new RuntimeError("STATE_STALE", "Stored Proposal ID does not match its state key.");
  return proposal;
}

function requireDecision(state: RuntimeState, id: string): BaphometDecision {
  const stored = state.decisions[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Baphomet Decision is missing.");
  const decision = assertValidStoredState("BaphometDecision", stored, `Baphomet Decision ${id}`);
  if (decision.id !== id) throw new RuntimeError("STATE_STALE", "Stored Baphomet Decision ID does not match its state key.");
  return decision;
}

function requirePact(state: RuntimeState, id: string): Pact {
  const stored = state.pacts[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Pact is missing or not active.");
  const pact = assertValidStoredState("Pact", stored, `Pact ${id}`);
  if (pact.id !== id) throw new RuntimeError("STATE_STALE", "Stored Pact ID does not match its state key.");
  if (pact.status !== "ACTIVE") throw new RuntimeError("AUTHORIZATION_REQUIRED", "Pact is missing or not active.");
  return pact;
}

function requireProof(state: RuntimeState, id: string): Proof {
  const stored = state.proofs[id];
  if (!stored) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Proof is missing.");
  const proof = assertValidStoredState("Proof", stored, `Proof ${id}`);
  if (proof.id !== id) throw new RuntimeError("STATE_STALE", "Stored Proof ID does not match its state key.");
  return proof;
}

function requireWorkspaceAuthority(state: RuntimeState, workspaceId: string): string {
  const storedAuthority = state.workspaceAuthorities[workspaceId];
  if (!storedAuthority) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Workspace authority is missing.");
  try {
    return getAddress(storedAuthority);
  } catch {
    throw new RuntimeError("STATE_STALE", "Stored Workspace authority is not a valid wallet address.");
  }
}

function requireStoredPact(state: RuntimeState, id: string): void {
  const stored = state.pacts[id];
  if (stored) {
    const pact = assertValidStoredState("Pact", stored, `Pact ${id}`);
    if (pact.id !== id) throw new RuntimeError("STATE_STALE", "Stored Pact ID does not match its state key.");
    throw new RuntimeError("STATE_STALE", "Pact has already been recorded.");
  }
  if (state.committedPacts[id]) throw new RuntimeError("STATE_STALE", "Pact has already been recorded.");
}

function assertCanonicalRecordBinding(pact: Pact, record: CanonicalRecord | undefined): void {
  const policy = pact.canonicalRecordPolicy?.mode ?? "omitted";
  if (!record) {
    if (policy === "required") throw new RuntimeError("AUTHORIZATION_REQUIRED", "Pact requires a Canonical Record.");
    return;
  }
  if (policy === "omitted") throw new RuntimeError("TERMS_MISMATCH", "Pact policy omits Canonical Records.");
  try {
    assertValidSchema("https://schemas.openrails.dev/openrails/1.2.0/canonical-record.schema.json", record);
  } catch (error) {
    throw new RuntimeError("INPUT_INVALID", "Canonical Record failed Shared Interface 1.2 schema validation.", {
      details: { reason: error instanceof Error ? error.message : "Canonical Record schema validation failed" }
    });
  }
  if (!pact.canonicalRecordRef || !sameRef(pact.canonicalRecordRef, { type: "CanonicalRecord", id: record.id })) {
    throw new RuntimeError("TERMS_MISMATCH", "Pact Canonical Record reference does not match the supplied record.");
  }
  if (!sameRef(record.pactRef, { type: "Pact", id: pact.id })) {
    throw new RuntimeError("TERMS_MISMATCH", "Canonical Record Pact reference does not match the Pact.");
  }
  const commitment = canonicalRecordCommitment(record);
  const partyIds = pact.parties.map((party) => party.id);
  const distinctPartyIds = new Set(partyIds);
  if (distinctPartyIds.size !== 2) throw new RuntimeError("TERMS_MISMATCH", "Canonical Record binding requires exactly two distinct Pact parties.");
  const signatureIds = new Set(record.signatures.map((signature) => signature.actorRef.id));
  if (signatureIds.size !== 2 || [...distinctPartyIds].some((id) => !signatureIds.has(id))) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Canonical Record signatures must cover both Pact parties.");
  }
  if (record.signatures.some((signature) => signature.signedCommitment.toLowerCase() !== commitment.toLowerCase())) {
    throw new RuntimeError("TERMS_MISMATCH", "Canonical Record signature commitment does not match the record envelope.");
  }
  const keyIds = new Set(record.encryptedKeys.map((entry) => entry.counterpartyRef.id));
  if (record.encryption.mode === "encrypted") {
    if (keyIds.size !== 2 || [...distinctPartyIds].some((id) => !keyIds.has(id))) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Encrypted Canonical Record keys must cover both Pact parties.");
    }
  } else if (record.encryptedKeys.length !== 0) {
    throw new RuntimeError("TERMS_MISMATCH", "Public Canonical Records cannot contain encrypted counterparty keys.");
  }
}

function runtimeErrorRecord(
  operationId: string,
  code: InterfaceError["code"],
  message: string,
  lifecycleState: InterfaceError["lifecycleState"],
  at: Date,
  retryable = false
): InterfaceError {
  return {
    interfaceVersion: "1.2.0",
    code,
    message,
    retryable,
    financialEffect: "NONE",
    lifecycleState,
    transactionState: "NOT_REQUESTED",
    operationId,
    occurredAt: at.toISOString(),
    provenance: runtimeProvenance(at.toISOString())
  };
}

function assertNetwork(request: RuntimeRequest): void {
  const expected = expectedNetwork();
  if (request.network.networkId !== expected.networkId || request.network.chainId !== expected.chainId) {
    throw new RuntimeError("WRONG_NETWORK", "Runtime transitions must target the Arc Testnet manifest network.", {
      details: { reason: `expected ${expected.networkId}/${expected.chainId}` }
    });
  }
}

export interface RuntimeBindingValidationOptions {
  now?: Date;
  maxSignatureLifetimeSeconds?: number;
  clockSkewSeconds?: number;
}

/**
 * Validate the signed envelope independently of state mutation. Authenticated
 * read routes use this same boundary as state-changing Runtime transitions.
 */
export function assertRuntimeBinding(
  operationId: string,
  request: RuntimeRequest,
  binding: RuntimeSignatureBinding,
  options: RuntimeBindingValidationOptions = {},
): void {
  if (!isRecord(request) || !isRecord(request.network) || !isRecord(request.subject)) {
    throw new RuntimeError("INPUT_INVALID", "Signed runtime requests require network and subject fields.");
  }
  if (
    !isRecord(binding)
    || !isRecord(binding.domain)
    || typeof binding.operationId !== "string"
    || typeof binding.signatureStandard !== "string"
    || typeof binding.primaryType !== "string"
    || typeof binding.signaturePurpose !== "string"
    || typeof binding.payloadHash !== "string"
    || typeof binding.signer !== "string"
    || typeof binding.signature !== "string"
    || typeof binding.nonce !== "string"
    || typeof binding.issuedAt !== "string"
    || typeof binding.expiresAt !== "string"
    || typeof binding.chainId !== "string"
    || typeof binding.anchorContract !== "string"
    || typeof binding.domain.name !== "string"
    || typeof binding.domain.version !== "string"
    || typeof binding.domain.chainId !== "string"
    || typeof binding.domain.salt !== "string"
  ) {
    throw new RuntimeError("INPUT_INVALID", "Runtime signature binding is malformed.");
  }
  assertNetwork(request);
  if (request.interfaceVersion !== "1.2.0") throw new RuntimeError("INPUT_INVALID", "Signed runtime transitions require Shared Interface 1.2.0.");
  if (binding.operationId !== operationId) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Signature operation binding does not match the requested operation.");
  if (binding.signatureStandard !== "eip-712" || binding.primaryType !== RUNTIME_TRANSITION_PRIMARY_TYPE) {
    throw new RuntimeError("SIGNATURE_INVALID", "Runtime signature standard or primary type is not supported.");
  }
  if (binding.signaturePurpose !== ARC_TESTNET_MANIFEST.runtime.signaturePurpose) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Runtime signature purpose does not match the Arc manifest.");
  }
  const expectedDomain = ARC_TESTNET_MANIFEST.runtime.signatureDomain;
  if (
    binding.domain.name !== expectedDomain.name
    || binding.domain.version !== expectedDomain.version
    || binding.domain.chainId !== expectedDomain.chainId
    || binding.domain.salt.toLowerCase() !== expectedDomain.salt.toLowerCase()
    || "verifyingContract" in (binding.domain as unknown as Record<string, unknown>)
  ) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Runtime EIP-712 domain does not match the Arc manifest.");
  }
  if (binding.chainId !== ARC_TESTNET_MANIFEST.chainId || binding.domain.chainId !== request.network.chainId) {
    throw new RuntimeError("WRONG_NETWORK", "Runtime signature chain ID does not match the Arc manifest network.");
  }
  if (!sameAddress(binding.anchorContract, ARC_TESTNET_MANIFEST.runtime.anchorContract)) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Runtime anchor contract does not match the Arc manifest.");
  }
  if (request.subject.walletAddress && !sameAddress(request.subject.walletAddress, binding.signer)) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Request subject wallet does not match the runtime signer.");
  }
  let payloadHash: string;
  try {
    payloadHash = hashRuntimePayload(request.data);
  } catch (error) {
    throw new RuntimeError("INPUT_INVALID", "Runtime transition payload is not canonicalizable.", {
      details: { reason: error instanceof Error ? error.message : "canonicalization failed" }
    });
  }
  if (binding.payloadHash.toLowerCase() !== payloadHash.toLowerCase()) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Runtime signature payload hash does not match request data.");
  }
  const nowMs = (options.now ?? new Date()).getTime();
  const issuedAtMs = Date.parse(binding.issuedAt);
  const expiresAtMs = Date.parse(binding.expiresAt);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) {
    throw new RuntimeError("SIGNATURE_EXPIRED", "Runtime signature time window is invalid.", { details: { field: "issuedAt/expiresAt" } });
  }
  const clockSkewSeconds = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const maxSignatureLifetimeSeconds = options.maxSignatureLifetimeSeconds ?? MAX_SIGNATURE_LIFETIME_SECONDS;
  if (issuedAtMs > nowMs + clockSkewSeconds * 1000) {
    throw new RuntimeError("SIGNATURE_EXPIRED", "Runtime signature was issued in the future.", { details: { field: "issuedAt" } });
  }
  if (expiresAtMs <= nowMs) {
    throw new RuntimeError("SIGNATURE_EXPIRED", "Runtime signature has expired.", { details: { field: "expiresAt" } });
  }
  if (expiresAtMs - issuedAtMs > maxSignatureLifetimeSeconds * 1000) {
    throw new RuntimeError("SIGNATURE_EXPIRED", "Runtime signature lifetime exceeds the configured maximum.", { details: { field: "expiresAt" } });
  }
}

function assertRequestedNetwork(intent: Intent, request: RuntimeRequest): void {
  if (intent.requestedNetwork && !sameValue(intent.requestedNetwork, request.network)) {
    throw new RuntimeError("WRONG_NETWORK", "Intent requested network does not match the Arc Testnet request network.");
  }
}

function assertReference(value: unknown, expected: unknown, field: string): void {
  if (!sameRef(value, expected)) throw new RuntimeError("AUTHORIZATION_REQUIRED", `${field} does not match the authorized object reference.`);
}

function sameAsset(left: Asset, right: Asset): boolean {
  return left.symbol === right.symbol
    && left.decimals === right.decimals
    && left.kind === right.kind
    && sameAddress(left.address, right.address);
}

function assetKey(asset: Asset): string {
  return canonical({ ...asset, address: getAddress(asset.address) });
}

function integer(value: string): bigint {
  return BigInt(value);
}

function settlementTypedDataDomain() {
  const anchor = ARC_TESTNET_MANIFEST.runtime.anchorContract;
  const domain = ARC_TESTNET_MANIFEST.typedDataDomains.find((candidate) => (
    candidate.chainId === ARC_TESTNET_MANIFEST.chainId
    && sameAddress(candidate.verifyingContract, anchor)
  ));
  if (!domain) throw new RuntimeError("INTERNAL_ERROR", "Arc manifest has no settlement typed-data domain for the Runtime anchor.");
  return domain;
}

function assertPathBinding(path: Path, nowMs: number): void {
  const binding = path.signatureBinding;
  const expected = settlementTypedDataDomain();
  if (
    binding.chainId !== ARC_TESTNET_MANIFEST.chainId
    || !sameAddress(binding.verifyingContract, ARC_TESTNET_MANIFEST.runtime.anchorContract)
    || binding.domain.name !== expected.name
    || binding.domain.version !== expected.version
    || binding.domain.chainId !== expected.chainId
    || !sameAddress(binding.domain.verifyingContract, expected.verifyingContract)
    || binding.domain.salt !== expected.salt
  ) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path signature binding does not match the Arc settlement domain and anchor.");
  }
  const issuedAtMs = Date.parse(binding.issuedAt);
  const expiresAtMs = Date.parse(binding.expiresAt);
  if (issuedAtMs > nowMs || expiresAtMs <= nowMs) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path signature binding is not currently valid.");
  }
}

function assertPathIssuerAuthority(state: RuntimeState, workspace: Workspace, path: Path): void {
  const issuerId = refId(path.issuerActorRef, "Actor", "path.issuerActorRef");
  const issuer = requireActor(state, issuerId);
  const authority = requireWorkspaceAuthority(state, workspace.id);
  if (
    !issuer.walletAddress
    || !sameAddress(issuer.walletAddress, path.signatureBinding.signer)
    || !sameAddress(authority, path.signatureBinding.signer)
  ) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path issuer, signature signer, and Workspace authority do not match.");
  }
}

function usageBucketStart(nowMs: number, periodSeconds: bigint): bigint {
  const nowSeconds = BigInt(Math.floor(nowMs / 1000));
  return (nowSeconds / periodSeconds) * periodSeconds;
}

function currentUsage(
  state: RuntimeState,
  key: string,
  expected: Omit<PathPeriodUsage, "transactionCount" | "amount">
): PathPeriodUsage {
  const usage = state.pathPeriodUsage[key];
  if (!usage) return { ...expected, transactionCount: "0", amount: "0" };
  if (
    usage.pathId !== expected.pathId
    || usage.assetKey !== expected.assetKey
    || usage.limitIndex !== expected.limitIndex
    || usage.periodSeconds !== expected.periodSeconds
    || usage.bucketStartSeconds !== expected.bucketStartSeconds
    || !/^(0|[1-9][0-9]*)$/.test(usage.transactionCount)
    || !/^(0|[1-9][0-9]*)$/.test(usage.amount)
  ) {
    throw new RuntimeError("STATE_STALE", "Path period usage state is malformed or does not match its deterministic key.");
  }
  return usage;
}

function assertLimitTerms(limit: PathLimit, terms: PaymentTerms): void {
  const amount = integer(terms.amount);
  if (amount > integer(limit.maxAmount)) {
    throw new RuntimeError("POLICY_BLOCKED", "Payment amount exceeds the Path limit maximum amount.");
  }
  if (limit.maxAmountPerTransaction !== undefined && amount > integer(limit.maxAmountPerTransaction)) {
    throw new RuntimeError("POLICY_BLOCKED", "Payment amount exceeds the Path per-transaction maximum.");
  }
  if (terms.settlementShape === "streamed") {
    if (limit.maxVelocityPerSecond !== undefined && integer(terms.velocityPerSecond!) > integer(limit.maxVelocityPerSecond)) {
      throw new RuntimeError("POLICY_BLOCKED", "Stream velocity exceeds the Path limit.");
    }
    if (limit.maxLifespanSeconds !== undefined && integer(terms.lifespanSeconds!) > integer(limit.maxLifespanSeconds)) {
      throw new RuntimeError("POLICY_BLOCKED", "Stream lifespan exceeds the Path limit.");
    }
  }
}

function assertPathAuthority(
  state: RuntimeState,
  path: Path,
  intent: Intent,
  terms: PaymentTerms,
  at: Date,
  reserveUsage: boolean
): UsageReservation[] {
  assertPathBinding(path, at.getTime());
  if (!path.capabilities.includes(intent.action)) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Intent action is outside the Path capabilities.");
  }
  const applicable = path.limits
    .map((limit, limitIndex) => ({ limit, limitIndex }))
    .filter(({ limit }) => sameAsset(limit.asset, terms.asset));
  if (applicable.length === 0) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path has no applicable limit for the payment asset.");
  }

  const reservations: UsageReservation[] = [];
  for (const { limit, limitIndex } of applicable) {
    assertLimitTerms(limit, terms);
    if (!reserveUsage) continue;

    const period = integer(limit.periodSeconds);
    const bucketStart = usageBucketStart(at.getTime(), period).toString();
    const normalizedAsset = assetKey(limit.asset);
    const expected = {
      pathId: path.id,
      assetKey: normalizedAsset,
      limitIndex,
      periodSeconds: limit.periodSeconds,
      bucketStartSeconds: bucketStart
    };
    const key = pathPeriodUsageKey(expected);
    const usage = currentUsage(state, key, expected);
    const nextCount = integer(usage.transactionCount) + 1n;
    const nextAmount = integer(usage.amount) + integer(terms.amount);
    if (nextCount > integer(limit.maxTransactionsPerPeriod)) {
      throw new RuntimeError("POLICY_BLOCKED", "Path transaction count exceeds the current period limit.");
    }
    if (nextAmount > integer(limit.maxAmount)) {
      throw new RuntimeError("POLICY_BLOCKED", "Path cumulative amount exceeds the current period limit.");
    }
    reservations.push({
      key,
      value: { ...expected, transactionCount: nextCount.toString(), amount: nextAmount.toString() }
    });
  }
  return reservations;
}

export class Runtime {
  private readonly store: RuntimeStore;
  private readonly now: () => Date;
  private readonly verifier: ArcRuntimeSignatureVerifier;
  private readonly pathAttestor?: PathAttestor;
  private readonly maxSignatureLifetimeSeconds: number;
  private readonly clockSkewSeconds: number;

  constructor(options: RuntimeOptions = {}) {
    this.store = options.store ?? new MemoryRuntimeStore();
    this.now = options.now ?? (() => new Date());
    this.verifier = new ArcRuntimeSignatureVerifier(options.provider ?? new ArcJsonRpcProvider());
    this.pathAttestor = options.pathAttestor;
    this.maxSignatureLifetimeSeconds = options.maxSignatureLifetimeSeconds ?? MAX_SIGNATURE_LIFETIME_SECONDS;
    this.clockSkewSeconds = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
    if (!Number.isSafeInteger(this.maxSignatureLifetimeSeconds) || this.maxSignatureLifetimeSeconds < 1 || this.maxSignatureLifetimeSeconds > MAX_SIGNATURE_LIFETIME_SECONDS) {
      throw new RangeError(`maxSignatureLifetimeSeconds must be between 1 and ${MAX_SIGNATURE_LIFETIME_SECONDS}.`);
    }
    if (!Number.isSafeInteger(this.clockSkewSeconds) || this.clockSkewSeconds < 0 || this.clockSkewSeconds > 300) {
      throw new RangeError("clockSkewSeconds must be between 0 and 300.");
    }
  }

  async state(): Promise<RuntimeState> {
    return this.store.snapshot();
  }

  async ingestPath(input: unknown): Promise<Path> {
    let path: Path;
    try {
      path = assertValidSchema("https://schemas.openrails.dev/openrails/1.2.0/path.schema.json", input) as Path;
    } catch (error) {
      throw new RuntimeError("INPUT_INVALID", "Path failed Shared Interface 1.2 schema validation.", {
        details: { reason: error instanceof Error ? error.message : "Path schema validation failed" }
      });
    }
    if (!this.pathAttestor) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Authenticated Path ingestion requires a caller-supplied PathAttestor.");
    }

    let provenance: Provenance;
    try {
      provenance = await this.pathAttestor.attest(clone(path));
      assertValidSchema("https://schemas.openrails.dev/openrails/1.2.0/provenance.schema.json", provenance);
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path attestation did not produce valid provenance.", {
        details: { reason: error instanceof Error ? error.message : "Path attestation failed" }
      });
    }
    if (provenance.source === "configuration" || provenance.evidenceLevel === "configuration-only") {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Configuration-only provenance cannot authenticate a Path.");
    }

    const acceptedPath = { ...clone(path), provenance: clone(provenance) };
    return this.store.transact(async (transaction) => {
      const existing = transaction.state.paths[acceptedPath.id];
      const existingAttestation = transaction.state.pathAttestations?.[acceptedPath.id];
      if (existingAttestation) {
        throw new RuntimeError("STATE_STALE", "Path has already been authenticated.");
      }
      if (existing && !sameValue(existing, path)) {
        throw new RuntimeError("STATE_STALE", "Path already exists with different content.");
      }
      transaction.state.paths[acceptedPath.id] = clone(acceptedPath);
      transaction.state.pathAttestations[acceptedPath.id] = {
        path: clone(acceptedPath),
        provenance: clone(provenance)
      };
      return acceptedPath;
    });
  }

  async execute(input: unknown): Promise<RuntimeResponse> {
    const operationId = isRecord(input) && typeof input.operationId === "string" ? input.operationId : "";
    let validation: ReturnType<typeof validateOperation>;

    try {
      validation = validateOperation(operationId, input, "request");
    } catch (error) {
      throw new RuntimeError("INPUT_INVALID", error instanceof Error ? error.message : "Unknown OpenRails operation.");
    }
    if (!validation.valid) {
      throw new RuntimeError("INPUT_INVALID", `Shared Interface rejected ${operationId}.`, {
        details: { reason: JSON.stringify(validation.issues) }
      });
    }
    if (!RUNTIME_OPERATION_IDS.includes(operationId as typeof RUNTIME_OPERATION_IDS[number])) {
      throw new RuntimeError("INPUT_INVALID", `Runtime does not accept operation ${operationId}.`);
    }

    const request = input as RuntimeRequest;
    const binding = runtimeBinding(request.data, operationId);
    assertRuntimeBinding(operationId, request, binding, {
      now: this.now(),
      maxSignatureLifetimeSeconds: this.maxSignatureLifetimeSeconds,
      clockSkewSeconds: this.clockSkewSeconds,
    });
    await this.verifyBinding(binding);

    const scope: ReplayScope = {
      domainSalt: binding.domain.salt,
      chainId: binding.chainId,
      anchorContract: getAddress(binding.anchorContract),
      signer: getAddress(binding.signer),
      nonce: binding.nonce
    };

    return this.store.transact(async (transaction) => {
      // The insert is rolled back if authorization or state preparation fails.
      // Performing it before object checks also makes concurrent duplicates report
      // NONCE_CONFLICT instead of a misleading object-exists error.
      await transaction.consumeReplayNonce(scope);
      const prepared = this.prepareTransition(operationId as typeof RUNTIME_OPERATION_IDS[number], request, binding, transaction, new Date(this.now().getTime()));
      const responseValidation = validateOperation(operationId, prepared.response, "response");
      if (!responseValidation.valid) {
        throw new RuntimeError("INTERNAL_ERROR", `Runtime produced an invalid ${operationId} response.`, {
          details: { reason: JSON.stringify(responseValidation.issues) }
        });
      }
      prepared.commit(transaction.state);
      return prepared.response;
    });
  }

  private async verifyBinding(binding: RuntimeSignatureBinding): Promise<void> {
    try {
      await this.verifier.verify(binding);
    } catch (error) {
      throw asRuntimeError(error, "SIGNATURE_INVALID", "Runtime signature verification failed.");
    }
  }

  private prepareTransition(
    operationId: typeof RUNTIME_OPERATION_IDS[number],
    request: RuntimeRequest,
    binding: RuntimeSignatureBinding,
    transaction: RuntimeTransaction,
    at: Date
  ): PreparedTransition {
    switch (operationId) {
      case "workspace.register":
        return this.prepareWorkspace(request, binding, transaction.state, at);
      case "actor.register":
        return this.prepareActor(request, binding, transaction.state, at);
      case "path.activate":
        return this.preparePathActivate(request, binding, transaction.state, at);
      case "path.revoke":
        return this.preparePathRevoke(request, binding, transaction.state, at);
      case "intent.prepare":
        return this.prepareIntent(request, binding, transaction.state, at);
      case "proposal.evaluate":
        return this.prepareProposalEvaluate(request, binding, transaction.state, at);
      case "proposal.submit":
        return this.prepareProposal(request, binding, transaction.state, at);
      case "pact.sign":
        return this.preparePact(request, binding, transaction.state, at);
      case "proof.submit":
        return this.prepareProofSubmit(request, binding, transaction.state, at);
      case "proof.verify":
        return this.prepareProofVerify(request, binding, transaction.state, at);
    }
  }

  private preparePathActivate(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "path.activate") as unknown as { path: Path };
    const path = data.path;
    const workspace = requireWorkspace(state, refId(path.workspaceRef, "Workspace", "path.workspaceRef"));
    const authority = requireWorkspaceAuthority(state, workspace.id);
    const issuer = requireActor(state, refId(path.issuerActorRef, "Actor", "path.issuerActorRef"));
    const delegate = requireActor(state, refId(path.delegateActorRef, "Actor", "path.delegateActorRef"));
    if (path.status !== "PREPARED") throw new RuntimeError("STATE_STALE", "Path activation requires a PREPARED Path.");
    if (!issuer.walletAddress || !sameAddress(issuer.walletAddress, authority) || !sameAddress(binding.signer, authority)) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path activation signer is not the Workspace authority.");
    }
    if (!delegate.walletAddress) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path delegate must have a wallet address.");
    assertPathBinding(path, at.getTime());
    const existing = state.paths[path.id];
    if (existing && (!sameValue(existing, path) || existing.status !== "PREPARED")) {
      throw new RuntimeError("STATE_STALE", "Path already exists with different or active content.");
    }
    const activatedPath: Path = { ...clone(path), status: "ACTIVE" };
    const response = this.buildResponse(request, "path.activate", "COMMITTED", { path: activatedPath }, at);
    return {
      response,
      commit: (draft) => {
        draft.paths[path.id] = clone(activatedPath);
        draft.pathAttestations[path.id] = { path: clone(activatedPath), provenance: clone(activatedPath.provenance) };
      }
    };
  }

  private preparePathRevoke(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "path.revoke") as unknown as { objectRef: RecordValue };
    const pathId = refId(data.objectRef, "Path", "objectRef");
    const path = requirePath(state, pathId);
    requireAttestedPath(state, path);
    const workspace = requireWorkspace(state, refId(path.workspaceRef, "Workspace", "path.workspaceRef"));
    const authority = requireWorkspaceAuthority(state, workspace.id);
    const issuer = requireActor(state, refId(path.issuerActorRef, "Actor", "path.issuerActorRef"));
    if (!issuer.walletAddress || !sameAddress(issuer.walletAddress, authority) || !sameAddress(binding.signer, authority)) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path revocation signer is not the Workspace authority.");
    }
    assertPathBinding(path, at.getTime());
    const revokedPath: Path = { ...clone(path), status: "REVOKED" };
    const response = this.buildResponse(request, "path.revoke", "CANCELLED", { path: revokedPath }, at);
    return {
      response,
      commit: (draft) => {
        draft.paths[path.id] = clone(revokedPath);
        if (draft.pathAttestations[path.id]) draft.pathAttestations[path.id].path = clone(revokedPath);
      }
    };
  }

  private prepareIntent(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "intent.prepare") as unknown as { intent: Intent };
    const intent = data.intent;
    const workspace = requireWorkspace(state, refId(intent.workspaceRef, "Workspace", "intent.workspaceRef"));
    const path = requirePath(state, refId(intent.pathRef, "Path", "intent.pathRef"));
    requireAttestedPath(state, path);
    assertReference(path.workspaceRef, { type: "Workspace", id: workspace.id }, "Path workspaceRef");
    assertPathIssuerAuthority(state, workspace, path);
    if (!sameAddress(binding.signer, requireWorkspaceAuthority(state, workspace.id))) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Intent preparation signer is not the Workspace authority.");
    }
    if (intent.status !== "DRAFT") throw new RuntimeError("STATE_STALE", "Intent preparation requires a DRAFT Intent.");
    if (intent.requestedNetwork) assertRequestedNetwork(intent, request);
    if (state.intents[intent.id]) throw new RuntimeError("STATE_STALE", "Intent has already been prepared.");
    const preparedIntent: Intent = { ...clone(intent), status: "PREPARED" };
    const response = this.buildResponse(request, "intent.prepare", "PREPARED", { intent: preparedIntent }, at);
    return {
      response,
      commit: (draft) => { draft.intents[intent.id] = clone(preparedIntent); }
    };
  }

  private prepareProposalEvaluate(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "proposal.evaluate") as unknown as { proposal: Proposal };
    const proposal = data.proposal;
    const workspace = requireWorkspace(state, refId(proposal.workspaceRef, "Workspace", "proposal.workspaceRef"));
    const path = requirePath(state, refId(proposal.pathRef, "Path", "proposal.pathRef"));
    requireAttestedPath(state, path);
    const intent = requireIntent(state, refId(proposal.intentRef, "Intent", "proposal.intentRef"), at.getTime());
    assertReference(path.workspaceRef, { type: "Workspace", id: workspace.id }, "Path workspaceRef");
    assertPathIssuerAuthority(state, workspace, path);
    if (!sameRef(intent.workspaceRef, { type: "Workspace", id: workspace.id }) || !sameRef(intent.pathRef, { type: "Path", id: path.id })) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Intent does not match the Workspace and Path chain.");
    }
    assertRequestedNetwork(intent, request);
    if (proposal.status !== "EVALUATING") throw new RuntimeError("STATE_STALE", "Proposal evaluation requires an EVALUATING proposal.");
    if (!sameValue(proposal.normalizedTerms, intent.paymentTerms)) throw new RuntimeError("TERMS_MISMATCH", "Proposal terms do not match the existing Intent.");
    const delegate = requireActor(state, refId(path.delegateActorRef, "Actor", "path.delegateActorRef"));
    if (!delegate.walletAddress || !sameAddress(delegate.walletAddress, binding.signer)) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Proposal evaluation signer is not the active Path delegate wallet.");
    }
    assertReference(request.workspaceRef, proposal.workspaceRef, "request.workspaceRef");
    assertReference(request.pathRef, proposal.pathRef, "request.pathRef");
    assertReference(request.intentRef, proposal.intentRef, "request.intentRef");
    assertReference(request.proposalRef, { type: "Proposal", id: proposal.id }, "request.proposalRef");

    const policyVersion = proposal.policyVersion ?? BAPHOMET_POLICY_VERSION;
    const evaluatedProposal: Proposal = { ...clone(proposal), policyVersion };
    const existing = state.proposals[proposal.id];
    if (existing && (!sameValue(existing, proposal) || existing.status !== "EVALUATING")) {
      throw new RuntimeError("STATE_STALE", "Proposal already exists with different or terminal content.");
    }
    let reservations: UsageReservation[] = [];
    let decision: BaphometDecision;
    let lifecycleState: "ALLOWED" | "BLOCKED";
    let errors: InterfaceError[] = [];
    try {
      reservations = assertPathAuthority(state, path, intent, proposal.normalizedTerms, at, !existing);
      if (!intent.pactRef) throw new RuntimeError("AUTHORIZATION_REQUIRED", "An ALLOW evaluation requires a pre-bound Pact reference on the Intent.");
      lifecycleState = "ALLOWED";
      decision = {
        interfaceVersion: "1.2.0",
        id: `decision:${proposal.id}`,
        executionProfile: "delegated-runtime",
        proposalRef: { type: "Proposal", id: proposal.id },
        decision: "ALLOW",
        policyVersion,
        inputHash: proposal.inputHash,
        reasonCodes: ["PATH_WITHIN_LIMIT"],
        pactRef: clone(intent.pactRef),
        effects: { financialEffect: "NONE", walletAction: "REQUIRED", paycardCreated: false, valueMoved: false },
        decidedAt: at.toISOString(),
        provenance: runtimeProvenance(at.toISOString())
      };
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "POLICY_BLOCKED") throw error;
      lifecycleState = "BLOCKED";
      evaluatedProposal.status = "BLOCKED";
      decision = {
        interfaceVersion: "1.2.0",
        id: `decision:${proposal.id}`,
        executionProfile: "delegated-runtime",
        proposalRef: { type: "Proposal", id: proposal.id },
        decision: "BLOCK",
        policyVersion,
        inputHash: proposal.inputHash,
        reasonCodes: ["PATH_LIMIT_EXCEEDED"],
        effects: { financialEffect: "NONE", walletAction: "NONE", paycardCreated: false, valueMoved: false },
        decidedAt: at.toISOString(),
        provenance: runtimeProvenance(at.toISOString())
      };
      errors = [runtimeErrorRecord("proposal.evaluate", "POLICY_BLOCKED", error.message, "BLOCKED", at)];
    }
    if (lifecycleState === "ALLOWED") evaluatedProposal.status = "ALLOWED";
    if (state.decisions[decision.id]) throw new RuntimeError("STATE_STALE", "Baphomet Decision has already been recorded.");
    const response = this.buildResponse(request, "proposal.evaluate", lifecycleState, { decision }, at, errors);
    return {
      response,
      commit: (draft) => {
        draft.proposals[proposal.id] = clone(evaluatedProposal);
        draft.decisions[decision.id] = clone(decision);
        for (const reservation of reservations) draft.pathPeriodUsage[reservation.key] = clone(reservation.value);
      }
    };
  }

  private prepareWorkspace(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "workspace.register") as unknown as { workspace: Workspace };
    const workspace = data.workspace;
    if (state.workspaces[workspace.id] || state.workspaceAuthorities[workspace.id]) {
      throw new RuntimeError("STATE_STALE", "Workspace has already been registered.");
    }
    if (workspace.status !== "DRAFT" && workspace.status !== "ACTIVE") {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Workspace must be DRAFT or ACTIVE at registration.");
    }
    const authority = getAddress(binding.signer);
    const response = this.buildResponse(request, "workspace.register", "PREPARED", data, at);
    return {
      response,
      commit: (draft) => {
        draft.workspaces[workspace.id] = clone(workspace);
        draft.workspaceAuthorities[workspace.id] = authority;
      }
    };
  }

  private prepareActor(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "actor.register") as unknown as { workspaceRef: RecordValue; actor: Actor };
    const workspaceId = refId(data.workspaceRef, "Workspace", "workspaceRef");
    const workspace = requireWorkspace(state, workspaceId);
    const authority = requireWorkspaceAuthority(state, workspace.id);
    if (!sameAddress(authority, binding.signer)) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Actor registration signer is not the Workspace authority.");
    if (state.actors[data.actor.id]) throw new RuntimeError("STATE_STALE", "Actor has already been registered.");
    if (data.actor.id === workspace.ownerActorRef.id) {
      if (!data.actor.walletAddress || !sameAddress(data.actor.walletAddress, binding.signer)) {
        throw new RuntimeError("AUTHORIZATION_REQUIRED", "Workspace owner Actor ID and wallet must match the bootstrap signer.");
      }
    }
    const response = this.buildResponse(request, "actor.register", "PREPARED", data, at);
    return {
      response,
      commit: (draft) => {
        draft.actors[data.actor.id] = clone(data.actor);
        draft.actorWorkspaces[data.actor.id] = workspace.id;
      }
    };
  }

  private prepareProposal(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "proposal.submit") as unknown as { proposal: Proposal };
    const proposal = data.proposal;
    const workspaceId = refId(proposal.workspaceRef, "Workspace", "proposal.workspaceRef");
    const pathId = refId(proposal.pathRef, "Path", "proposal.pathRef");
    const intentId = refId(proposal.intentRef, "Intent", "proposal.intentRef");
    const workspace = requireWorkspace(state, workspaceId);
    const path = requirePath(state, pathId);
    requireAttestedPath(state, path);
    const intent = requireIntent(state, intentId, at.getTime());
    assertReference(path.workspaceRef, { type: "Workspace", id: workspace.id }, "Path workspaceRef");
    assertPathIssuerAuthority(state, workspace, path);
    if (!sameRef(intent.workspaceRef, { type: "Workspace", id: workspace.id }) || !sameRef(intent.pathRef, { type: "Path", id: path.id })) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Intent does not match the Workspace and Path chain.");
    }
    assertRequestedNetwork(intent, request);
    const usageReservations = assertPathAuthority(state, path, intent, proposal.normalizedTerms, at, true);
    if (proposal.status !== "EVALUATING") throw new RuntimeError("STATE_STALE", "Proposal submission requires EVALUATING proposal state.");
    if (!sameValue(proposal.normalizedTerms, intent.paymentTerms)) throw new RuntimeError("TERMS_MISMATCH", "Proposal terms do not match the existing Intent.");
    if (state.proposals[proposal.id]) throw new RuntimeError("STATE_STALE", "Proposal has already been submitted.");

    const delegateId = refId(path.delegateActorRef, "Actor", "path.delegateActorRef");
    const delegate = requireActor(state, delegateId);
    if (!delegate.walletAddress || !sameAddress(delegate.walletAddress, binding.signer)) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Proposal signer is not the active Path delegate wallet.");
    }
    assertReference(request.workspaceRef, proposal.workspaceRef, "request.workspaceRef");
    assertReference(request.pathRef, proposal.pathRef, "request.pathRef");
    assertReference(request.intentRef, proposal.intentRef, "request.intentRef");
    assertReference(request.proposalRef, { type: "Proposal", id: proposal.id }, "request.proposalRef");
    const response = this.buildResponse(request, "proposal.submit", "EVALUATING", data, at);
    return {
      response,
      commit: (draft) => {
        draft.proposals[proposal.id] = clone(proposal);
        for (const reservation of usageReservations) {
          draft.pathPeriodUsage[reservation.key] = clone(reservation.value);
        }
      }
    };
  }

  private prepareProofSubmit(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "proof.submit") as unknown as { proof: Proof };
    const proof = data.proof;
    const workspace = requireWorkspace(state, refId(proof.workspaceRef, "Workspace", "proof.workspaceRef"));
    const path = requirePath(state, refId(proof.pathRef, "Path", "proof.pathRef"));
    const intent = requireIntent(state, refId(proof.intentRef, "Intent", "proof.intentRef"), at.getTime());
    const proposal = requireProposal(state, refId(proof.proposalRef, "Proposal", "proof.proposalRef"));
    const pact = requirePact(state, refId(proof.pactRef, "Pact", "proof.pactRef"));
    requireAttestedPath(state, path);
    assertReference(path.workspaceRef, { type: "Workspace", id: workspace.id }, "Path workspaceRef");
    assertReference(proposal.workspaceRef, { type: "Workspace", id: workspace.id }, "Proposal workspaceRef");
    assertReference(proposal.pathRef, { type: "Path", id: path.id }, "Proposal pathRef");
    assertReference(proposal.intentRef, { type: "Intent", id: intent.id }, "Proposal intentRef");
    assertReference(pact.workspaceRef, { type: "Workspace", id: workspace.id }, "Pact workspaceRef");
    assertReference(pact.pathRef, { type: "Path", id: path.id }, "Pact pathRef");
    assertReference(pact.proposalRef, { type: "Proposal", id: proposal.id }, "Pact proposalRef");
    if (proof.status !== "SUBMITTED") throw new RuntimeError("PROOF_INVALID", "Proof submission requires SUBMITTED proof state.");
    if (!sameRef(proof.policyRef, { type: "ProofPolicy", id: pact.proofPolicy.id })) {
      throw new RuntimeError("TERMS_MISMATCH", "Proof policy does not match the active Pact.");
    }
    const pactActors = pact.parties.map((party) => requireActor(state, party.id));
    const signerActor = pactActors.find((actor) => actor.walletAddress && sameAddress(actor.walletAddress, binding.signer));
    if (!signerActor) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Proof signer is not an active Pact party.");
    if (proof.subjectRef.type === "Actor") {
      const subject = requireActor(state, proof.subjectRef.id);
      if (!subject.walletAddress || !sameAddress(subject.walletAddress, binding.signer)) {
        throw new RuntimeError("AUTHORIZATION_REQUIRED", "Proof subject and signer do not match.");
      }
    }
    if (state.proofs[proof.id]) throw new RuntimeError("STATE_STALE", "Proof has already been submitted.");
    const response = this.buildResponse(request, "proof.submit", "PROOF_PENDING", { proof: clone(proof) }, at);
    return {
      response,
      commit: (draft) => { draft.proofs[proof.id] = clone(proof); }
    };
  }

  private prepareProofVerify(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "proof.verify") as unknown as { objectRef: RecordValue };
    const proofId = refId(data.objectRef, "Proof", "objectRef");
    const proof = requireProof(state, proofId);
    const workspace = requireWorkspace(state, refId(proof.workspaceRef, "Workspace", "proof.workspaceRef"));
    const path = requirePath(state, refId(proof.pathRef, "Path", "proof.pathRef"));
    const intent = requireIntent(state, refId(proof.intentRef, "Intent", "proof.intentRef"), at.getTime());
    const proposal = requireProposal(state, refId(proof.proposalRef, "Proposal", "proof.proposalRef"));
    const pact = requirePact(state, refId(proof.pactRef, "Pact", "proof.pactRef"));
    requireAttestedPath(state, path);
    assertReference(path.workspaceRef, { type: "Workspace", id: workspace.id }, "Path workspaceRef");
    assertReference(proposal.workspaceRef, { type: "Workspace", id: workspace.id }, "Proposal workspaceRef");
    assertReference(proposal.pathRef, { type: "Path", id: path.id }, "Proposal pathRef");
    assertReference(proposal.intentRef, { type: "Intent", id: intent.id }, "Proposal intentRef");
    assertReference(pact.workspaceRef, { type: "Workspace", id: workspace.id }, "Pact workspaceRef");
    assertReference(pact.pathRef, { type: "Path", id: path.id }, "Pact pathRef");
    assertReference(pact.proposalRef, { type: "Proposal", id: proposal.id }, "Pact proposalRef");
    if (proof.status !== "SUBMITTED") throw new RuntimeError("STATE_STALE", "Proof must be submitted before verification.");
    const verifier = pact.parties
      .map((party) => requireActor(state, party.id))
      .find((actor) => actor.walletAddress && sameAddress(actor.walletAddress, binding.signer));
    if (!verifier) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Proof verifier is not an active Pact party.");
    const verifiedProof: Proof = {
      ...clone(proof),
      status: "VERIFIED",
      verifiedAt: at.toISOString(),
      verifierActorRef: { type: "Actor", id: verifier.id }
    };
    const response = this.buildResponse(request, "proof.verify", "PROOF_VERIFIED", { proof: verifiedProof }, at);
    return {
      response,
      commit: (draft) => { draft.proofs[proof.id] = clone(verifiedProof); }
    };
  }

  private preparePact(request: RuntimeRequest, binding: RuntimeSignatureBinding, state: RuntimeState, at: Date): PreparedTransition {
    const data = recordData(request.data, "pact.sign") as unknown as { intentRef: RecordValue; pact: Pact; canonicalRecord?: CanonicalRecord };
    const pact = data.pact;
    const workspaceId = refId(pact.workspaceRef, "Workspace", "pact.workspaceRef");
    const pathId = refId(pact.pathRef, "Path", "pact.pathRef");
    const intentId = refId(data.intentRef, "Intent", "intentRef");
    const proposalId = refId(pact.proposalRef, "Proposal", "pact.proposalRef");
    const decisionId = refId(pact.decisionRef, "BaphometDecision", "pact.decisionRef");
    const workspace = requireWorkspace(state, workspaceId);
    const path = requirePath(state, pathId);
    requireAttestedPath(state, path);
    const intent = requireIntent(state, intentId, at.getTime());
    const proposal = requireProposal(state, proposalId);
    const decision = requireDecision(state, decisionId);

    assertReference(path.workspaceRef, { type: "Workspace", id: workspace.id }, "Path workspaceRef");
    assertPathIssuerAuthority(state, workspace, path);
    if (!sameRef(intent.workspaceRef, { type: "Workspace", id: workspace.id }) || !sameRef(intent.pathRef, { type: "Path", id: path.id })) {
      throw new RuntimeError("AUTHORIZATION_REQUIRED", "Intent does not match the Workspace and Path chain.");
    }
    assertRequestedNetwork(intent, request);
    assertReference(proposal.workspaceRef, { type: "Workspace", id: workspace.id }, "Proposal workspaceRef");
    assertReference(proposal.pathRef, { type: "Path", id: path.id }, "Proposal pathRef");
    assertReference(proposal.intentRef, { type: "Intent", id: intent.id }, "Proposal intentRef");
    if (proposal.status !== "ALLOWED" || decision.decision !== "ALLOW") {
      throw new RuntimeError("POLICY_BLOCKED", "Pact signing requires an ALLOW Baphomet Decision.");
    }
    assertReference(decision.proposalRef, { type: "Proposal", id: proposal.id }, "Decision proposalRef");
    if (decision.inputHash !== proposal.inputHash) throw new RuntimeError("TERMS_MISMATCH", "Baphomet Decision input hash does not match Proposal input hash.");
    if (decision.policyVersion !== proposal.policyVersion) {
      throw new RuntimeError("POLICY_BLOCKED", "Baphomet Decision policy version does not match the Proposal policy version.");
    }
    if (!decision.pactRef) throw new RuntimeError("AUTHORIZATION_REQUIRED", "ALLOW Decision is missing its required Pact reference.");
    assertReference(decision.pactRef, { type: "Pact", id: pact.id }, "Decision pactRef");
    if (pact.status !== "DRAFT") throw new RuntimeError("STATE_STALE", "Pact signing requires a DRAFT Pact.");
    if (!sameValue(pact.paymentTerms, intent.paymentTerms) || !sameValue(pact.paymentTerms, proposal.normalizedTerms)) {
      throw new RuntimeError("TERMS_MISMATCH", "Pact payment terms do not match the Intent and Proposal.");
    }
    assertPathAuthority(state, path, intent, pact.paymentTerms, at, false);
    const partyActors = pact.parties.map((party) => requireActor(state, party.id));
    const signerActor = partyActors.find((actor) => actor.walletAddress && sameAddress(actor.walletAddress, binding.signer));
    if (!signerActor) throw new RuntimeError("AUTHORIZATION_REQUIRED", "Pact signer is not an authorized active Pact party.");
    requireStoredPact(state, pact.id);
    assertReference(request.workspaceRef, pact.workspaceRef, "request.workspaceRef");
    assertReference(request.pathRef, pact.pathRef, "request.pathRef");
    assertReference(request.intentRef, data.intentRef, "request.intentRef");
    assertReference(request.proposalRef, pact.proposalRef, "request.proposalRef");
    assertReference(request.decisionRef, pact.decisionRef, "request.decisionRef");
    assertReference(request.pactRef, { type: "Pact", id: pact.id }, "request.pactRef");

    const activatedPact: Pact = { ...clone(pact), status: "ACTIVE", activatedAt: at.toISOString() };
    assertCanonicalRecordBinding(activatedPact, data.canonicalRecord);
    if (data.canonicalRecord && state.canonicalRecords[data.canonicalRecord.id]) {
      throw new RuntimeError("STATE_STALE", "Canonical Record has already been recorded.");
    }
    const responseData: RecordValue = {
      intentRef: clone(data.intentRef),
      pact: activatedPact,
      signatureBinding: clone(binding),
      ...(data.canonicalRecord ? { canonicalRecord: clone(data.canonicalRecord) } : {})
    };
    const response = this.buildResponse(request, "pact.sign", "COMMITTED", responseData, at);
    if (data.canonicalRecord) response.canonicalRecordRef = { type: "CanonicalRecord", id: data.canonicalRecord.id };
    return {
      response,
      commit: (draft) => {
        draft.pacts[pact.id] = clone(activatedPact);
        draft.committedPacts[pact.id] = at.toISOString();
        if (data.canonicalRecord) draft.canonicalRecords[data.canonicalRecord.id] = clone(data.canonicalRecord);
      }
    };
  }

  private buildResponse(
    request: RuntimeRequest,
    operationId: typeof RUNTIME_OPERATION_IDS[number],
    lifecycleState: RuntimeResponse["lifecycleState"],
    data: RecordValue,
    at: Date,
    errors: InterfaceError[] = []
  ): RuntimeResponse {
    const operation = resolveOperation(operationId);
    const timestamp = at.toISOString();
    const response: RecordValue = {
      interfaceVersion: "1.2.0",
      executionProfile: "delegated-runtime",
      operationId,
      capability: operation.capability,
      lifecycleState,
      authorizationClass: operation.authorizationClass,
      subject: clone(request.subject),
      network: clone(request.network),
      data: clone(data),
      transaction: {
        interfaceVersion: "1.2.0",
        status: "NOT_REQUESTED",
        network: clone(request.network),
        financialEffect: "NONE",
        observedAt: timestamp
      },
      errors,
      provenance: runtimeProvenance(timestamp),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    for (const key of REF_KEYS) {
      const value = request[key];
      if (value !== undefined) response[key] = clone(value);
    }
    return response as unknown as RuntimeResponse;
  }
}
