"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStudioComposition = createStudioComposition;
const infrastructure_1 = require("../../../../src/studio/infrastructure");
/** No migrations at startup; durable storage never silently falls back to a Map. */
function createStudioComposition() {
    const connectionString = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
    const mode = (process.env.STUDIO_STORE ?? (connectionString ? "postgres" : "in-memory"));
    if (mode === "disabled")
        return { mode, close: async () => { } };
    if (!["postgres", "in-memory"].includes(mode))
        throw new Error("Invalid STUDIO_STORE mode.");
    if (mode === "postgres" && !connectionString)
        throw new Error("MEMORY_DATABASE_URL (or STUDIO_DATABASE_URL) is required for PostgreSQL studio persistence.");
    if (mode === "in-memory" && process.env.NODE_ENV === "production")
        throw new Error("Volatile studio storage is not supported in production.");
    let pool;
    if (mode === "postgres") {
        const { Pool } = require("pg");
        pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
    }
    const store = pool ? new infrastructure_1.PostgresStudioStore(pool) : new infrastructure_1.InMemoryStudioStore();
    return { store, pool, mode, close: async () => { await pool?.end(); } };
}
//# sourceMappingURL=composition.js.map