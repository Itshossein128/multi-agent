import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRunsRouter } from "./api/runs";
import { createMemoriesRouter } from "./api/memories";
import { createMemoryComposition } from "./memory/composition";
import { memoryAccessResolverFromEnvironment } from "./memory/access";
import { AgentRuntime } from "../../../src/agents/runtime";
import { RunExecutor } from "./runtime/runExecutor";

const app = new Hono();
const webOrigins = (process.env.WEB_ORIGIN ?? (process.env.NODE_ENV === "production" ? "http://localhost:3000" : "http://localhost:3000,http://localhost:3001")).split(",").map((origin) => origin.trim());
app.use("/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && webOrigins.includes(origin)) c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID, Authorization");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  await next();
});
app.options("/*", (c) => c.body(null, 204));
app.get("/health", (c) => c.json({ ok: true }));
const memory = createMemoryComposition();
const resolveMemoryAccess = memoryAccessResolverFromEnvironment();
app.route("/memories", createMemoriesRouter(memory.service, resolveMemoryAccess));
app.route("/runs", createRunsRouter(new RunExecutor(undefined, new AgentRuntime(undefined, memory.runtime)), resolveMemoryAccess).app);

const port = Number(process.env.PORT ?? 4000);
const server = serve({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));
const shutdown = () => {
  server.close(() => { void memory.close().then(() => process.exit(0), () => { console.error("Memory shutdown failed."); process.exit(1); }); });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

export { app };
