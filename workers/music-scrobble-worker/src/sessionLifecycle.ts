export type SessionStatus = "funded" | "active" | "stopped" | "settled" | "failed";

export interface SessionRecord {
  sessionId: string;
  paycardId: string;
  listenerAddress: string;
  artistMbid: string;
  artistWallet: string;
  status: SessionStatus;
  budgetBaseUnits: string;
  velocityPerSecond: string;
  accruedBaseUnits: string;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
  stoppedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface StartSessionInput {
  sessionId: string;
  paycardId: string;
  listenerAddress: string;
  artistMbid: string;
  artistWallet: string;
  budgetBaseUnits: bigint;
  velocityPerSecond: bigint;
  timestamp: number;
}

export class SessionLifecycleError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "invalid_state"
      | "invalid_input"
      | "conflict",
  ) {
    super(message);
  }
}

function rowToRecord(row: Record<string, unknown>): SessionRecord {
  return {
    sessionId: String(row.session_id),
    paycardId: String(row.paycard_id),
    listenerAddress: String(row.listener_address),
    artistMbid: String(row.artist_mbid),
    artistWallet: String(row.artist_wallet),
    status: String(row.status) as SessionStatus,
    budgetBaseUnits: String(row.budget_base_units),
    velocityPerSecond: String(row.velocity_per_second),
    accruedBaseUnits: String(row.accrued_base_units),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    lastHeartbeatAt: row.last_heartbeat_at == null ? null : Number(row.last_heartbeat_at),
    stoppedAt: row.stopped_at == null ? null : Number(row.stopped_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getSession(db: D1Database, sessionId: string): Promise<SessionRecord | null> {
  const row = await db
    .prepare("SELECT * FROM playback_sessions WHERE session_id = ?")
    .bind(sessionId)
    .first<Record<string, unknown>>();
  return row ? rowToRecord(row) : null;
}

export async function startSession(db: D1Database, input: StartSessionInput): Promise<SessionRecord> {
  if (!input.sessionId || input.budgetBaseUnits <= 0n || input.velocityPerSecond <= 0n) {
    throw new SessionLifecycleError("Invalid session parameters", "invalid_input");
  }

  const existing = await getSession(db, input.sessionId);
  if (existing) {
    const sameIdentity =
      existing.paycardId.toLowerCase() === input.paycardId.toLowerCase() &&
      existing.listenerAddress.toLowerCase() === input.listenerAddress.toLowerCase() &&
      existing.artistWallet.toLowerCase() === input.artistWallet.toLowerCase();
    if (!sameIdentity) {
      throw new SessionLifecycleError("Session id already belongs to another payment", "conflict");
    }
    return existing;
  }

  await db.prepare(
    `INSERT INTO playback_sessions (
      session_id, paycard_id, listener_address, artist_mbid, artist_wallet,
      status, budget_base_units, velocity_per_second, accrued_base_units,
      started_at, last_heartbeat_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, '0', ?, ?, ?, ?)`,
  )
    .bind(
      input.sessionId,
      input.paycardId.toLowerCase(),
      input.listenerAddress.toLowerCase(),
      input.artistMbid,
      input.artistWallet.toLowerCase(),
      input.budgetBaseUnits.toString(),
      input.velocityPerSecond.toString(),
      input.timestamp,
      input.timestamp,
      input.timestamp,
      input.timestamp,
    )
    .run();

  return (await getSession(db, input.sessionId))!;
}

export async function heartbeatSession(
  db: D1Database,
  sessionId: string,
  timestamp: number,
): Promise<SessionRecord> {
  const session = await getSession(db, sessionId);
  if (!session) throw new SessionLifecycleError("Session not found", "not_found");
  if (session.status !== "active") {
    if (session.status === "stopped" || session.status === "settled") return session;
    throw new SessionLifecycleError(`Cannot heartbeat session in ${session.status}`, "invalid_state");
  }

  const previous = session.lastHeartbeatAt ?? session.startedAt ?? timestamp;
  if (timestamp <= previous) return session;

  const elapsed = BigInt(timestamp - previous);
  const accrued = BigInt(session.accruedBaseUnits);
  const budget = BigInt(session.budgetBaseUnits);
  const velocity = BigInt(session.velocityPerSecond);
  const nextAccrued = accrued + elapsed * velocity > budget ? budget : accrued + elapsed * velocity;

  await db.prepare(
    "UPDATE playback_sessions SET accrued_base_units = ?, last_heartbeat_at = ?, updated_at = ? WHERE session_id = ? AND status = 'active'",
  )
    .bind(nextAccrued.toString(), timestamp, timestamp, sessionId)
    .run();

  return (await getSession(db, sessionId))!;
}

export async function stopSession(
  db: D1Database,
  sessionId: string,
  timestamp: number,
): Promise<SessionRecord> {
  const afterHeartbeat = await heartbeatSession(db, sessionId, timestamp);
  if (afterHeartbeat.status === "stopped" || afterHeartbeat.status === "settled") return afterHeartbeat;

  await db.prepare(
    "UPDATE playback_sessions SET status = 'stopped', stopped_at = ?, updated_at = ? WHERE session_id = ? AND status = 'active'",
  )
    .bind(timestamp, timestamp, sessionId)
    .run();

  return (await getSession(db, sessionId))!;
}
