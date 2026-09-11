import { Pool, PoolConfig } from "pg";

let pool: Pool | undefined;

export function getDbPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Database connection string not configured for web tier.");
  }

  const config: PoolConfig = {
    connectionString,
    max: 10,
    connectionTimeoutMillis: 2000,
    statement_timeout: 10000,
  };

  pool = new Pool(config);
  return pool;
}
