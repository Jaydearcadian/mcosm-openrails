import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace } from "../../../sdk/src/shared-interface";
import type { RuntimeAccountHandle } from "./runtimeAccount";
import {
  activatePath,
  discoverWorkspaces,
  emptyWorkspaceRuntimeState,
  preparePact,
  registerActor,
  registerWorkspace,
  revokePath as revokeRuntimePath,
  submitProof,
  type WorkspaceRuntimeState,
} from "./workspaceRuntime";
import type { WorkspaceDiscoveryRecord } from "./workspaceRuntime";

export type WorkspaceActorType = "Person" | "Party" | "Application" | "Agent";

export interface WorkspaceActor {
  id: string;
  name: string;
  type: WorkspaceActorType;
  address?: string;
  state: "Recorded";
  createdAt: string;
}

export interface WorkspacePath {
  id: string;
  delegateId: string;
  capability: string;
  ceilingUsdc: string;
  expiresAt: string;
  state: "Draft" | "Recorded" | "Active" | "Revoked";
  createdAt: string;
}

export interface WorkspacePact {
  id: string;
  title: string;
  counterparty: string;
  amountUsdc: string;
  state: "Awaiting acceptance" | "Recorded" | "Committed";
  createdAt: string;
}

export interface WorkspaceProof {
  id: string;
  pactId: string;
  description: string;
  reference: string;
  state: "Proof submitted" | "Verified";
  createdAt: string;
}

export interface WorkspacePayment {
  paycardId: string;
  state: "Receipt confirmed";
  createdAt: string;
}

export interface WorkspaceActivity {
  id: string;
  label: string;
  detail: string;
  state: string;
  financialEffect: "No value moved" | "Value movement possible";
  createdAt: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  owner: string;
  objectState: "Draft" | "Prepared" | "Active" | "Committed" | "Verified" | "Revoked";
  persistence: "runtime-backed" | "browser-recorded";
  createdAt: string;
  actors: WorkspaceActor[];
  paths: WorkspacePath[];
  pacts: WorkspacePact[];
  proofs: WorkspaceProof[];
  payments: WorkspacePayment[];
  activity: WorkspaceActivity[];
  runtime?: WorkspaceRuntimeState;
}

const STORAGE_KEY = "openrails.cockpit.workspaces.v1";

function id(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10)
    ?? Math.random().toString(16).slice(2, 12);
  return `${prefix}-${random.toUpperCase()}`;
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function activity(label: string, detail: string, state: string, financialEffect: WorkspaceActivity["financialEffect"] = "No value moved"): WorkspaceActivity {
  return {
    id: id("ACT"),
    label,
    detail,
    state,
    financialEffect,
    createdAt: new Date().toISOString(),
  };
}

function normaliseStored(value: unknown): WorkspaceRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<WorkspaceRecord>;
  if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.owner !== "string") return null;
  return {
    id: record.id,
    name: record.name,
    owner: record.owner,
    objectState: record.objectState ?? "Draft",
    persistence: record.persistence ?? "browser-recorded",
    createdAt: record.createdAt ?? new Date().toISOString(),
    actors: Array.isArray(record.actors) ? record.actors : [],
    paths: Array.isArray(record.paths) ? record.paths : [],
    pacts: Array.isArray(record.pacts) ? record.pacts : [],
    proofs: Array.isArray(record.proofs) ? record.proofs : [],
    payments: Array.isArray(record.payments) ? record.payments : [],
    activity: Array.isArray(record.activity) ? record.activity : [],
    runtime: record.runtime,
  };
}

function readStored(): WorkspaceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.map(normaliseStored).filter((record): record is WorkspaceRecord => record !== null)
      : [];
  } catch {
    return [];
  }
}

function runtimeInput(workspace: WorkspaceRecord): { workspace: Workspace; runtime: WorkspaceRuntimeState } {
  if (!workspace.runtime?.workspace) throw new Error("This Workspace has no runtime record. Initialize a new Workspace to use signed operations.");
  return { workspace: workspace.runtime.workspace, runtime: workspace.runtime };
}

export type WorkspaceRuntimeStatus = "idle" | "loading" | "ready" | "error";

function actorType(kind: string): WorkspaceActorType {
  if (kind === "agent") return "Agent";
  if (kind === "application" || kind === "sidecar") return "Application";
  if (kind === "service") return "Party";
  return "Person";
}

function usdcAmount(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return "0";
  const base = BigInt(value);
  const whole = base / 1_000_000n;
  const fraction = (base % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function remoteWorkspaceRecord(remote: WorkspaceDiscoveryRecord, local?: WorkspaceRecord): WorkspaceRecord {
  const runtime = remote.runtime;
  const workspace = remote.workspace;
  const actors = Object.values(runtime.actors).map((actor) => ({
    id: actor.id,
    name: actor.displayName,
    type: actorType(actor.kind),
    address: actor.walletAddress,
    state: "Recorded" as const,
    createdAt: actor.createdAt,
  }));
  const paths = Object.values(runtime.paths).map((path) => ({
    id: path.id,
    delegateId: path.delegateActorRef.id,
    capability: path.capabilities[0] ?? "CREATE_RAILSFLOW",
    ceilingUsdc: usdcAmount(path.limits[0]?.maxAmount),
    expiresAt: path.signatureBinding.expiresAt,
    state: path.status === "ACTIVE" ? "Active" as const : path.status === "REVOKED" ? "Revoked" as const : "Draft" as const,
    createdAt: path.provenance.observedAt,
  }));
  const pacts = Object.values(runtime.pacts).map((pact) => ({
    id: pact.id,
    title: `${pact.paymentTerms.settlementShape} payment`,
    counterparty: pact.paymentTerms.recipient ?? pact.parties[0]?.id ?? "Pact party",
    amountUsdc: usdcAmount(pact.paymentTerms.amount),
    state: pact.status === "ACTIVE" ? "Committed" as const : "Awaiting acceptance" as const,
    createdAt: pact.createdAt,
  }));
  const proofs = Object.values(runtime.proofs).map((proof) => ({
    id: proof.id,
    pactId: proof.pactRef?.id ?? "",
    description: `${proof.gate} proof`,
    reference: proof.evidenceHash,
    state: proof.status === "VERIFIED" ? "Verified" as const : "Proof submitted" as const,
    createdAt: proof.submittedAt,
  }));
  const objectState: WorkspaceRecord["objectState"] = proofs.some((proof) => proof.state === "Verified")
    ? "Verified"
    : pacts.some((pact) => pact.state === "Committed")
      ? "Committed"
      : paths.some((path) => path.state === "Active")
        ? "Active"
        : "Prepared";
  const owner = remote.owner
    ?? runtime.actors[workspace.ownerActorRef.id]?.walletAddress
    ?? local?.owner
    ?? "";
  return {
    id: workspace.id,
    name: workspace.name,
    owner,
    objectState,
    persistence: "runtime-backed",
    createdAt: workspace.createdAt,
    actors,
    paths,
    pacts,
    proofs,
    payments: local?.payments ?? [],
    activity: local?.activity ?? [],
    runtime,
  };
}

function mergeRuntime(workspace: WorkspaceRecord, patch: Partial<WorkspaceRuntimeState>, operations: Record<string, string>): WorkspaceRuntimeState {
  const current = workspace.runtime ?? emptyWorkspaceRuntimeState();
  return {
    ...current,
    ...patch,
    actors: { ...current.actors, ...(patch.actors ?? {}) },
    paths: { ...current.paths, ...(patch.paths ?? {}) },
    intents: { ...current.intents, ...(patch.intents ?? {}) },
    proposals: { ...current.proposals, ...(patch.proposals ?? {}) },
    decisions: { ...current.decisions, ...(patch.decisions ?? {}) },
    pacts: { ...current.pacts, ...(patch.pacts ?? {}) },
    proofs: { ...current.proofs, ...(patch.proofs ?? {}) },
    operations: { ...current.operations, ...operations },
  };
}

export function useWorkspaceRecords(handle?: RuntimeAccountHandle) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>(readStored);
  const [selectedId, setSelectedId] = useState<string>(() => readStored()[0]?.id ?? "");
  const [runtimeStatus, setRuntimeStatus] = useState<WorkspaceRuntimeStatus>("idle");
  const [runtimeError, setRuntimeError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!handle) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
  }, [handle, workspaces]);

  const refresh = useCallback(async () => {
    if (!handle) {
      setWorkspaces([]);
      setSelectedId("");
      setRuntimeStatus("idle");
      setRuntimeError(undefined);
      return;
    }
    setRefreshing(true);
    setRuntimeStatus("loading");
    setRuntimeError(undefined);
    try {
      const walletAddress = await handle.account.getAddress();
      const response = await discoverWorkspaces(handle);
      setWorkspaces((current) => {
        const localRecords = [...readStored(), ...current]
          .filter((record, index, records) => records.findIndex((candidate) => candidate.id === record.id) === index)
          .filter((record) => sameAddress(record.owner, walletAddress));
        const localById = new Map(localRecords.map((record) => [record.id, record]));
        const discovered = response.workspaces.map((record) => remoteWorkspaceRecord(record, localById.get(record.id)));
        const discoveredIds = new Set(discovered.map((record) => record.id));
        return [...discovered, ...localRecords.filter((record) => !discoveredIds.has(record.id))];
      });
      setSelectedId((current) => current || response.workspaces[0]?.id || "");
      setRuntimeStatus("ready");
    } catch (error) {
      const walletAddress = await handle.account.getAddress().catch(() => "");
      if (walletAddress) {
        setWorkspaces((current) => current.length
          ? current
          : readStored().filter((record) => sameAddress(record.owner, walletAddress)));
      }
      setRuntimeStatus("error");
      setRuntimeError(error instanceof Error ? error.message : "Workspace Runtime discovery failed.");
    } finally {
      setRefreshing(false);
    }
  }, [handle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId && !workspaces.some((workspace) => workspace.id === selectedId)) {
      setSelectedId(workspaces[0]?.id ?? "");
    }
  }, [selectedId, workspaces]);

  const selected = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [selectedId, workspaces],
  );

  const replaceSelected = useCallback((replacement: WorkspaceRecord) => {
    setWorkspaces((current) => current.map((workspace) => workspace.id === replacement.id ? replacement : workspace));
  }, []);

  const requireHandle = useCallback((): RuntimeAccountHandle => {
    if (!handle) throw new Error("Connect a Privy wallet before using signed Workspace operations.");
    return handle;
  }, [handle]);

  const initialize = useCallback(async (name: string, owner: string) => {
    const runtimeHandle = requireHandle();
    const workspaceId = id("WS");
    const result = await registerWorkspace(name.trim(), owner, runtimeHandle, workspaceId);
    const now = new Date().toISOString();
    const workspace: WorkspaceRecord = {
      id: workspaceId,
      name: name.trim(),
      owner,
      objectState: "Prepared",
      persistence: "runtime-backed",
      createdAt: now,
      actors: [{
        id: result.ownerActor.id,
        name: result.ownerActor.displayName,
        type: "Person",
        address: result.ownerActor.walletAddress,
        state: "Recorded",
        createdAt: result.ownerActor.createdAt,
      }],
      paths: [],
      pacts: [],
      proofs: [],
      payments: [],
      activity: [activity("Workspace prepared", "Signed Workspace and owner Actor records accepted by the Runtime.", "PREPARED")],
      runtime: {
        ...emptyWorkspaceRuntimeState(),
        workspace: result.workspace,
        actors: { [result.ownerActor.id]: result.ownerActor },
        operations: result.operations,
      },
    };
    setWorkspaces((current) => [...current, workspace]);
    setSelectedId(workspace.id);
    return workspace;
  }, [requireHandle]);

  const addActor = useCallback(async (input: { name: string; type: WorkspaceActorType; address?: string }) => {
    const workspace = selected;
    if (!workspace) throw new Error("Select or initialize a Workspace first.");
    const runtimeHandle = requireHandle();
    const remote = await registerActor({
      ...runtimeInput(workspace),
      name: input.name,
      type: input.type,
      address: input.address,
      actorId: id("ACTOR"),
    }, runtimeHandle);
    if (!remote.actor) throw new Error("The Runtime did not return the registered Actor.");
    const actor = remote.actor;
    const next = {
      ...workspace,
      actors: [...workspace.actors, {
        id: actor.id,
        name: actor.displayName,
        type: input.type,
        address: actor.walletAddress,
        state: "Recorded" as const,
        createdAt: actor.createdAt,
      }],
      objectState: "Prepared" as const,
      activity: [activity(`${input.type} recorded`, `${actor.displayName} accepted by the Runtime.`, "PREPARED"), ...workspace.activity],
      runtime: mergeRuntime(workspace, { actors: { [actor.id]: actor } }, remote.operations),
    };
    replaceSelected(next);
    return actor;
  }, [requireHandle, replaceSelected, selected]);

  const addPath = useCallback(async (input: Omit<WorkspacePath, "id" | "state" | "createdAt">) => {
    const workspace = selected;
    if (!workspace) throw new Error("Select or initialize a Workspace first.");
    const runtimeHandle = requireHandle();
    const pathId = id("PATH");
    const remote = await activatePath({ ...runtimeInput(workspace), ...input, pathId }, runtimeHandle);
    if (!remote.path) throw new Error("The Runtime did not return the activated Path.");
    const path = remote.path;
    const next = {
      ...workspace,
      objectState: "Active" as const,
      paths: [...workspace.paths, {
        id: path.id,
        delegateId: input.delegateId,
        capability: input.capability,
        ceilingUsdc: input.ceilingUsdc,
        expiresAt: input.expiresAt,
        state: "Active" as const,
        createdAt: new Date().toISOString(),
      }],
      activity: [activity("Path activated", `${input.capability}, ceiling ${input.ceilingUsdc} USDC.`, "COMMITTED"), ...workspace.activity],
      runtime: mergeRuntime(workspace, { paths: { [path.id]: path } }, remote.operations),
    };
    replaceSelected(next);
    return path;
  }, [requireHandle, replaceSelected, selected]);

  const revokePath = useCallback(async (pathId: string) => {
    const workspace = selected;
    if (!workspace) throw new Error("Select or initialize a Workspace first.");
    const path = workspace.runtime?.paths[pathId];
    if (!path) throw new Error("This Path is not backed by the Runtime.");
    const remote = await revokeRuntimePath({ ...runtimeInput(workspace), path }, requireHandle());
    const next = {
      ...workspace,
      objectState: "Revoked" as const,
      paths: workspace.paths.map((candidate) => candidate.id === pathId ? { ...candidate, state: "Revoked" as const } : candidate),
      activity: [activity("Path revoked", `${pathId} is no longer active.`, "CANCELLED"), ...workspace.activity],
      runtime: mergeRuntime(workspace, { paths: { [pathId]: remote.path ?? path } }, remote.operations),
    };
    replaceSelected(next);
  }, [requireHandle, replaceSelected, selected]);

  const addPact = useCallback(async (
    input: Omit<WorkspacePact, "id" | "state" | "createdAt">,
    delegateHandle?: RuntimeAccountHandle,
  ) => {
    const workspace = selected;
    if (!workspace) throw new Error("Select or initialize a Workspace first.");
    const pactId = id("PACT");
    const remote = await preparePact({ ...runtimeInput(workspace), ...input, pactId }, requireHandle(), delegateHandle);
    if (!remote.pact || !remote.intent || !remote.proposal || !remote.decision) throw new Error("The Runtime did not return the Pact lifecycle records.");
    const pact = remote.pact;
    const next = {
      ...workspace,
      objectState: "Committed" as const,
      pacts: [...workspace.pacts, {
        id: pact.id,
        title: input.title,
        counterparty: input.counterparty,
        amountUsdc: input.amountUsdc,
        state: "Committed" as const,
        createdAt: pact.createdAt,
      }],
      activity: [activity("Pact committed", `${input.title} passed Path policy and was accepted.`, "COMMITTED"), ...workspace.activity],
      runtime: mergeRuntime(workspace, {
        intents: { [remote.intent.id]: remote.intent },
        proposals: { [remote.proposal.id]: remote.proposal },
        decisions: { [remote.decision.id]: remote.decision },
        pacts: { [pact.id]: pact },
      }, remote.operations),
    };
    replaceSelected(next);
    return pact;
  }, [requireHandle, replaceSelected, selected]);

  const addProof = useCallback(async (input: Omit<WorkspaceProof, "id" | "state" | "createdAt">) => {
    const workspace = selected;
    if (!workspace) throw new Error("Select or initialize a Workspace first.");
    const runtime = workspace.runtime;
    if (!runtime) throw new Error("This Workspace has no runtime records. Initialize a new Workspace to use signed operations.");
    const pact = runtime?.pacts[input.pactId];
    const intent = pact?.proposalRef ? Object.values(runtime.intents).find((candidate) => candidate.pactRef?.id === pact.id) : undefined;
    const proposal = pact?.proposalRef ? runtime.proposals[pact.proposalRef.id] : undefined;
    if (!pact || !intent || !proposal) throw new Error("Prepare and commit a Pact before submitting Proof.");
    const proofId = id("PROOF");
    const remote = await submitProof({ ...runtimeInput(workspace), pact, intent, proposal, ...input, proofId }, requireHandle());
    if (!remote.proof) throw new Error("The Runtime did not return verified Proof.");
    const proof = remote.proof;
    const next = {
      ...workspace,
      objectState: "Verified" as const,
      proofs: [...workspace.proofs, {
        id: proof.id,
        pactId: input.pactId,
        description: input.description,
        reference: input.reference,
        state: "Verified" as const,
        createdAt: proof.submittedAt,
      }],
      activity: [activity("Proof verified", `${input.description} is bound to the committed Pact.`, "PROOF_VERIFIED"), ...workspace.activity],
      runtime: mergeRuntime(workspace, { proofs: { [proof.id]: proof } }, remote.operations),
    };
    replaceSelected(next);
    return proof;
  }, [requireHandle, replaceSelected, selected]);

  const recordPayment = useCallback((paycardId: string) => {
    const workspace = selected;
    if (!workspace) throw new Error("Select a Workspace before recording a Workspace-scoped payment.");
    if (workspace.payments.some((payment) => payment.paycardId === paycardId)) return;
    const now = new Date().toISOString();
    replaceSelected({
      ...workspace,
      payments: [...workspace.payments, { paycardId, state: "Receipt confirmed", createdAt: now }],
      objectState: "Committed",
      activity: [activity("Payment receipt confirmed", `${paycardId} was submitted with this Workspace as its operating context.`, "RECEIPTED", "Value movement possible"), ...workspace.activity],
    });
  }, [replaceSelected, selected]);

  return {
    workspaces: handle ? workspaces : [],
    selected: handle ? selected : null,
    selectedId,
    select: setSelectedId,
    initialize,
    addActor,
    addPath,
    revokePath,
    addPact,
    addProof,
    recordPayment,
    runtimeStatus,
    runtimeError,
    refreshing,
    refresh,
  };
}
