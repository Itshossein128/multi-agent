import type { PgPool } from "../../memory/infrastructure";
/** Explicit operator action only. Never called from a store constructor or server startup. */
export declare function runStudioMigrations(pool: PgPool, options?: {
    directory?: string;
}): Promise<string[]>;
