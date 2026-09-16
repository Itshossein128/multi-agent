import type { PgPool } from "../../../../src/memory/infrastructure";

export type ManagedPool = PgPool & { end(): Promise<void> };

export interface PostgresPoolOptions {
  /** Maximum number of connections in the pool. */
  max?: number;
  /** Timeout in ms to establish a connection. */
  connectionTimeoutMillis?: number;
  /** Statement timeout in ms. */
  statementTimeoutMs?: number;
}

/**
 * Create a managed Postgres connection pool from a connection string.
 * Validates the connection string and applies sensible defaults.
 */
export function createPostgresPool(
  connectionString: string,
  options: PostgresPoolOptions = {},
): ManagedPool {
  if (!connectionString) throw new Error("A PostgreSQL connection string is required.");
  const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => ManagedPool };
  return new Pool({
    connectionString,
    max: options.max ?? 8,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 2000,
    statement_timeout: options.statementTimeoutMs ?? 5000,
  });
}

/**
 * Resolve a store mode from environment. Returns "postgres" if a connection
 * string is available, otherwise falls back to "in-memory" or "disabled".
 */
export function resolveStoreMode(
  envKey: string,
  connectionString: string | undefined,
  fallback: "in-memory" | "disabled" = "in-memory",
): "postgres" | "in-memory" | "disabled" {
  const raw = process.env[envKey];
  if (raw) {
    if (!["postgres", "in-memory", "disabled"].includes(raw)) throw new Error(`Invalid ${envKey} value.`);
    return raw as "postgres" | "in-memory" | "disabled";
  }
  return connectionString ? "postgres" : fallback;
}
