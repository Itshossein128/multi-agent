"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const runs_1 = require("./api/runs");
const tools_1 = require("./api/tools");
const memories_1 = require("./api/memories");
const studio_1 = require("./api/studio");
const dashboard_1 = require("./api/dashboard");
const composition_1 = require("./memory/composition");
const access_1 = require("./memory/access");
const composition_2 = require("./studio/composition");
const runtime_1 = require("../../../src/agents/runtime");
const runExecutor_1 = require("./runtime/runExecutor");
const runStore_1 = require("./runtime/runStore");
const recovery_1 = require("./runtime/recovery");
const bootstrap_1 = require("./observability/bootstrap");
const principal_1 = require("./auth/principal");
async function createDurableCheckpointer(connectionString) {
    try {
        const { PostgresSaver } = await Promise.resolve().then(() => __importStar(require("@langchain/langgraph-checkpoint-postgres")));
        const saver = PostgresSaver.fromConnString(connectionString);
        await saver.setup();
        return saver;
    }
    catch (error) {
        console.warn("Postgres checkpointer unavailable; approval recovery will be limited.", error instanceof Error ? error.message : error);
        return undefined;
    }
}
async function main() {
    const observability = (0, bootstrap_1.createObservabilityRuntime)();
    const app = new hono_1.Hono();
    const webOrigins = (process.env.WEB_ORIGIN ?? (process.env.NODE_ENV === "production" ? "http://localhost:3000" : "http://localhost:3000,http://localhost:3001")).split(",").map((origin) => origin.trim());
    app.use("/*", async (c, next) => {
        const origin = c.req.header("Origin");
        if (origin && webOrigins.includes(origin))
            c.header("Access-Control-Allow-Origin", origin);
        c.header("Vary", "Origin");
        c.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID, Authorization");
        c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
        await next();
    });
    app.options("/*", (c) => c.body(null, 204));
    app.get("/health", (c) => c.json({ ok: true }));
    app.use("/*", async (c, next) => {
        if (!(0, principal_1.resolveRequestPrincipal)(c.req.raw))
            return c.json({ error: "Authentication required." }, 401);
        await next();
    });
    const memory = (0, composition_1.createMemoryComposition)();
    const studio = (0, composition_2.createStudioComposition)();
    const resolveMemoryAccess = (0, access_1.memoryAccessResolverFromEnvironment)();
    const connectionString = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
    const runStore = studio.mode === "postgres" && studio.pool
        ? new runStore_1.PostgresRunStore(studio.pool)
        : new runStore_1.InMemoryRunStore();
    if (runStore instanceof runStore_1.PostgresRunStore)
        await runStore.hydrate();
    const checkpointer = studio.mode === "postgres" && connectionString
        ? await createDurableCheckpointer(connectionString)
        : undefined;
    const executor = new runExecutor_1.RunExecutor(runStore, new runtime_1.AgentRuntime(undefined, memory.runtime, observability.telemetry), checkpointer, observability.telemetry);
    const recovery = (0, recovery_1.recoverInterruptedRuns)(executor, runStore, checkpointer);
    if (recovery.restored.length || recovery.failed.length) {
        console.log(`Run recovery: restored=${recovery.restored.length} failed=${recovery.failed.length}`);
    }
    if (studio.store)
        app.route("/studio", (0, studio_1.createStudioRouter)(studio.store));
    app.route("/dashboard", (0, dashboard_1.createDashboardRouter)(runStore, studio.store, executor));
    app.route("/memories", (0, memories_1.createMemoriesRouter)(memory.service, resolveMemoryAccess));
    app.route("/runs", (0, runs_1.createRunsRouter)(executor, resolveMemoryAccess, studio.store).app);
    app.route("/tools", (0, tools_1.createToolsRouter)(undefined, studio.store));
    const port = Number(process.env.PORT ?? 4000);
    const server = (0, node_server_1.serve)({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));
    const shutdown = () => {
        server.close(() => {
            void Promise.all([memory.close(), studio.close(), observability.shutdown()]).then(() => process.exit(0), () => { console.error("Shutdown failed."); process.exit(1); });
        });
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map