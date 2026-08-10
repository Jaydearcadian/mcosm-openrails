import type {
  Actor,
  BaphometDecision,
  CanonicalRecord,
  Intent,
  OperationRequest,
  OperationResponse,
  Pact,
  Path,
  Proof,
  Proposal,
  Provenance,
  RuntimeSignatureBinding,
  Workspace,
} from "@openrails/shared-interface";

import type { ArcReadProvider } from "./provider.js";

export const RUNTIME_OPERATION_IDS = [
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
] as const;

export type RuntimeOperationId = typeof RUNTIME_OPERATION_IDS[number];

export interface RuntimeState {
  version: "openrails-runtime-state-1.2.0";
  workspaces: Record<string, Workspace>;
  workspaceAuthorities: Record<string, string>;
  actors: Record<string, Actor>;
  paths: Record<string, Path>;
  pathAttestations: Record<string, StoredPathAttestation>;
  intents: Record<string, Intent>;
  proposals: Record<string, Proposal>;
  decisions: Record<string, BaphometDecision>;
  pacts: Record<string, Pact>;
  proofs: Record<string, Proof>;
  canonicalRecords: Record<string, CanonicalRecord>;
  committedPacts: Record<string, string>;
  pathPeriodUsage: Record<string, PathPeriodUsage>;
}

export interface StoredPathAttestation {
  path: Path;
  provenance: Provenance;
}

export interface PathAttestor {
  attest(path: Path): Promise<Provenance> | Provenance;
}

export interface PathPeriodUsage {
  pathId: string;
  assetKey: string;
  limitIndex: number;
  periodSeconds: string;
  bucketStartSeconds: string;
  transactionCount: string;
  amount: string;
}

export interface ReplayScope {
  domainSalt: string;
  chainId: string;
  anchorContract: string;
  signer: string;
  nonce: string;
}

export interface RuntimeTransaction {
  readonly state: RuntimeState;
  consumeReplayNonce(scope: ReplayScope): Promise<void>;
}

export interface RuntimeStore {
  snapshot(): Promise<RuntimeState>;
  transact<T>(operation: (transaction: RuntimeTransaction) => Promise<T> | T): Promise<T>;
}

export interface RuntimeOptions {
  store?: RuntimeStore;
  provider?: ArcReadProvider;
  pathAttestor?: PathAttestor;
  now?: () => Date;
  maxSignatureLifetimeSeconds?: number;
  clockSkewSeconds?: number;
}

export type RuntimeRequest = OperationRequest;
export type RuntimeResponse = OperationResponse;
export type RuntimeBinding = RuntimeSignatureBinding;
