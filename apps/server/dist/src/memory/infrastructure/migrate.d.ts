import type { PgPool } from "./postgres-memory-store";
/** Explicit operator action only. Never called from a store constructor or server startup. */
export declare function runMemoryMigrations(pool: PgPool, options?: {
    vectorEnabled?: boolean;
    directory?: string;
}): Promise<string[]>;
