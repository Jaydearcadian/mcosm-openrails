import { Pool } from "@neondatabase/serverless";
import type {
  PostgresQueryResult,
  PostgresRuntimeClient,
  PostgresRuntimeExecutor,
} from "@openrails/runtime";

export interface NeonRuntimeExecutor extends PostgresRuntimeExecutor {
  close(): Promise<void>;
}

function result(value: { rows?: unknown[]; rowCount?: number | null }): PostgresQueryResult {
  return {
    rows: (value.rows ?? []) as Array<Record<string, unknown>>,
    rowCount: value.rowCount ?? undefined,
  };
}

/**
 * Adapt Neon's Worker-compatible WebSocket pool to the runtime's narrow query
 * boundary. A fresh pool is created per request and closed by the handler.
 */
export function createNeonRuntimeExecutor(connectionString: string): NeonRuntimeExecutor {
  if (!/^postgres(?:ql)?:/i.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  return {
    async query(text, values) {
      return result(await pool.query(text, values));
    },
    async connect(): Promise<PostgresRuntimeClient> {
      const client = await pool.connect();
      return {
        async query(text, values) {
          return result(await client.query(text, values));
        },
        release() {
          client.release();
        },
      };
    },
    async close() {
      await pool.end();
    },
  };
}
