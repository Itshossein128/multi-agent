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
import { AgentRuntime } from "../../../src/agents/runtime";
import { createCredentialComposition } from "./composition";
import { RunExecutor } from "./runtime/runExecutor";
import { InMemoryRunStore, PostgresRunStore } from "./runtime/runStore";
import { recoverInterruptedRuns } from "./runtime/recovery";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { createObservabilityRuntime } from "./observability/bootstrap";
import { resolveRequestPrincipal } from "./auth/principal";
import { createInboundWebhookRouter } from "./api/studio/webhookTriggerRoutes";
import { TriggerOutboxProcessor } from "./triggers/triggerOutboxProcessor";
import { HeartbeatScheduler } from "./triggers/heartbeatScheduler";
import { RoutineScheduler } from "./triggers/routineScheduler";
import { InMemoryOrganizationStore, PostgresOrganizationStore } from "./organization/organizationStore";
import { InMemoryBudgetStore, PostgresBudgetStore } from "./budgets/budgetStore";
import { RunBudgetController } from "./budgets/runBudgetController";
import { BudgetedAgentRuntime } from "./budgets/budgetedAgentRuntime";

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
  // Fail-closed credential composition: production startup aborts here unless
  // a valid external broker (with mTLS material when required) is configured.
  const credentials = createCredentialComposition();
  const observability = createObservabilityRuntime();
  const app = new Hono();
  const webOrigins = (process.env.WEB_ORIGIN ?? (process.env.NODE_ENV === "production" ? "http://localhost:3060" : "http://localhost:3060,http://localhost:3061")).split(",").map((origin) => origin.trim());
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
    if (c.req.path.startsWith("/api/webhooks/") || c.req.path === "/health") {
      return next();
    }
    if (!resolveRequestPrincipal(c.req.raw)) return c.json({ error: "Authentication required." }, 401);
    await next();
  });

  const memory = createMemoryComposition();
  await memory.recover();
  const studio = createStudioComposition();
  const resolveMemoryAccess = memoryAccessResolverFromEnvironment();

  const connectionString = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  const instanceId = process.env.RUN_EXECUTOR_INSTANCE_ID ?? randomUUID();
  const runStore = studio.mode === "postgres" && studio.pool
    ? new PostgresRunStore(studio.pool, { durableMemoryJobs: !!memory.durableJobs, instanceId })
    : new InMemoryRunStore();
  if (runStore instanceof PostgresRunStore) {
    await runStore.assertLeaseSchema();
    await runStore.hydrate();
  }
  const budgetStore = studio.pool ? new PostgresBudgetStore(studio.pool) : new InMemoryBudgetStore();
  const budgetController = new RunBudgetController(budgetStore);

  const checkpointer = studio.mode === "postgres" && connectionString
    ? await createDurableCheckpointer(connectionString)
    : undefined;

  const executor = new RunExecutor(
    runStore,
    new BudgetedAgentRuntime(new AgentRuntime(
      undefined,
      memory.runtime,
      observability.telemetry,
      undefined,
      undefined,
      undefined,
      credentials.workerCredentials,
      credentials.apiCredentials,
    ), budgetController, runStore, studio.store),
    checkpointer,
    observability.telemetry,
    undefined,
    undefined,
    memory.episodeService,
    memory.proceduralService,
    memory.jobs,
    memory.durableJobs,
  );
  memory.startDurableWorkers({
    episodic_extraction: async job => executor.processDurableEpisodicJob(job),
    procedural_learning: async job => executor.processDurableProceduralJob(job),
  });
  const recovery = await recoverInterruptedRuns(executor, runStore, checkpointer, { instanceId });
  await budgetController.recover(await budgetStore.openReservations(), async runId => {
    const status = runStore instanceof PostgresRunStore
      ? await runStore.getDurableStatus(runId)
      : runStore.get(runId)?.run.status;
    return !status || status === "completed" || status === "failed" || status === "cancelled";
  });
  if (recovery.restored.length || recovery.failed.length) {
    console.log(`Run recovery: restored=${recovery.restored.length} failed=${recovery.failed.length}`);
  }

  let outboxProcessor: TriggerOutboxProcessor | undefined;
  let heartbeatScheduler: HeartbeatScheduler | undefined;
  let routineScheduler: RoutineScheduler | undefined;

  if (studio.store) {
    const organizationStore = studio.pool ? new PostgresOrganizationStore(studio.pool) : new InMemoryOrganizationStore();
    app.route("/studio", createStudioRouter(studio.store, undefined, executor, organizationStore, budgetStore));
    app.route("/api/webhooks", createInboundWebhookRouter(studio.store));

    outboxProcessor = new TriggerOutboxProcessor(studio.store, executor);
    outboxProcessor.start();

    heartbeatScheduler = new HeartbeatScheduler(studio.store, executor);
    heartbeatScheduler.start();

    routineScheduler = new RoutineScheduler(studio.store);
    routineScheduler.start();
  }

  app.route("/dashboard", createDashboardRouter(runStore, studio.store, executor, undefined, budgetStore));
  app.route("/memories", createMemoriesRouter(memory.service, resolveMemoryAccess));
  app.route("/runs", createRunsRouter(executor, resolveMemoryAccess, studio.store).app);
  app.route("/tools", createToolsRouter(undefined, studio.store));

  const port = Number(process.env.PORT ?? 4000);
  const server = serve({ fetch: app.fetch, port }, (info) => console.log(`Execution server listening on http://localhost:${info.port}`));
  const shutdown = () => {
    outboxProcessor?.stop();
    heartbeatScheduler?.stop();
    routineScheduler?.stop();
    runStore.close();
    server.close(() => {
      credentials.close();
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
