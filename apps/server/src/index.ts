import { createPostgresPool } from "./infrastructure/postgresPool";
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
import { requireOrganizationContext, respondWithApiError, type PrincipalVariables } from "./api/shared/http";
import { resolveRequestPrincipal } from "./auth/principal";
import { createInboundWebhookRouter } from "./api/studio/webhookTriggerRoutes";
import { TriggerOutboxProcessor } from "./triggers/triggerOutboxProcessor";
import { HeartbeatScheduler } from "./triggers/heartbeatScheduler";
import { RoutineScheduler } from "./triggers/routineScheduler";
import { InMemoryOrganizationStore, PostgresOrganizationStore } from "./organization/organizationStore";
import { RunOrganizationAccess } from "./runtime/runOrganizationAccess";
import { RunAccessCheckpoint, checkpointedApiCredentials } from "./runtime/runAccessCheckpoint";
import { createPgOrganizationScopeRunner } from "../../../src/studio/infrastructure/organizationJobScope";
import { PostgresOrganizationUnitOfWork } from "./organization/organizationUnitOfWork";
import { InMemoryBudgetStore, PostgresBudgetStore } from "./budgets/budgetStore";
import { RunBudgetController } from "./budgets/runBudgetController";
import { BudgetedAgentRuntime } from "./budgets/budgetedAgentRuntime";
import { createOrganizationPurgeWorker } from "./organization/purgeComposition";
import type { OrganizationPurgeWorker } from "./organization/organizationPurgeWorker";
import { log } from "./logging";
import { prepareOrganizationCheckpoints } from "./organization/checkpointCleanup";

async function createDurableCheckpointer(connectionString: string): Promise<(BaseCheckpointSaver & { end?: () => Promise<void> }) | undefined> {
  let saver: (BaseCheckpointSaver & { setup(): Promise<void>; end(): Promise<void> }) | undefined;
  try {
    const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres");
    saver = PostgresSaver.fromConnString(connectionString);
    await saver.setup();
    const setupPool = createPostgresPool(connectionString, {skipRole:true});
    try { await prepareOrganizationCheckpoints(setupPool); }
    finally { await setupPool.end(); }
    return saver;
  } catch (error) {
    await saver?.end().catch(() => undefined);
    console.warn("Postgres checkpointer unavailable; approval recovery will be limited.", error instanceof Error ? error.message : error);
    return undefined;
  }
}

async function main() {
  // Fail-closed credential composition: production startup aborts here unless
  // a valid external broker (with mTLS material when required) is configured.
  const credentials = createCredentialComposition();
  const observability = createObservabilityRuntime();
  const app = new Hono<{ Variables: PrincipalVariables }>();
  app.onError(respondWithApiError);
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
    const principal = resolveRequestPrincipal(c.req.raw);
    if (!principal) return c.json({ error: "Authentication required." }, 401);
    c.set("principal", principal);
    await next();
  });

  const memory = createMemoryComposition();
  await memory.recover();
  const studio = createStudioComposition();
  if (!studio.store) throw new Error("Organization authority storage is required by the execution API.");
  if (studio.store) app.use("/*", requireOrganizationContext(studio.store));
  const resolveMemoryAccess = memoryAccessResolverFromEnvironment(resolveRequestPrincipal);

  const connectionString = process.env.MEMORY_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  const instanceId = process.env.RUN_EXECUTOR_INSTANCE_ID ?? randomUUID();
  const recoveryPool = studio.pool && connectionString ? createPostgresPool(connectionString, {isWorker:true}) : undefined;
  const runStore = studio.mode === "postgres" && studio.pool
    // Request authorization can occupy every application connection while awaiting
    // durable admission. Keep independent run writes on the worker pool.
    ? new PostgresRunStore(recoveryPool ?? studio.pool, { durableMemoryJobs: !!memory.durableJobs, instanceId, recoveryPool })
    : new InMemoryRunStore();
  if (runStore instanceof PostgresRunStore) {
    await runStore.assertLeaseSchema();
    await runStore.hydrate();
  }
  const budgetStore = studio.pool ? new PostgresBudgetStore(studio.pool, recoveryPool) : new InMemoryBudgetStore();
  const budgetController = new RunBudgetController(budgetStore);
  // D-5: one checkpoint instance guards every credential lease and resume path.
  const runAccessCheckpoint = new RunAccessCheckpoint();
  const runOrganizationAccess = new RunOrganizationAccess(studio.store);

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
      // D-5 credential-lease checkpoint: no broker lease is issued for a run
      // that no longer exists, changed organization, or lost its initiator.
      checkpointedApiCredentials(credentials.apiCredentials, runAccessCheckpoint),
    ), budgetController, runStore, studio.store),
    checkpointer,
    observability.telemetry,
    undefined,
    undefined,
    memory.episodeService,
    memory.proceduralService,
    memory.jobs,
    memory.durableJobs,
    runOrganizationAccess,
  );
  runAccessCheckpoint.install(({ runId, tenantId }) => executor.assertRunAccess(runId, tenantId));
  memory.startDurableWorkers({
    episodic_extraction: async job => executor.processDurableEpisodicJob(job),
    procedural_learning: async job => executor.processDurableProceduralJob(job),
  });
  const recovery = await recoverInterruptedRuns(executor, runStore, checkpointer, { instanceId });
  await budgetController.recover(await budgetStore.openReservations(), async (runId, tenantId) => {
    const status = runStore instanceof PostgresRunStore
      ? await runStore.getDurableStatus(runId, tenantId)
      : runStore.get(runId)?.run.status;
    return !status || status === "completed" || status === "failed" || status === "cancelled";
  });
  if (recovery.restored.length || recovery.failed.length) {
    console.log(`Run recovery: restored=${recovery.restored.length} failed=${recovery.failed.length}`);
  }
  // Startup can race a still-valid lease from the previous process. Re-run once
  // after the lease window so orphans left by that race are claimed.
  if (runStore instanceof PostgresRunStore) {
    const retryMs = runStore.leaseDurationMs + 1_000;
    const timer = setTimeout(() => {
      void recoverInterruptedRuns(executor, runStore, checkpointer, { instanceId }).then(async (second) => {
        if (second.restored.length || second.failed.length) {
          console.log(`Run recovery (deferred): restored=${second.restored.length} failed=${second.failed.length}`);
        }
        await budgetController.recover(await budgetStore.openReservations(), async (runId, tenantId) => {
          const status = await runStore.getDurableStatus(runId, tenantId);
          return !status || status === "completed" || status === "failed" || status === "cancelled";
        });
      }).catch((error) => {
        console.error("Deferred run recovery failed:", error instanceof Error ? error.message : error);
      });
    }, retryMs);
    timer.unref?.();
  }

  let outboxProcessor: TriggerOutboxProcessor | undefined;
  let heartbeatScheduler: HeartbeatScheduler | undefined;
  let routineScheduler: RoutineScheduler | undefined;
  let organizationPurgeWorker: OrganizationPurgeWorker | undefined;

  if (studio.store) {
    const organizationStore = studio.pool ? new PostgresOrganizationStore(studio.pool) : new InMemoryOrganizationStore();
    const organizationAccess = runOrganizationAccess;
    // US3/T050: each background item claims across organizations but executes
    // inside its own organization scope (RLS GUCs on PostgreSQL).
    const scopeRunner = studio.pool ? createPgOrganizationScopeRunner(studio.pool) : undefined;
    organizationPurgeWorker = createOrganizationPurgeWorker({
      studioStore: studio.store, runStore, organizationStore, budgetStore, memory,
      credentialCleanup: credentials.tenantCleanup, discoveryPool: recoveryPool,
    });
    app.route("/studio", createStudioRouter(studio.store, undefined, executor, organizationStore, budgetStore,
      studio.pool ? new PostgresOrganizationUnitOfWork(studio.pool) : undefined, organizationPurgeWorker));
    try { organizationPurgeWorker.assertReady(); organizationPurgeWorker.startRecovery(); }
    catch { log.warn("organization.purge.not_configured", {}); }
    app.route("/api/webhooks", createInboundWebhookRouter(studio.store));

    outboxProcessor = new TriggerOutboxProcessor(studio.store, executor, undefined, { scopeRunner }, organizationAccess);
    outboxProcessor.start();

    heartbeatScheduler = new HeartbeatScheduler(studio.store, executor, { scopeRunner }, organizationAccess);
    heartbeatScheduler.start();

    routineScheduler = new RoutineScheduler(studio.store, { scopeRunner }, organizationAccess);
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
      void Promise.resolve(organizationPurgeWorker?.stopRecovery()).then(async () => {
        await persistenceFlush;
        await Promise.all([memory.close(), studio.close(), observability.shutdown(), recoveryPool?.end()]);
      }).then(
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
