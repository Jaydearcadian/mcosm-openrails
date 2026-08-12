import canonicalize from "canonicalize";

import { RuntimeError } from "./errors.js";
import type { PathPeriodUsage, ReplayScope, RuntimeState, RuntimeStore, RuntimeTransaction } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function emptyRuntimeState(): RuntimeState {
  return {
    version: "openrails-runtime-state-1.2.0",
    workspaces: {},
    workspaceAuthorities: {},
    actors: {},
    actorWorkspaces: {},
    paths: {},
    pathAttestations: {},
    intents: {},
    proposals: {},
    decisions: {},
    pacts: {},
    proofs: {},
    canonicalRecords: {},
    committedPacts: {},
    pathPeriodUsage: {}
  };
}

export function pathPeriodUsageKey(usage: Omit<PathPeriodUsage, "transactionCount" | "amount">): string {
  const key = canonicalize(usage);
  if (typeof key !== "string") throw new RuntimeError("STATE_STALE", "Path period usage key is not canonicalizable.");
  return key;
}

function normalizePathPeriodUsage(value: Record<string, PathPeriodUsage> | undefined): Record<string, PathPeriodUsage> {
  const normalized: Record<string, PathPeriodUsage> = {};
  for (const [key, usage] of Object.entries(value ?? {})) {
    if (
      typeof usage !== "object"
      || usage === null
      || typeof usage.pathId !== "string"
      || typeof usage.assetKey !== "string"
      || !Number.isSafeInteger(usage.limitIndex)
      || usage.limitIndex < 0
      || !/^[1-9][0-9]*$/.test(usage.periodSeconds)
      || !/^(0|[1-9][0-9]*)$/.test(usage.bucketStartSeconds)
      || !/^(0|[1-9][0-9]*)$/.test(usage.transactionCount)
      || !/^(0|[1-9][0-9]*)$/.test(usage.amount)
    ) {
      throw new RuntimeError("STATE_STALE", "Path period usage state is malformed.");
    }
    const expectedKey = pathPeriodUsageKey({
      pathId: usage.pathId,
      assetKey: usage.assetKey,
      limitIndex: usage.limitIndex,
      periodSeconds: usage.periodSeconds,
      bucketStartSeconds: usage.bucketStartSeconds
    });
    if (key !== expectedKey) throw new RuntimeError("STATE_STALE", "Path period usage state has a non-canonical key.");
    normalized[key] = { ...usage };
  }
  return normalized;
}

export function normalizeRuntimeState(state: RuntimeState): RuntimeState {
  if (state.version !== "openrails-runtime-state-1.2.0") throw new Error("Unsupported OpenRails Runtime state version.");
  return {
    ...emptyRuntimeState(),
    ...state,
    workspaceAuthorities: state.workspaceAuthorities ?? {},
    actorWorkspaces: state.actorWorkspaces ?? {},
    pathAttestations: state.pathAttestations ?? {},
    proofs: state.proofs ?? {},
    canonicalRecords: state.canonicalRecords ?? {},
    committedPacts: state.committedPacts ?? {},
    pathPeriodUsage: normalizePathPeriodUsage(state.pathPeriodUsage)
  };
}

function replayValues(scope: ReplayScope): string[] {
  return [
    scope.domainSalt.toLowerCase(),
    scope.chainId,
    scope.anchorContract.toLowerCase(),
    scope.signer.toLowerCase(),
    scope.nonce
  ];
}

export function replayScopeKey(scope: ReplayScope): string {
  return replayValues(scope).join(":");
}

abstract class SerializedRuntimeStore implements RuntimeStore {
  private mutationTail: Promise<void> = Promise.resolve();

  abstract snapshot(): Promise<RuntimeState>;

  protected abstract transactSerialized<T>(operation: (transaction: RuntimeTransaction) => Promise<T> | T): Promise<T>;

  async transact<T>(operation: (transaction: RuntimeTransaction) => Promise<T> | T): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.transactSerialized(operation);
    } finally {
      release();
    }
  }
}

export class MemoryRuntimeStore extends SerializedRuntimeStore {
  private state: RuntimeState;
  private replayNonces = new Set<string>();

  constructor(initial: RuntimeState = emptyRuntimeState()) {
    super();
    this.state = normalizeRuntimeState(clone(initial));
  }

  async snapshot(): Promise<RuntimeState> {
    return clone(this.state);
  }

  protected async transactSerialized<T>(operation: (transaction: RuntimeTransaction) => Promise<T> | T): Promise<T> {
    const draft = clone(this.state);
    const replayDraft = new Set(this.replayNonces);
    const transaction: RuntimeTransaction = {
      state: draft,
      consumeReplayNonce: async (scope) => {
        const key = replayScopeKey(scope);
        if (replayDraft.has(key)) throw new RuntimeError("NONCE_CONFLICT", "The runtime transition nonce has already been consumed.");
        replayDraft.add(key);
      }
    };
    const result = await operation(transaction);
    this.state = draft;
    this.replayNonces = replayDraft;
    return clone(result);
  }
}

export interface PostgresQueryResult {
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
}

export interface PostgresRuntimeClient {
  query(text: string, values?: unknown[]): Promise<PostgresQueryResult>;
  release(): void;
}

export interface PostgresRuntimeExecutor {
  query(text: string, values?: unknown[]): Promise<PostgresQueryResult>;
  connect(): Promise<PostgresRuntimeClient>;
}

function stateFromRow(row: Record<string, unknown> | undefined): RuntimeState {
  if (!row) return emptyRuntimeState();
  const raw = row.state_json;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return normalizeRuntimeState(parsed as RuntimeState);
}

export class PostgresRuntimeStore implements RuntimeStore {
  constructor(private readonly db: PostgresRuntimeExecutor) {}

  async snapshot(): Promise<RuntimeState> {
    const result = await this.db.query("SELECT state_json FROM openrails_runtime_state WHERE singleton=true");
    return clone(stateFromRow(result.rows?.[0]));
  }

  async transact<T>(operation: (transaction: RuntimeTransaction) => Promise<T> | T): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO openrails_runtime_state(singleton, state_json)
         VALUES(true, $1::jsonb)
         ON CONFLICT(singleton) DO NOTHING`,
        [JSON.stringify(emptyRuntimeState())]
      );
      const current = await client.query("SELECT state_json FROM openrails_runtime_state WHERE singleton=true FOR UPDATE");
      const draft = stateFromRow(current.rows?.[0]);
      const transaction: RuntimeTransaction = {
        state: draft,
        consumeReplayNonce: async (scope) => {
          const [domainSalt, chainId, anchorContract, signer, nonce] = replayValues(scope);
          const result = await client.query(
            `INSERT INTO openrails_runtime_replay_nonces(domain_salt, chain_id, anchor_contract, signer, nonce)
             VALUES($1, $2, $3, $4, $5)
             ON CONFLICT(domain_salt, chain_id, anchor_contract, signer, nonce) DO NOTHING
             RETURNING nonce`,
            [domainSalt, chainId, anchorContract, signer, nonce]
          );
          if (!result.rows || result.rows.length !== 1) {
            throw new RuntimeError("NONCE_CONFLICT", "The runtime transition nonce has already been consumed.");
          }
        }
      };
      const result = await operation(transaction);
      await client.query(
        "UPDATE openrails_runtime_state SET state_json=$1::jsonb, updated_at=now() WHERE singleton=true",
        [JSON.stringify(draft)]
      );
      await client.query("COMMIT");
      return clone(result);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
