import {
  ARC_TESTNET_MANIFEST,
  canonicalRecordCapabilityDeclaration,
  CircleGasStationAdapter,
  createOperationRequest,
  hashRuntimePayload,
  isSignedRuntimeTransitionOperation,
  validateOperationRequest,
  validateOperationResponse,
  verifyCanonicalRecord,
  type CanonicalRecord,
  type CanonicalRecordPolicy,
  type Pact,
} from "openrails-sdk";
import { getAddress, getBytes, verifyMessage } from "ethers";
import {
  ArcJsonRpcProvider,
  ArcRuntimeSignatureVerifier,
  PostgresRuntimeStore,
  Runtime,
  RuntimeError,
  assertRuntimeBinding,
  type RuntimeBinding,
  type RuntimeRequest,
  type RuntimeState,
} from "@openrails/runtime";
import type { InterfaceError, NetworkReference, Path, Provenance } from "@openrails/shared-interface";

import { createNeonRuntimeExecutor } from "./neon";

export interface Env {
  ARC_RPC_URL?: string;
  ARC_RPC_FALLBACK_URL?: string;
  ARC_CHAIN_ID?: string;
  OPENRAILS_CORS_ORIGIN?: string;
  OPENRAILS_RUNTIME_ENABLED?: string;
  OPENRAILS_RUNTIME_ADMIN_TOKEN?: string;
  DATABASE_URL?: string;
}

const ARC_NETWORK = { networkId: "arc-testnet", chainId: "5042002" } as const;
const INTERFACE_ROUTE_BASES = [
  "/api/v1/interface",
  "/api/interface",
  `/api/interface/${ARC_TESTNET_MANIFEST.interfaceVersion}`,
] as const;
const RUNTIME_BASE = `/api/interface/${ARC_TESTNET_MANIFEST.interfaceVersion}/runtime`;
const MAX_BODY_BYTES = 64 * 1024;
const circleGasStation = new CircleGasStationAdapter({ credentialsPresent: false });

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly allow?: string) {
    super(message);
    this.name = "HttpError";
  }
}

function corsHeaders(request: Request, env: Env): Headers {
  const configuredOrigin = env.OPENRAILS_CORS_ORIGIN?.trim();
  const requestOrigin = request.headers.get("Origin");
  const allowOrigin = configuredOrigin && requestOrigin === configuredOrigin
    ? configuredOrigin
    : configuredOrigin
      ? configuredOrigin
      : "*";
  return new Headers({
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-ID",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Expose-Headers": "X-OpenRails-Request-ID",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
}

function jsonResponse(request: Request, env: Env, body: unknown, status = 200): Response {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  const requestId = request.headers.get("X-Request-ID");
  if (requestId) headers.set("X-OpenRails-Request-ID", requestId.slice(0, 128));
  return new Response(JSON.stringify(body), { status, headers });
}

function logServerError(error: unknown): void {
  if (error instanceof Error) {
    console.error("OpenRails interface request failure", {
      name: error.name,
      message: error.message.slice(0, 240),
    });
    return;
  }
  console.error("OpenRails interface request failure", { value: String(error).slice(0, 240) });
}

interface RuntimeFailureContext {
  operationId?: string;
  body?: Record<string, unknown>;
}

function runtimeFailureRecord(error: RuntimeError, context: RuntimeFailureContext = {}): InterfaceError {
  const occurredAt = new Date().toISOString();
  const bodyNetwork = context.body?.network;
  const actualNetwork: NetworkReference = bodyNetwork && typeof bodyNetwork === "object" && !Array.isArray(bodyNetwork)
    ? bodyNetwork as NetworkReference
    : ARC_NETWORK;
  const data = context.body?.data;
  const signatureBinding = data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).signatureBinding
    : undefined;
  const bindingExpiresAt = signatureBinding && typeof signatureBinding === "object" && !Array.isArray(signatureBinding)
    ? (signatureBinding as Record<string, unknown>).expiresAt
    : undefined;
  const record: InterfaceError = {
    interfaceVersion: ARC_TESTNET_MANIFEST.interfaceVersion,
    code: error.code,
    message: error.message.slice(0, 1000),
    retryable: error.code === "RPC_UNAVAILABLE" ? true : error.retryable,
    financialEffect: "NONE",
    lifecycleState: error.code === "POLICY_BLOCKED" ? "BLOCKED" : "FAILED",
    transactionState: "NOT_REQUESTED",
    operationId: context.operationId || "runtime.execute",
    occurredAt,
    provenance: {
      source: "runtime-evaluation",
      authority: "OpenRails Interface Worker",
      evidenceLevel: "runtime-observed",
      observedAt: occurredAt,
    },
    ...(error.details && Object.keys(error.details).length > 0 ? { details: error.details } : {}),
    ...(error.code === "WRONG_NETWORK" ? { expectedNetwork: ARC_NETWORK, actualNetwork } : {}),
    ...(error.code === "SIGNATURE_EXPIRED"
      ? { expiresAt: typeof bindingExpiresAt === "string" ? bindingExpiresAt : occurredAt }
      : {}),
  };
  return record;
}

function errorResponse(request: Request, env: Env, error: unknown, context: RuntimeFailureContext = {}): Response {
  if (error instanceof HttpError) {
    const response = jsonResponse(request, env, { valid: false, error: error.message }, error.status);
    if (error.allow) response.headers.set("Allow", error.allow);
    return response;
  }
  if (error instanceof RuntimeError) {
    logServerError(error);
    const status = error.code === "RPC_UNAVAILABLE" ? 503
      : error.code === "NONCE_CONFLICT" || error.code === "STATE_STALE" ? 409
        : error.code === "AUTHORIZATION_REQUIRED" || error.code === "SIGNATURE_INVALID" ? 401
          : error.code === "INTERNAL_ERROR" ? 503
          : 400;
    return jsonResponse(request, env, {
      valid: false,
      error: error.code === "INTERNAL_ERROR" ? "Runtime temporarily unavailable. Retry shortly." : error.message,
      code: error.code,
      retryable: error.retryable,
      errors: [runtimeFailureRecord(error, context)],
      transaction: { status: "NOT_REQUESTED", financialEffect: "NONE" },
    }, status);
  }
  logServerError(error);
  return jsonResponse(request, env, {
    valid: false,
    error: "Internal server error.",
    code: "INTERNAL_ERROR",
  }, 500);
}

function rejectCustodyFields(value: unknown, path = "body"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectCustodyFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/private.?key|seed.?phrase|mnemonic|secret.?key|signer.?key/i.test(key)) {
      throw new HttpError(400, `${path}.${key} is not accepted by the safe interface surface`);
    }
    rejectCustodyFields(child, `${path}.${key}`);
  }
}

async function bodyRecord(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, `JSON body exceeds the ${MAX_BODY_BYTES} byte interface limit`);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, `JSON body exceeds the ${MAX_BODY_BYTES} byte interface limit`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Valid JSON is required.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "JSON object body required.");
  }
  rejectCustodyFields(parsed);
  return parsed as Record<string, unknown>;
}

function readInterfaceObject(request: Request, env: Env, type: string, id: string): Response {
  if (type === "NetworkManifest" || type === "network") {
    if (id && id !== ARC_NETWORK.networkId) return jsonResponse(request, env, { error: "Network manifest not found" }, 404);
    return jsonResponse(request, env, { object: ARC_TESTNET_MANIFEST, source: "shipped-manifest" });
  }
  if (type === "CapabilityDeclaration" || type === "capabilities") {
    return jsonResponse(request, env, {
      object: { interfaceVersion: ARC_TESTNET_MANIFEST.interfaceVersion, capabilities: ARC_TESTNET_MANIFEST.capabilities },
      source: "shipped-manifest",
    });
  }
  return jsonResponse(request, env, {
    error: "Replaceable indexer read is unavailable",
    type,
    id: id || null,
    capabilityStatus: "UNAVAILABLE",
    financialEffect: "NONE",
  }, 503);
}

function runtimeCapability(env: Env) {
  const enabled = env.OPENRAILS_RUNTIME_ENABLED === "true";
  const persistent = Boolean(env.DATABASE_URL);
  const adminConfigured = Boolean(env.OPENRAILS_RUNTIME_ADMIN_TOKEN);
  return {
    status: enabled && persistent && adminConfigured ? "CONFIGURED" : "NOT_CONFIGURED",
    execution: "signed-control-plane-only",
    persistence: "neon-postgres",
    enabled,
    databaseConfigured: persistent,
    adminConfigured,
    operations: [
      "workspace.register",
      "workspace.list",
      "workspace.get",
      "actor.register",
      "path.activate",
      "path.revoke",
      "intent.prepare",
      "proposal.evaluate",
      "proposal.submit",
      "pact.sign",
      "proof.submit",
      "proof.verify",
    ],
    financialEffect: "NONE",
    note: "The Runtime never signs, broadcasts, holds keys, or moves value.",
  } as const;
}

function assertRuntimeReady(env: Env): void {
  if (env.OPENRAILS_RUNTIME_ENABLED !== "true") {
    throw new HttpError(503, "OpenRails Runtime execution is disabled for this deployment.");
  }
  if (!env.DATABASE_URL) {
    throw new HttpError(503, "OpenRails Runtime persistence is not configured.");
  }
}

function assertRuntimeAdmin(request: Request, env: Env): void {
  if (!env.OPENRAILS_RUNTIME_ADMIN_TOKEN) {
    throw new HttpError(503, "OpenRails Runtime attestor administration is not configured.");
  }
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || token !== env.OPENRAILS_RUNTIME_ADMIN_TOKEN) {
    throw new HttpError(401, "Runtime administrator authorization is required.");
  }
}

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

async function attestApplicationPath(path: Path): Promise<Provenance> {
  const unsignedPath = {
    ...path,
    signatureBinding: { ...path.signatureBinding, signature: "0x" },
  };
  const digest = hashRuntimePayload({
    purpose: "openrails-application-path-attestation-v1",
    path: unsignedPath,
  });
  let recovered: string;
  try {
    recovered = verifyMessage(getBytes(digest), path.signatureBinding.signature);
  } catch {
    throw new RuntimeError("SIGNATURE_INVALID", "Path application signature is invalid.");
  }
  if (!sameAddress(recovered, path.signatureBinding.signer)) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Path application signer does not match its signature binding.");
  }
  return {
    source: "wallet-signed",
    authority: "OpenRails Runtime Worker",
    evidenceLevel: "independently-verified",
    observedAt: new Date().toISOString(),
    notes: "Path accepted after verification of the application-specific owner attestation.",
  };
}

class ArcReadProviderWithFallback {
  private readonly providers: Array<{ host: string; provider: ArcJsonRpcProvider }>;

  constructor(urls: string[]) {
    this.providers = [...new Set(urls.filter(Boolean))].map((url) => {
      let host = "invalid-endpoint";
      try {
        host = new URL(url).hostname;
      } catch {
        // The provider will fail closed if an operator supplies a malformed URL.
      }
      return { host, provider: new ArcJsonRpcProvider(url) };
    });
  }

  getCode(address: string): Promise<string> {
    return this.read("eth_getCode", (provider) => provider.getCode(address));
  }

  call(request: { to: string; data: string }): Promise<string> {
    return this.read("eth_call", (provider) => provider.call(request));
  }

  private async read(operation: string, action: (provider: ArcJsonRpcProvider) => Promise<string>): Promise<string> {
    let lastError: unknown;
    for (const candidate of this.providers) {
      try {
        return await action(candidate.provider);
      } catch (error) {
        lastError = error;
        console.warn("Arc read provider failed", {
          operation,
          endpoint: candidate.host,
          message: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`No Arc read provider is configured for ${operation}.`);
  }
}

function createRuntime(env: Env) {
  assertRuntimeReady(env);
  const executor = createNeonRuntimeExecutor(env.DATABASE_URL!);
  const store = new PostgresRuntimeStore(executor);
  const provider = new ArcReadProviderWithFallback([
    env.ARC_RPC_URL ?? ARC_TESTNET_MANIFEST.rpc.defaultEndpoint,
    env.ARC_RPC_FALLBACK_URL ?? "",
  ]);
  const runtime = new Runtime({
    store,
    provider,
    pathAttestor: {
      attest: attestApplicationPath,
    },
  });
  const verifier = new ArcRuntimeSignatureVerifier(provider);
  return { executor, runtime, store, verifier };
}

async function withRuntime<T>(
  env: Env,
  operation: (runtime: Runtime, store: PostgresRuntimeStore, verifier: ArcRuntimeSignatureVerifier) => Promise<T>,
): Promise<T> {
  let executor: Awaited<ReturnType<typeof createNeonRuntimeExecutor>> | undefined;
  try {
    const resources = createRuntime(env);
    executor = resources.executor;
    return await operation(resources.runtime, resources.store, resources.verifier);
  } catch (error) {
    if (error instanceof HttpError || error instanceof RuntimeError) throw error;
    logServerError(error);
    throw new RuntimeError("INTERNAL_ERROR", "Runtime persistence is temporarily unavailable.", { retryable: true });
  } finally {
    try {
      await executor?.close();
    } catch (error) {
      logServerError(error);
    }
  }
}

const RUNTIME_READ_OPERATIONS = new Set(["workspace.list", "workspace.get"]);

function refId(value: unknown, expectedType: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const ref = value as Record<string, unknown>;
  return ref.type === expectedType && typeof ref.id === "string" ? ref.id : undefined;
}

function workspaceScoped(value: unknown, workspaceId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return refId((value as Record<string, unknown>).workspaceRef, "Workspace") === workspaceId;
}

function workspaceSnapshot(state: RuntimeState, workspaceId: string) {
  const workspace = state.workspaces[workspaceId];
  if (!workspace) return undefined;

  const paths = Object.fromEntries(Object.entries(state.paths).filter(([, path]) => workspaceScoped(path, workspaceId)));
  const intents = Object.fromEntries(Object.entries(state.intents).filter(([, intent]) => workspaceScoped(intent, workspaceId)));
  const proposals = Object.fromEntries(Object.entries(state.proposals).filter(([, proposal]) => workspaceScoped(proposal, workspaceId)));
  const pacts = Object.fromEntries(Object.entries(state.pacts).filter(([, pact]) => workspaceScoped(pact, workspaceId)));
  const proofs = Object.fromEntries(Object.entries(state.proofs).filter(([, proof]) => workspaceScoped(proof, workspaceId)));
  const decisions = Object.fromEntries(Object.entries(state.decisions).filter(([, decision]) => {
    if (workspaceScoped(decision, workspaceId)) return true;
    const proposalRef = refId((decision as Record<string, unknown>).proposalRef, "Proposal");
    return Boolean(proposalRef && proposals[proposalRef]);
  }));

  const actorIds = new Set<string>([workspace.ownerActorRef.id]);
  for (const [actorId, actorWorkspaceId] of Object.entries(state.actorWorkspaces)) {
    if (actorWorkspaceId === workspaceId) actorIds.add(actorId);
  }
  for (const path of Object.values(paths)) {
    const issuerId = refId(path.issuerActorRef, "Actor");
    const delegateId = refId(path.delegateActorRef, "Actor");
    if (issuerId) actorIds.add(issuerId);
    if (delegateId) actorIds.add(delegateId);
  }
  for (const actorId of actorIds) {
    if (!state.actors[actorId]) actorIds.delete(actorId);
  }

  return {
    workspace,
    actors: Object.fromEntries([...actorIds].map((actorId) => [actorId, state.actors[actorId]])),
    paths,
    intents,
    proposals,
    decisions,
    pacts,
    proofs,
    operations: {},
  };
}

function canReadWorkspace(state: RuntimeState, workspaceId: string, walletAddress: string): boolean {
  const authority = state.workspaceAuthorities[workspaceId];
  if (authority && sameAddress(authority, walletAddress)) return true;
  return Object.entries(state.actorWorkspaces).some(([actorId, actorWorkspaceId]) => (
    actorWorkspaceId === workspaceId
    && Boolean(state.actors[actorId]?.walletAddress)
    && sameAddress(state.actors[actorId].walletAddress!, walletAddress)
  ));
}

async function discoverRuntime(request: Request, env: Env): Promise<Response> {
  const body = await bodyRecord(request);
  const operationId = body.operationId;
  if (operationId !== "workspace.list" && operationId !== "workspace.get") {
    throw new HttpError(400, "workspace.list or workspace.get is required.");
  }
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "data object is required.");
  const dataRecord = data as Record<string, unknown>;
  if (typeof dataRecord.walletAddress !== "string") throw new HttpError(400, "data.walletAddress is required.");
  if (operationId === "workspace.get" && typeof dataRecord.workspaceId !== "string") {
    throw new HttpError(400, "data.workspaceId is required for workspace.get.");
  }
  const binding = dataRecord.signatureBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new RuntimeError("INPUT_INVALID", "Workspace discovery payload is missing signatureBinding.");
  }
  const runtimeRequest = body as unknown as RuntimeRequest;
  assertRuntimeBinding(operationId, runtimeRequest, binding as RuntimeBinding);
  if (!sameAddress(dataRecord.walletAddress, (binding as { signer: string }).signer)) {
    throw new RuntimeError("AUTHORIZATION_REQUIRED", "Discovery wallet does not match the runtime signer.");
  }
  return withRuntime(env, async (_runtime, store, verifier) => {
    await verifier.verify(binding as RuntimeBinding);
    const state = await store.snapshot();
    const workspaceId = operationId === "workspace.get" ? String(dataRecord.workspaceId) : undefined;
    const workspaces = Object.keys(state.workspaces)
      .filter((id) => !workspaceId || id === workspaceId)
      .filter((id) => canReadWorkspace(state, id, dataRecord.walletAddress as string))
      .map((id) => workspaceSnapshot(state, id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .map((value) => ({
        id: value.workspace.id,
        name: value.workspace.name,
        status: value.workspace.status,
        updatedAt: value.workspace.updatedAt,
        owner: state.workspaceAuthorities[value.workspace.id],
        workspace: value.workspace,
        runtime: value,
      }));
    if (operationId === "workspace.get" && workspaces.length === 0) {
      throw new HttpError(404, "Workspace not found.");
    }
    return jsonResponse(request, env, {
      interfaceVersion: ARC_TESTNET_MANIFEST.interfaceVersion,
      operationId,
      walletAddress: getAddress(dataRecord.walletAddress as string),
      workspaces,
    });
  });
}

function capabilities(request: Request, env: Env): Response {
  const runtime = runtimeCapability(env);
  const runtimeOperations = new Set([
    ...RUNTIME_READ_OPERATIONS,
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
  const declaredCapabilities = ARC_TESTNET_MANIFEST.capabilities.map((capability) => (
    runtime.status === "CONFIGURED" && runtimeOperations.has(capability.capability)
      ? {
          ...capability,
          status: "LIVE",
          statusJustification: "The signed control-plane transition is available on the configured Neon-backed Runtime Worker; it has no financial effect.",
          evidence: ["worker:runtime-configured"],
          provenance: {
            source: "network-observation",
            authority: "OpenRails Interface Worker",
            evidenceLevel: "independently-verified",
            observedAt: new Date().toISOString(),
          },
        }
      : capability
  ));
  return jsonResponse(request, env, {
    interfaceVersion: ARC_TESTNET_MANIFEST.interfaceVersion,
    network: ARC_NETWORK,
    capabilities: declaredCapabilities,
    safeSurface: {
      signs: false,
      createsSigners: false,
      broadcasts: false,
      canRead: true,
      canPrepare: true,
      canValidate: true,
      canVerify: true,
      canSign: false,
      canBroadcast: false,
      canRelay: false,
      canonicalRecords: "pact-declared-and-optional",
    },
    circleGasStation: circleGasStation.capability(),
    canonicalRecord: canonicalRecordCapabilityDeclaration(),
    runtime,
  });
}

async function handleInterface(request: Request, env: Env, pathname: string): Promise<Response> {
  for (const base of INTERFACE_ROUTE_BASES) {
    if (pathname === `${base}/capabilities`) return capabilities(request, env);
    if (pathname === `${base}/read` || pathname.startsWith(`${base}/read/`)) {
      const url = new URL(request.url);
      const readParts = pathname.slice(base.length).split("/").filter(Boolean);
      const type = decodeURIComponent(readParts[1] ?? url.searchParams.get("type") ?? "");
      const id = decodeURIComponent(readParts[2] ?? url.searchParams.get("id") ?? "");
      return readInterfaceObject(request, env, type, id);
    }
    if (pathname === `${base}/prepare` && request.method === "POST") {
      const body = await bodyRecord(request);
      const operationId = String(body.operationId ?? "");
      if (!operationId) throw new HttpError(400, "operationId is required");
      const context = body.context;
      if (!isSignedRuntimeTransitionOperation(operationId)
        && (!context || typeof context !== "object" || Array.isArray(context))) {
        throw new HttpError(400, "context is required");
      }
      const operation = createOperationRequest(operationId, body.data as never, context as never);
      return jsonResponse(request, env, { valid: true, broadcasted: false, request: operation });
    }
    if (pathname === `${base}/validate` && request.method === "POST") {
      const body = await bodyRecord(request);
      const operationId = String(body.operationId ?? "");
      const result = body.direction === "response"
        ? validateOperationResponse(operationId, body.envelope)
        : validateOperationRequest(operationId, body.envelope);
      return jsonResponse(request, env, result);
    }
    if (pathname === `${base}/verify` && request.method === "POST") {
      const body = await bodyRecord(request);
      let operation: ReturnType<typeof validateOperationResponse> | ReturnType<typeof validateOperationRequest> | undefined;
      if (body.operationId && body.envelope !== undefined) {
        operation = body.direction === "request"
          ? validateOperationRequest(String(body.operationId), body.envelope)
          : validateOperationResponse(String(body.operationId), body.envelope);
      }
      const policy = (body.policy ?? (
        body.pact && typeof body.pact === "object" ? (body.pact as Partial<Pact>).canonicalRecordPolicy : undefined
      )) as CanonicalRecordPolicy | undefined;
      let canonicalRecord: ReturnType<typeof verifyCanonicalRecord> | undefined;
      if (body.record !== undefined) canonicalRecord = verifyCanonicalRecord(body.record as CanonicalRecord, policy);
      else if (policy?.mode === "required") throw new HttpError(400, "Pact requires a Canonical Record");
      return jsonResponse(request, env, {
        valid: (operation?.valid ?? true) && (canonicalRecord?.valid ?? true),
        financialSuccess: false,
        operation,
        canonicalRecord,
        broadcasted: false,
      });
    }
  }
  return jsonResponse(request, env, { error: "Interface route not found" }, 404);
}

async function handleRuntime(request: Request, env: Env, pathname: string): Promise<Response> {
  if (!pathname.startsWith(RUNTIME_BASE)) return jsonResponse(request, env, { error: "Runtime route not found" }, 404);
  const knownPostRoutes = new Set([
    `${RUNTIME_BASE}/path`,
    `${RUNTIME_BASE}/execute`,
    `${RUNTIME_BASE}/discover`,
  ]);
  const knownGetRoutes = new Set([`${RUNTIME_BASE}/state`]);
  if ((knownPostRoutes.has(pathname) && request.method !== "POST") || (knownGetRoutes.has(pathname) && request.method !== "GET")) {
    const allow = knownPostRoutes.has(pathname) ? "POST, OPTIONS" : "GET, OPTIONS";
    throw new HttpError(405, `Use ${allow.split(",")[0]} for this Runtime route.`, allow);
  }
  assertRuntimeReady(env);
  if (pathname === `${RUNTIME_BASE}/discover`) return discoverRuntime(request, env);
  if (pathname === `${RUNTIME_BASE}/path` && request.method === "POST") {
    const body = await bodyRecord(request);
    const path = body.path;
    if (!path || typeof path !== "object" || Array.isArray(path)) throw new HttpError(400, "path object is required");
    return jsonResponse(request, env, { path: await withRuntime(env, (runtime) => runtime.ingestPath(path)) });
  }
  if (pathname === `${RUNTIME_BASE}/execute` && request.method === "POST") {
    const body = await bodyRecord(request);
    try {
      return jsonResponse(request, env, await withRuntime(env, (runtime) => runtime.execute(body)));
    } catch (error) {
      return errorResponse(request, env, error, { operationId: String(body.operationId ?? "runtime.execute"), body });
    }
  }
  if (pathname === `${RUNTIME_BASE}/state` && request.method === "GET") {
    assertRuntimeAdmin(request, env);
    return jsonResponse(request, env, await withRuntime(env, (runtime) => runtime.state()));
  }
  return jsonResponse(request, env, { error: "Runtime route not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/healthz") {
        return jsonResponse(request, env, { ok: true, service: "openrails-interface-worker", network: ARC_NETWORK, runtime: runtimeCapability(env) });
      }
      if (url.pathname.startsWith(RUNTIME_BASE)) return await handleRuntime(request, env, url.pathname);
      if (url.pathname.startsWith("/api/")) return await handleInterface(request, env, url.pathname);
      return jsonResponse(request, env, { error: "Not found" }, 404);
    } catch (error) {
      return errorResponse(request, env, error);
    }
  },
};
