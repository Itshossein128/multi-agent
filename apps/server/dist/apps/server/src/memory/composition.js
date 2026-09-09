"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryComposition = createMemoryComposition;
const application_1 = require("../../../../src/memory/application");
const infrastructure_1 = require("../../../../src/memory/infrastructure");
const embeddingProvider_1 = require("./embeddingProvider");
/** No migrations at startup; durable storage never silently falls back to a Map. */
function createMemoryComposition() {
    const connectionString = process.env.MEMORY_DATABASE_URL;
    const mode = process.env.MEMORY_STORE ?? (connectionString ? "postgres" : "disabled");
    if (mode === "disabled")
        return { close: async () => { } };
    if (!["postgres", "in-memory"].includes(mode))
        throw new Error("Invalid MEMORY_STORE mode.");
    if (mode === "postgres" && !connectionString)
        throw new Error("MEMORY_DATABASE_URL is required for PostgreSQL memory.");
    if (mode === "in-memory" && process.env.NODE_ENV === "production")
        throw new Error("Volatile memory storage is not supported in production.");
    let pool;
    if (mode === "postgres") {
        const { Pool } = require("pg");
        pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
    }
    const store = pool ? new infrastructure_1.PostgresMemoryStore(pool, { vectorEnabled: process.env.MEMORY_VECTOR_ENABLED === "true" }) : new infrastructure_1.InMemoryMemoryStore();
    const ttlDays = Number(process.env.MEMORY_DEFAULT_TTL_DAYS ?? 90);
    if (!Number.isFinite(ttlDays) || ttlDays < 0 || ttlDays > 36500)
        throw new Error("Invalid MEMORY_DEFAULT_TTL_DAYS.");
    const service = new application_1.DefaultMemoryService(store, { embeddingProvider: (0, embeddingProvider_1.embeddingProviderFromEnvironment)(), defaultTtlMs: ttlDays === 0 ? undefined : ttlDays * 86400000 });
    const jobs = new application_1.DefaultMemoryBackgroundJobs({ onError: () => console.warn("Background memory operation failed.") });
    const runtime = { service, jobs, extractor: new application_1.DefaultMemoryExtractor(), writePolicy: new application_1.DefaultMemoryWritePolicy(), formatter: new application_1.DefaultMemoryContextFormatter() };
    return { service, runtime, close: async () => { try {
            await jobs.drain();
        }
        finally {
            await pool?.end();
        } } };
}
//# sourceMappingURL=composition.js.map