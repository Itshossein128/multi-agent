import { createEdge, createEmptyDefinition, createNode, nowIso, type RoutineRecord, type WorkflowDefinition } from '@multi-agent/types';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { TriggerOutboxProcessor } from '../apps/server/src/triggers/triggerOutboxProcessor';
import { HeartbeatScheduler } from '../apps/server/src/triggers/heartbeatScheduler';
import { RoutineScheduler } from '../apps/server/src/triggers/routineScheduler';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import type { AgentHeartbeatSettings } from '../packages/types/src/index';
import {
  assertOrganizationScope,
  currentOrganizationScope,
  OrganizationScopeError,
  runInOrganizationScope,
} from '../src/studio/infrastructure/organizationJobScope';
import { seedUs2 } from './organizationUs2Fixtures';
import type { DurableMemoryJob } from '../src/memory/infrastructure';

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

function workflow(id: string): WorkflowDefinition {
  const input = createNode('input', { x: 0, y: 0 });
  const output = createNode('output', { x: 1, y: 0 });
  return {
    ...createEmptyDefinition(),
    id,
    name: id,
    nodes: [input, output],
    edges: [createEdge({ source: input.id, target: output.id })],
    updatedAt: nowIso(),
  };
}

function routine(id: string, ownerId: string, org: string): RoutineRecord {
  const stamp = nowIso();
  return {
    id,
    tenantId: org,
    name: id,
    description: '',
    scheduleType: 'interval',
    scheduleExpr: 'every:60s',
    timezone: 'UTC',
    targetType: 'workflow',
    targetId: 'wf-shared',
    inputPayload: { marker: id },
    misfirePolicy: 'coalesce',
    enabled: true,
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: stamp,
    updatedAt: stamp,
    ownerId,
  };
}

/** Records the ambient organization scope seen by production store calls. */
class ScopedProbeStudioStore extends InMemoryStudioStore {
  readonly observed: Array<{ method: string; scope?: string; tenant?: string }> = [];
  private record(method: string, tenant?: string) {
    this.observed.push({ method, scope: currentOrganizationScope()?.organizationId, tenant });
  }
  /** Ignore observations recorded while seeding fixtures directly. */
  resetObservations() {
    this.observed.length = 0;
  }
  override async getWorkflow(id: string, principal?: { tenantId: string; userId: string; principalKind?: string }) {
    this.record('getWorkflow', principal?.tenantId);
    return super.getWorkflow(id, principal as never);
  }
  override async saveRoutine(routine: RoutineRecord, principal?: { tenantId: string; userId: string; principalKind?: string }) {
    this.record('saveRoutine', routine.tenantId);
    return super.saveRoutine(routine, principal as never);
  }
  override async saveAgentHeartbeat(settings: AgentHeartbeatSettings, principal?: { tenantId: string; userId: string; principalKind?: string }) {
    this.record('saveAgentHeartbeat', settings.tenantId);
    return super.saveAgentHeartbeat(settings as never, principal as never);
  }
}

describe('US3 background isolation — interleaved multi-organization handlers', () => {
  test('T046 outbox dispatches each event inside its own organization scope and creates runs in the event tenant', async () => {
    const store = new ScopedProbeStudioStore();
    await seedUs2(store, 'org-a');
    await seedUs2(store, 'org-b');
    await store.saveWorkflow(workflow('wf-shared'), { tenantId: 'org-a', userId: 'owner' });
    await store.saveWorkflow({ ...workflow('wf-shared'), id: 'wf-b' }, { tenantId: 'org-b', userId: 'owner' });
    const stamp = nowIso();
    for (const [tenantId, id, targetId] of [['org-a', 'trigger-a', 'wf-shared'], ['org-b', 'trigger-b', 'wf-b']] as const) {
      await store.saveWebhookTrigger({ id, tenantId, ownerId: 'owner', name: id, description: '', secretHash: 'encrypted', targetType: 'workflow', targetId, enabled: true, rateLimitPerMinute: 60, createdAt: stamp, updatedAt: stamp }, { tenantId, userId: 'owner' });
    }

    const eventA = await store.enqueueTriggerEvent({
      tenantId: 'org-a',
      eventType: 'webhook_inbound',
      targetType: 'workflow',
      targetId: 'wf-shared',
      idempotencyKey: 'outbox-a',
      payload: { marker: 'a', triggerId: 'trigger-a' },
    });
    const eventB = await store.enqueueTriggerEvent({
      tenantId: 'org-b',
      eventType: 'webhook_inbound',
      targetType: 'workflow',
      targetId: 'wf-b',
      idempotencyKey: 'outbox-b',
      payload: { marker: 'b', triggerId: 'trigger-b' },
    });
    expect(eventB.id).not.toBe(eventA.id);

    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore);
    const processor = new TriggerOutboxProcessor(store, executor, undefined, { workerId: 'w1', pollIntervalMs: 60_000 });
    await processor.tick();
    await processor.tick();

    const runs = runStore.list();
    expect(runs).toHaveLength(2);
    const tenants = runs.map((run) => run.tenantId).sort();
    expect(tenants).toEqual(['org-a', 'org-b']);
    for (const run of runs) {
      expect(run.metadata.triggerEventId).toBeDefined();
      expect(run.initiatorKind).toBe('user');
    }

    const observations = store.observed.filter((entry) => entry.method === 'getWorkflow');
    expect(observations.length).toBeGreaterThanOrEqual(2);
    for (const observation of observations) {
      expect(observation.scope).toBeDefined();
      expect(observation.scope).toBe(observation.tenant);
    }
    expect(new Set(observations.map((entry) => entry.scope))).toEqual(new Set(['org-a', 'org-b']));
  });

  test('T046 identical trigger idempotency and dispatch keys in two organizations never collide', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');
    await seedUs2(store, 'org-b');
    const sharedKey = 'shared-idempotency-key';

    const first = await store.enqueueTriggerEvent({
      tenantId: 'org-a', eventType: 'routine_tick', targetType: 'workflow', targetId: 'wf-a',
      idempotencyKey: sharedKey, payload: {},
    });
    const second = await store.enqueueTriggerEvent({
      tenantId: 'org-b', eventType: 'routine_tick', targetType: 'workflow', targetId: 'wf-b',
      idempotencyKey: sharedKey, payload: {},
    });
    expect(second.id).not.toBe(first.id);
    expect(await store.listTriggerEvents({ idempotencyKey: sharedKey })).toHaveLength(2);

    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore);
    const base = { workflow: workflow('wf-dedupe'), agents: [] as never[], input: {}, metadata: { triggerDispatchKey: 'shared-dispatch-key' } };
    executor.start(base, undefined, { userId: 'owner', tenantId: 'org-a' });
    executor.start(base, undefined, { userId: 'owner', tenantId: 'org-b' });
    const runs = runStore.list();
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.tenantId).sort()).toEqual(['org-a', 'org-b']);
  });

  test('T046 routine dispatch executes per item inside the routine organization scope', async () => {
    const store = new ScopedProbeStudioStore();
    await seedUs2(store, 'org-a');
    await seedUs2(store, 'org-b');
    await store.saveRoutine(routine('routine-a', 'owner', 'org-a'), { tenantId: 'org-a', userId: 'owner' });
    await store.saveRoutine(routine('routine-b', 'owner', 'org-b'), { tenantId: 'org-b', userId: 'owner' });
    store.resetObservations();

    const scheduler = new RoutineScheduler(store, { pollIntervalMs: 60_000, claimLimit: 10 });
    const processed = await scheduler.tick();
    expect(processed.map((entry) => entry.tenantId).sort()).toEqual(['org-a', 'org-b']);

    const observations = store.observed.filter((entry) => entry.method === 'saveRoutine');
    expect(observations.length).toBeGreaterThanOrEqual(2);
    for (const observation of observations) {
      expect(observation.scope).toBeDefined();
      expect(observation.scope).toBe(observation.tenant);
    }
    const events = await store.listTriggerEvents({ limit: 10 });
    expect(events.map((event) => event.tenantId).sort()).toEqual(['org-a', 'org-b']);
  });

  test('T046 heartbeat dispatch executes inside the heartbeat organization scope', async () => {
    const store = new ScopedProbeStudioStore();
    await seedUs2(store, 'org-a');
    const stamp = new Date(Date.now() - 1000).toISOString();
    await store.saveAgentHeartbeat({ agentId: 'agent-gone', tenantId: 'org-a', enabled: true, intervalSeconds: 60, nextHeartbeatAt: stamp }, { tenantId: 'org-a', userId: 'owner' });
    store.resetObservations();

    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore);
    const scheduler = new HeartbeatScheduler(store, executor, { pollIntervalMs: 60_000, claimLimit: 5 });
    await scheduler.tick();

    const observation = store.observed.find((entry) => entry.method === 'saveAgentHeartbeat');
    expect(observation).toBeDefined();
    expect(observation!.scope).toBe('org-a');
  });

  test('T046 memory job handlers execute under the job organization and reject foreign tenant mixes', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');
    const namespace = { scope: 'workflow' as const, id: 'wf-memory' };
    const runStore = new (class extends InMemoryRunStore {
      readonly scopes: Array<string | undefined> = [];
      override get(runId: string) {
        this.scopes.push(currentOrganizationScope()?.organizationId);
        return super.get(runId);
      }
    })();
    runStore.create({
      id: 'run-memory',
      workflowId: 'wf-memory',
      status: 'completed',
      startedAt: nowIso(),
      completedAt: nowIso(),
      input: {},
      output: {},
      metadata: {},
      ownerId: 'member',
      tenantId: 'org-a',
    }, { principalId: 'member', tenantId: 'org-a' }, undefined, undefined,
      { principalId: 'member', tenantId: 'org-a', readableNamespaces: [namespace], writableNamespaces: [namespace] });

    const episodeService = { processRun: jest.fn(async () => ({ created: false, reason: 'trivial' })) };
    const executor = new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
      episodeService as never);

    const job: DurableMemoryJob = {
      id: 'job-1',
      kind: 'episodic_extraction',
      handlerVersion: 1,
      idempotencyKey: 'episodic:run-memory:v1',
      tenantId: 'org-a',
      namespace,
      runId: 'run-memory',
      status: 'pending',
      attempts: 1,
      availableAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await executor.processDurableEpisodicJob(job);
    expect(runStore.scopes).toContain('org-a');
    expect(runStore.scopes.every((scope) => scope === 'org-a')).toBe(true);

    await expect(executor.processDurableEpisodicJob({ ...job, tenantId: 'org-b' }))
      .rejects.toThrow(/access validation failed/i);
    expect(episodeService.processRun).toHaveBeenCalledTimes(1);
  });

  test('T046 organization scope assertions reject missing and foreign scopes', async () => {
    expect(typeof assertOrganizationScope).toBe('function');
    expect(() => assertOrganizationScope('org-a')).toThrow(OrganizationScopeError);
    await runInOrganizationScope({ organizationId: 'org-a', principalKind: 'service', source: 'test' }, async () => {
      expect(currentOrganizationScope()?.organizationId).toBe('org-a');
      expect(() => assertOrganizationScope('org-a')).not.toThrow();
      expect(() => assertOrganizationScope('org-b')).toThrow(OrganizationScopeError);
    });
    expect(currentOrganizationScope()).toBeUndefined();
  });
});

const pgSuite = databaseUrl ? describe : describe.skip;

pgSuite('US3 background isolation — organization scope runner on PostgreSQL', () => {
  let pool: import('pg').Pool;
  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: databaseUrl });
  });
  afterAll(async () => { await pool?.end(); });

  test('T046 the PostgreSQL scope runner sets app.tenant_id for the scoped connection', async () => {
    const { createPgOrganizationScopeRunner } = await import('../src/studio/infrastructure/organizationJobScope');
    const { readOrganizationGucs } = await import('../src/studio/infrastructure/withOrganization');
    const runner = createPgOrganizationScopeRunner(pool as never);
    const result = await runner(
      { organizationId: 'org-scope-runner', principalKind: 'service', source: 'test.source' },
      async () => {
        const client = currentOrganizationScope()!.client!;
        return {
          gucs: await readOrganizationGucs(client),
          scope: currentOrganizationScope(),
        };
      },
    );
    expect(result.gucs.tenantId).toBe('org-scope-runner');
    expect(result.gucs.principalKind).toBe('service');
    expect(result.scope?.organizationId).toBe('org-scope-runner');
    expect(result.scope?.source).toBe('test.source');
  });

  test('T046 production store queries inside the scope run on the scoped connection', async () => {
    const { createPgOrganizationScopeRunner } = await import('../src/studio/infrastructure/organizationJobScope');
    const { PostgresStudioStore } = await import('../src/studio/infrastructure/postgres-studio-store');
    const store = new PostgresStudioStore(pool);
    const rawQuery = (text: string) =>
      (store as unknown as { query(text: string): Promise<{ rows: Array<{ tenant_id: string }> }> }).query(text);
    const runner = createPgOrganizationScopeRunner(pool as never);
    const inside = await runner({ organizationId: 'org-scope-store', source: 'test.store' }, async () => {
      const result = await rawQuery("SELECT current_setting('app.tenant_id', true) AS tenant_id");
      return result.rows[0].tenant_id;
    });
    expect(inside).toBe('org-scope-store');
    const outside = await rawQuery("SELECT current_setting('app.tenant_id', true) AS tenant_id");
    expect(outside.rows[0]?.tenant_id === '' || outside.rows[0]?.tenant_id == null).toBe(true);
  });
});
