import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRunsRouter } from "./api/runs";
import { createToolsRouter } from "./api/tools";
import { createMemoriesRouter } from "./api/memories";
import { createStudioRouter } from "./api/studio";
import { createDashboardRouter } from "./api/dashboard";
import { createMemoryComposition } from "./memory/composition";
import { memoryAccessResolverFromEnvironment } from "./memory/access";
import { createStudioComposition } from "./studio/composition";
import { AgentRuntime, workerCredentialResolverFromEnvironment } from "../../../src/agents/runtime";
import { RunExecutor } from "./runtime/runExecutor";
import { InMemoryRunStore, PostgresRunStore } from "./runtime/runStore";
import { recoverInterruptedRuns } from "./runtime/recovery";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createObservabilityRuntime } from "./observability/bootstrap";
import { resolveRequestPrincipal } from "./auth/principal";

async function createDurableCheckpointer(connectionString: string): Promise<(BaseCheckpointSaver & { end?: () => Promise<void> }) | undefined> {
  try {
    const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres");
    const saver = PostgresSaver.fromConnString(connectionString);
    await saver.setup();
    return saver;
  } catch (error) {
    console.warn("Postgres checkpointer unavailable; approval recovery will be limited.", error instanceof Error ? error.message : error);
    return undefined;
  }
}

async function main() {
  const observability = createObservabilityRuntime();
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
  app.use("/*", async (c, next) => {
    if (!resolveRequestPrincipal(c.req.raw)) return c.json({ error: "Authentication required." }, 401);
    await next();
  });

  const memory = createMemoryComposition();
  const studio = createStudioComposition();
  const resolveMemoryAccess = memoryAccessResolverFromEnvironment();

  const connectionString = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  const runStore = studio.mode === "postgres" && studio.pool
    ? new PostgresRunStore(studio.pool)
    : new InMemoryRunStore();
  if (runStore instanceof PostgresRunStore) await runStore.hydrate();

  const checkpointer = studio.mode === "postgres" && connectionString
    ? await createDurableCheckpointer(connectionString)
    : undefined;

  const executor = new RunExecutor(
    runStore,
    new AgentRuntime(
      undefined,
      memory.runtime,
      observability.telemetry,
      undefined,
      undefined,
      undefined,
      workerCredentialResolverFromEnvironment(),
    ),
    checkpointer,
    observability.telemetry,
  );
  const recovery = recoverInterruptedRuns(executor, runStore, checkpointer);
  if (recovery.restored.length || recovery.failed.length) {
    console.log(`Run recovery: restored=${recovery.restored.length} failed=${recovery.failed.length}`);
  }

  if (studio.store) app.route("/studio", createStudioRouter(studio.store, undefined, executor));
  app.route("/dashboard", createDashboardRouter(runStore, studio.store, executor));
  app.route("/memories", createMemoriesRouter(memory.service, resolveMemoryAccess));
  app.route("/runs", createRunsRouter(executor, resolveMemoryAccess, studio.store).app);
  app.route("/tools", createToolsRouter(undefined, studio.store));

  const port = Number(process.env.PORT ?? 4000);
  const server = serve({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));
  const shutdown = () => {
    server.close(() => {
      const persistenceFlush = "flush" in runStore ? runStore.flush() : Promise.resolve();
      void Promise.all([memory.close(), studio.close(), persistenceFlush, observability.shutdown()]).then(
        () => process.exit(0),
        () => { console.error("Shutdown failed."); process.exit(1); },
      );
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export { };
