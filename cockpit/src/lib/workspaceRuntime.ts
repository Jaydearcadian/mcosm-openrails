import {
  ARC_TESTNET_MANIFEST,
  hashRuntimePayload,
  type Actor,
  type Intent,
  type ObjectType,
  type Pact,
  type Path,
  type Proof,
  type Proposal,
  type Workspace,
} from "../../../sdk/src/shared-interface";
import type { OpenRailsAccount } from "../../../sdk/src/account";
import type { RuntimeAccountHandle } from "./runtimeAccount";
import { RuntimeClient, type RuntimeDiscoveryResponse } from "../../../sdk/src/runtime-client";

const NETWORK = {
  networkId: ARC_TESTNET_MANIFEST.networkId,
  chainId: ARC_TESTNET_MANIFEST.chainId,
};
const HUB = ARC_TESTNET_MANIFEST.runtime.anchorContract;
const ASSET = ARC_TESTNET_MANIFEST.settlementAssets[0];
const DEFAULT_INTERFACE_BASE = "https://openrails-interface-worker.microcosm.workers.dev";

export interface WorkspaceRuntimeState {
  workspace?: Workspace;
  actors: Record<string, Actor>;
  paths: Record<string, Path>;
  intents: Record<string, Intent>;
  proposals: Record<string, Proposal>;
  decisions: Record<string, Record<string, unknown>>;
  pacts: Record<string, Pact>;
  proofs: Record<string, Proof>;
  operations: Record<string, string>;
}

export interface WorkspaceRuntimeInput {
  workspace: Workspace;
  runtime?: WorkspaceRuntimeState;
}

export interface RuntimeOperationResult {
  state: string;
  data: Record<string, any>;
}

export interface WorkspaceRuntimeLifecycle {
  workspace: Workspace;
  ownerActor: Actor;
  actor?: Actor;
  path?: Path;
  intent?: Intent;
  proposal?: Proposal;
  decision?: Record<string, any>;
  pact?: Pact;
  proof?: Proof;
  operations: Record<string, string>;
}

export interface WorkspaceDiscoveryRecord {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  owner?: string;
  workspace: Workspace;
  runtime: WorkspaceRuntimeState;
}

export interface WorkspaceDiscoveryResponse {
  interfaceVersion: "1.2.0";
  operationId: "workspace.list" | "workspace.get";
  walletAddress: string;
  workspaces: WorkspaceDiscoveryRecord[];
}

function runtimeBaseUrl(): string | undefined {
  const value = (import.meta.env.VITE_OPENRAILS_INTERFACE_BASE as string | undefined)
    ?? (import.meta.env.VITE_OPENRAILS_API_BASE as string | undefined);
  const configured = value?.trim();
  if (configured) return configured;
  return import.meta.env.PROD ? DEFAULT_INTERFACE_BASE : undefined;
}

function client(): RuntimeClient {
  return new RuntimeClient({ baseUrl: runtimeBaseUrl() });
}

export async function discoverWorkspaces(
  handle: RuntimeAccountHandle,
  workspaceId?: string,
): Promise<WorkspaceDiscoveryResponse> {
  return client().discoverWorkspaces<RuntimeDiscoveryResponse>(handle.account, {
    role: "owner",
    ...(workspaceId ? { workspaceId } : {}),
  }) as Promise<WorkspaceDiscoveryResponse>;
}

function ref<T extends ObjectType>(type: T, id: string): { type: T; id: string } {
  return { type, id };
}

function nowAndExpiry(): { now: string; expiresAt: string } {
  const now = new Date();
  return {
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

function id(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 16)
    ?? Math.random().toString(16).slice(2, 18);
  return `${prefix}:${suffix}`;
}

function responseData(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") throw new Error("The runtime returned an invalid response.");
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The runtime response has no data payload.");
  return data as Record<string, any>;
}

function operationState(value: unknown): string {
  if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).lifecycleState !== "string") {
    throw new Error("The runtime response has no lifecycle state.");
  }
  return (value as Record<string, string>).lifecycleState;
}

function provenance(source: "wallet-signed" | "runtime-evaluation" = "wallet-signed", observedAt: string) {
  return {
    source,
    authority: "OpenRails cockpit",
    evidenceLevel: "runtime-observed" as const,
    observedAt,
  };
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function requireAddress(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed) || /^0x0{40}$/i.test(trimmed)) {
    throw new Error(`${label} must be a non-zero EVM wallet address.`);
  }
  return trimmed;
}

function parseUsdc(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) throw new Error("USDC amounts support up to six decimal places.");
  const [whole, fraction = ""] = trimmed.split(".");
  const baseUnits = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
  if (baseUnits <= 0n) throw new Error("The payment amount must be greater than zero.");
  return baseUnits.toString();
}

function actorKind(type: "Person" | "Party" | "Application" | "Agent"): Actor["kind"] {
  if (type === "Person") return "person";
  if (type === "Application") return "application";
  if (type === "Agent") return "agent";
  return "service";
}

function genericBinding(signer: string, issuedAt: string, expiresAt: string, signature = "0x") {
  const domain = ARC_TESTNET_MANIFEST.typedDataDomains.find((candidate) => (
    candidate.chainId === ARC_TESTNET_MANIFEST.chainId
    && candidate.verifyingContract.toLowerCase() === HUB.toLowerCase()
  ));
  if (!domain) throw new Error("Arc settlement signature domain is missing from the manifest.");
  return {
    signer,
    signature,
    nonce: "0",
    issuedAt,
    expiresAt,
    chainId: NETWORK.chainId,
    verifyingContract: HUB,
    domain,
  };
}

function ensureOwner(workspace: WorkspaceRuntimeInput, account: OpenRailsAccount): Promise<string> {
  return account.getAddress().then((address) => {
    const ownerId = workspace.workspace.ownerActorRef.id;
    const owner = workspace.runtime?.actors[ownerId];
    if (!owner?.walletAddress || !sameAddress(owner.walletAddress, address)) {
      throw new Error("Connect the Workspace owner wallet to authorize this operation.");
    }
    return address;
  });
}

function runtimeState(): WorkspaceRuntimeState {
  return {
    actors: {},
    paths: {},
    intents: {},
    proposals: {},
    decisions: {},
    pacts: {},
    proofs: {},
    operations: {},
  };
}

export async function registerWorkspace(name: string, owner: string, handle: RuntimeAccountHandle, workspaceId: string): Promise<WorkspaceRuntimeLifecycle> {
  const signer = await handle.account.getAddress();
  if (!sameAddress(signer, owner)) throw new Error("The connected wallet does not match the Workspace owner.");
  const { now } = nowAndExpiry();
  const ownerActor: Actor = {
    interfaceVersion: "1.2.0",
    id: `actor:owner:${workspaceId}`,
    kind: "person",
    displayName: "Workspace owner",
    authorityStatus: "VERIFIED",
    walletAddress: owner,
    createdAt: now,
    provenance: provenance("wallet-signed", now),
  };
  const workspace: Workspace = {
    interfaceVersion: "1.2.0",
    id: workspaceId,
    name: name.trim(),
    ownerActorRef: ref("Actor", ownerActor.id),
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    provenance: provenance("wallet-signed", now),
  };
  const workspaceRef = ref("Workspace", workspace.id);
  const runtime = client();
  const workspaceResponse = await runtime.execute("workspace.register", { workspace }, handle.account, { role: "owner" });
  const actorResponse = await runtime.execute("actor.register", { workspaceRef, actor: ownerActor }, handle.account, {
    role: "owner",
    workspaceRef,
  });
  return {
    workspace: responseData(workspaceResponse).workspace ?? workspace,
    ownerActor: responseData(actorResponse).actor ?? ownerActor,
    operations: {
      "workspace.register": operationState(workspaceResponse),
      "actor.register": operationState(actorResponse),
    },
  };
}

export async function registerActor(
  input: WorkspaceRuntimeInput & { name: string; type: "Person" | "Party" | "Application" | "Agent"; actorId: string; address?: string },
  handle: RuntimeAccountHandle,
): Promise<WorkspaceRuntimeLifecycle> {
  await ensureOwner(input, handle.account);
  const { now } = nowAndExpiry();
  const actor: Actor = {
    interfaceVersion: "1.2.0",
    id: input.actorId,
    kind: actorKind(input.type),
    displayName: input.name.trim(),
    authorityStatus: "VERIFIED",
    ...(input.address?.trim() ? { walletAddress: requireAddress(input.address, "Participant wallet") } : {}),
    createdAt: now,
    provenance: provenance("wallet-signed", now),
  };
  const workspaceRef = ref("Workspace", input.workspace.id);
  const response = await client().execute("actor.register", { workspaceRef, actor }, handle.account, {
    role: "owner",
    workspaceRef,
  });
  return {
    workspace: input.workspace,
    ownerActor: input.runtime?.actors[input.workspace.ownerActorRef.id] as Actor,
    actor: responseData(response).actor ?? actor,
    operations: { "actor.register": operationState(response) },
  };
}

export async function activatePath(
  input: WorkspaceRuntimeInput & { pathId: string; delegateId: string; capability: string; ceilingUsdc: string; expiresAt: string },
  handle: RuntimeAccountHandle,
): Promise<WorkspaceRuntimeLifecycle> {
  const signer = await ensureOwner(input, handle.account);
  const action = input.capability.trim() as Intent["action"];
  if (action !== "CREATE_RAILSFLOW") {
    throw new Error("This cockpit payment path currently authorizes CREATE_RAILSFLOW only.");
  }
  const ownerActor = input.runtime?.actors[input.workspace.ownerActorRef.id];
  const delegate = input.runtime?.actors[input.delegateId];
  if (!ownerActor || !delegate) throw new Error("Register the Workspace owner and delegate before activating a Path.");
  if (!delegate.walletAddress) throw new Error("The Path delegate needs a wallet address.");
  const { now } = nowAndExpiry();
  const expiresAt = new Date(input.expiresAt).toISOString();
  if (Date.parse(expiresAt) <= Date.parse(now)) throw new Error("Path expiry must be in the future.");
  const workspaceRef = ref("Workspace", input.workspace.id);
  const pathWithoutSignature = {
    interfaceVersion: "1.2.0" as const,
    id: input.pathId,
    executionProfile: "delegated-runtime" as const,
    workspaceRef,
    issuerActorRef: ref("Actor", ownerActor.id),
    delegateActorRef: ref("Actor", delegate.id),
    capabilities: [action],
    limits: [{
      asset: ASSET,
      maxAmount: parseUsdc(input.ceilingUsdc),
      maxAmountPerTransaction: parseUsdc(input.ceilingUsdc),
      maxTransactionsPerPeriod: "1",
      periodSeconds: "3600",
    }],
    status: "PREPARED" as const,
    provenance: provenance("wallet-signed", now),
  };
  const unsignedBinding = genericBinding(signer, now, expiresAt);
  const unsignedPath = { ...pathWithoutSignature, signatureBinding: unsignedBinding };
  const digest = hashRuntimePayload({
    purpose: "openrails-application-path-attestation-v1",
    path: unsignedPath,
  });
  const path: Path = {
    ...unsignedPath,
    signatureBinding: { ...unsignedBinding, signature: await handle.signMessage(digest) },
  };
  const runtime = client();
  const ingestedResponse = await runtime.ingestPath<{ path: Path }>(path);
  const ingestedPath = ingestedResponse.path;
  const response = await runtime.execute("path.activate", { path: ingestedPath }, handle.account, {
    role: "owner",
    workspaceRef,
    pathRef: ref("Path", path.id),
  });
  return {
    workspace: input.workspace,
    ownerActor,
    actor: delegate,
    path: responseData(response).path ?? ingestedPath,
    operations: { "path.activate": operationState(response) },
  };
}

export async function revokePath(input: WorkspaceRuntimeInput & { path: Path }, handle: RuntimeAccountHandle): Promise<WorkspaceRuntimeLifecycle> {
  await ensureOwner(input, handle.account);
  const workspaceRef = ref("Workspace", input.workspace.id);
  const response = await client().execute("path.revoke", { objectRef: ref("Path", input.path.id) }, handle.account, {
    role: "owner",
    workspaceRef,
    pathRef: ref("Path", input.path.id),
  });
  return {
    workspace: input.workspace,
    ownerActor: input.runtime?.actors[input.workspace.ownerActorRef.id] as Actor,
    path: responseData(response).path ?? input.path,
    operations: { "path.revoke": operationState(response) },
  };
}

export async function preparePact(
  input: WorkspaceRuntimeInput & { title: string; counterparty: string; amountUsdc: string; pactId: string },
  ownerHandle: RuntimeAccountHandle,
  delegateHandle: RuntimeAccountHandle = ownerHandle,
): Promise<WorkspaceRuntimeLifecycle> {
  await ensureOwner(input, ownerHandle.account);
  const activePath = Object.values(input.runtime?.paths ?? {}).find((path) => path.status === "ACTIVE");
  if (!activePath) throw new Error("Activate a Path before preparing a Pact.");
  const ownerActor = input.runtime?.actors[input.workspace.ownerActorRef.id];
  const delegate = input.runtime?.actors[activePath.delegateActorRef.id];
  if (!ownerActor || !delegate?.walletAddress) throw new Error("The active Path delegate is not available.");
  const signer = await delegateHandle.account.getAddress();
  if (!sameAddress(delegate.walletAddress, signer)) throw new Error("Connect the active Path participant wallet to sign the Pact.");
  const recipient = requireAddress(input.counterparty, "Counterparty");
  const amount = parseUsdc(input.amountUsdc);
  const { now, expiresAt } = nowAndExpiry();
  const workspaceRef = ref("Workspace", input.workspace.id);
  const pathRef = ref("Path", activePath.id);
  const intentRef = ref("Intent", id("intent"));
  const pactRef = ref("Pact", input.pactId);
  const paymentTerms = {
    asset: ASSET,
    amount,
    settlementShape: "one-time" as const,
    recipient,
  };
  const intent: Intent = {
    interfaceVersion: "1.2.0",
    id: intentRef.id,
    executionProfile: "delegated-runtime",
    subject: { actorRef: ref("Actor", delegate.id), role: "delegate" },
    action: "CREATE_RAILSFLOW",
    paymentTerms,
    requestedNetwork: NETWORK,
    workspaceRef,
    pathRef,
    pactRef,
    nonce: "0",
    expiresAt,
    status: "DRAFT",
    createdAt: now,
    provenance: provenance("wallet-signed", now),
  };
  const runtime = client();
  const intentResponse = await runtime.execute("intent.prepare", { intent }, ownerHandle.account, {
    role: "owner",
    workspaceRef,
    pathRef,
    intentRef,
  });
  const preparedIntent = responseData(intentResponse).intent as Intent;
  const proposal: Proposal = {
    interfaceVersion: "1.2.0",
    id: id("proposal"),
    executionProfile: "delegated-runtime",
    workspaceRef,
    pathRef,
    intentRef,
    normalizedTerms: paymentTerms,
    inputHash: hashRuntimePayload({ intent: preparedIntent, paymentTerms }),
    policyVersion: "baphomet-runtime-1.2.0",
    status: "EVALUATING",
    createdAt: now,
    provenance: provenance("runtime-evaluation", now),
  };
  const proposalRef = ref("Proposal", proposal.id);
  const proposalResponse = await runtime.execute("proposal.evaluate", { proposal }, delegateHandle.account, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef,
    proposalRef,
  });
  const decision = responseData(proposalResponse).decision as Record<string, any>;
  if (decision.decision !== "ALLOW") throw new Error(`Proposal blocked: ${(decision.reasonCodes ?? []).join(", ") || "policy"}.`);
  const decisionRef = ref("BaphometDecision", decision.id);
  const pact: Pact = {
    interfaceVersion: "1.2.0",
    id: pactRef.id,
    executionProfile: "delegated-runtime",
    workspaceRef,
    pathRef,
    proposalRef,
    decisionRef,
    parties: [ref("Actor", ownerActor.id), ref("Actor", delegate.id)],
    paymentTerms,
    proofPolicy: {
      interfaceVersion: "1.2.0",
      id: id("proof-policy"),
      executionProfile: "delegated-runtime",
      requiredGate: "FINAL_SETTLEMENT",
      beforeTransition: "SETTLEMENT",
      placement: "immediately-before",
      required: true,
      policyVersion: proposal.policyVersion ?? "baphomet-runtime-1.2.0",
      termsHash: hashRuntimePayload(paymentTerms),
    },
    status: "DRAFT",
    createdAt: now,
    signatureBinding: genericBinding(signer, now, expiresAt),
    provenance: provenance("wallet-signed", now),
  };
  const pactResponse = await runtime.execute("pact.sign", { intentRef, pact }, delegateHandle.account, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef,
    proposalRef,
    decisionRef,
    pactRef,
  });
  return {
    workspace: input.workspace,
    ownerActor,
    actor: delegate,
    intent: preparedIntent,
    proposal: responseData(proposalResponse).proposal ?? proposal,
    decision,
    pact: responseData(pactResponse).pact ?? pact,
    operations: {
      "intent.prepare": operationState(intentResponse),
      "proposal.evaluate": operationState(proposalResponse),
      "pact.sign": operationState(pactResponse),
    },
  };
}

export async function submitProof(
  input: WorkspaceRuntimeInput & { pact: Pact; intent: Intent; proposal: Proposal; description: string; reference: string; proofId: string },
  handle: RuntimeAccountHandle,
): Promise<WorkspaceRuntimeLifecycle> {
  const signer = await handle.account.getAddress();
  const pathId = input.pact.pathRef?.id;
  if (!pathId) throw new Error("The committed Pact is missing its Path reference.");
  const workspaceRef = ref("Workspace", input.workspace.id);
  const pathRef = ref("Path", pathId);
  const intentRef = ref("Intent", input.intent.id);
  const proposalRef = ref("Proposal", input.proposal.id);
  const pactRef = ref("Pact", input.pact.id);
  const subjectRef = input.pact.parties.find((party) => input.runtime?.actors[party.id]?.walletAddress && sameAddress(input.runtime.actors[party.id].walletAddress, signer));
  if (!subjectRef) throw new Error("Connect a Pact party wallet to submit Proof.");
  const { now } = nowAndExpiry();
  const proof: Proof = {
    interfaceVersion: "1.2.0",
    id: input.proofId,
    executionProfile: "delegated-runtime",
    workspaceRef,
    pathRef,
    intentRef,
    proposalRef,
    pactRef,
    policyRef: ref("ProofPolicy", input.pact.proofPolicy.id),
    subjectRef,
    gate: "FINAL_SETTLEMENT",
    beforeTransition: "SETTLEMENT",
    placement: "immediately-before",
    evidenceHash: hashRuntimePayload({ pactRef, description: input.description, reference: input.reference }),
    status: "SUBMITTED",
    submittedAt: now,
    provenance: provenance("wallet-signed", now),
  };
  const runtime = client();
  const submitResponse = await runtime.execute("proof.submit", { proof }, handle.account, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef,
    proposalRef,
    pactRef,
    proofRefs: [ref("Proof", proof.id)],
  });
  const verifyResponse = await runtime.execute("proof.verify", { objectRef: ref("Proof", proof.id) }, handle.account, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef,
    proposalRef,
    pactRef,
    proofRefs: [ref("Proof", proof.id)],
  });
  return {
    workspace: input.workspace,
    ownerActor: input.runtime?.actors[input.workspace.ownerActorRef.id] as Actor,
    proof: responseData(verifyResponse).proof ?? responseData(submitResponse).proof ?? proof,
    operations: {
      "proof.submit": operationState(submitResponse),
      "proof.verify": operationState(verifyResponse),
    },
  };
}

export function emptyWorkspaceRuntimeState(): WorkspaceRuntimeState {
  return runtimeState();
}
