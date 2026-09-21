import type { StudioStore } from "../../../../src/studio/contracts";
import { InMemoryStudioStore, PostgresStudioStore } from "../../../../src/studio/infrastructure";
import type { PgPool } from "../../../../src/memory/infrastructure";
import { createPostgresPool, type ManagedPool } from "../infrastructure/postgresPool";

export interface StudioComposition {
  store?: StudioStore;
  pool?: PgPool & { end(): Promise<void> };
  mode: "postgres" | "in-memory" | "disabled";
  close(): Promise<void>;
}

/** No migrations at startup; durable storage never silently falls back to a Map. */
export function createStudioComposition(): StudioComposition {
  const connectionString = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  const mode = (process.env.STUDIO_STORE ?? (connectionString ? "postgres" : "in-memory")) as StudioComposition["mode"];
  if (mode === "disabled") return { mode, close: async () => {} };
  if (!["postgres", "in-memory"].includes(mode)) throw new Error("Invalid STUDIO_STORE mode.");
  if (mode === "postgres" && !connectionString) throw new Error("MEMORY_DATABASE_URL (or STUDIO_DATABASE_URL) is required for PostgreSQL studio persistence.");
  if (mode === "in-memory" && process.env.NODE_ENV === "production") throw new Error("Volatile studio storage is not supported in production.");

  let pool: ManagedPool | undefined;
  if (mode === "postgres") {
    pool = createPostgresPool(connectionString!, { statementTimeoutMs: 10000 });
  }
  const store = pool ? new PostgresStudioStore(pool) : new InMemoryStudioStore();
  return { store, pool, mode, close: async () => { await pool?.end(); } };
}
