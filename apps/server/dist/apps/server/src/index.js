"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
require("dotenv/config");
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const runs_1 = require("./api/runs");
const memories_1 = require("./api/memories");
const composition_1 = require("./memory/composition");
const access_1 = require("./memory/access");
const runtime_1 = require("../../../src/agents/runtime");
const runExecutor_1 = require("./runtime/runExecutor");
const app = new hono_1.Hono();
exports.app = app;
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
const memory = (0, composition_1.createMemoryComposition)();
const resolveMemoryAccess = (0, access_1.memoryAccessResolverFromEnvironment)();
app.route("/memories", (0, memories_1.createMemoriesRouter)(memory.service, resolveMemoryAccess));
app.route("/runs", (0, runs_1.createRunsRouter)(new runExecutor_1.RunExecutor(undefined, new runtime_1.AgentRuntime(undefined, memory.runtime)), resolveMemoryAccess).app);
const port = Number(process.env.PORT ?? 4000);
const server = (0, node_server_1.serve)({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));
const shutdown = () => {
    server.close(() => { void memory.close().then(() => process.exit(0), () => { console.error("Memory shutdown failed."); process.exit(1); }); });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
//# sourceMappingURL=index.js.map