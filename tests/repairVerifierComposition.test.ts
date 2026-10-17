jest.unmock('../apps/server/src/api/shared/http');
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Hono } from 'hono';
import { createEdge, createEmptyDefinition, createNode, nowIso, uid } from '@multi-agent/types';
import { createRunsRouter } from '../apps/server/src/api/runs';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { RunOrganizationAccess } from '../apps/server/src/runtime/runOrganizationAccess';
import { PostgresRunStore } from '../apps/server/src/runtime/store/postgresRunStore';
import { PostgresBudgetStore } from '../apps/server/src/budgets/budgetStore';
import { createPostgresPool } from '../apps/server/src/infrastructure/postgresPool';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { withOrganization } from '../src/studio/infrastructure/withOrganization';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

const previousMembershipEnforcement = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
beforeAll(() => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; });
afterAll(() => {
  if (previousMembershipEnforcement === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  else process.env.ORG_MEMBERSHIP_ENFORCEMENT = previousMembershipEnforcement;
});

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for run state');
}

test('8 verifier: forged browser initiator remains revocable at actual approval continuation', async () => {
  const studio = new InMemoryStudioStore();
  await seedUs2(studio);
  const runs = new InMemoryRunStore();
  const executor = new RunExecutor(runs, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, new RunOrganizationAccess(studio));
  const principal = { userId: 'member', tenantId: 'org-a' };
  const input = createNode('input', { x: 0, y: 0 });
  const approval = createNode('approval', { x: 1, y: 0 });
  approval.config = { message: 'Continue?', approvalType: 'manual', timeoutSeconds: 300 };
  const output = createNode('output', { x: 2, y: 0 });
  const workflow = { ...createEmptyDefinition(), nodes: [input, approval, output], edges: [
    createEdge({ source: input.id, target: approval.id }), createEdge({ source: approval.id, target: output.id }),
  ] };
  await studio.saveWorkflow(workflow, principal);
  const app = createRunsRouter(executor, undefined, studio, () => principal).app;
  const started = await app.request('/', jsonRequest('POST', { workflow, agents: [], input: {}, metadata: {
    initiatorKind: 'service', serverInitiated: true, triggerEventId: 'forged', triggerDispatchKey: 'forged-approval',
  } }));
  expect(started.status).toBe(202);
  const { runId } = await started.json() as { runId: string };
  await waitFor(() => runs.get(runId)?.run.status === 'waiting_for_human');
  expect(runs.get(runId)?.run).toMatchObject({ initiatorKind: 'user', serverInitiated: false });
  const membership = await studio.getMembership('org-a', 'member');
  await studio.saveMembership({ ...membership!, status: 'removed', version: membership!.version + 1 });
  const pending = runs.listApprovals(runId)[0];
  expect((await app.request(`/${runId}/approvals/${pending.id}/resolve`, jsonRequest('POST', { decision: 'approved' }))).status).toBe(404);
  // Server/timer continuations must independently revalidate the original user.
  executor.resolveApproval(runId, pending.id, { decision: 'approved' });
  await waitFor(() => runs.get(runId)?.run.status === 'failed');
  expect(runs.get(runId)?.run.result?.error?.code).toBe('ORGANIZATION_ACCESS_REVOKED');
  expect(runs.events(runId).map(event => event.type)).not.toContain('run.completed');
});

const db = process.env.MEMORY_TEST_DATABASE_URL;
(db ? describe : describe.skip)('9 verifier: actual mounted SSE with restricted PostgreSQL authorization', () => {
  let admin: Pool;
  let restricted: ReturnType<typeof createPostgresPool>;
  let worker: ReturnType<typeof createPostgresPool>;
  let schema: string;
  beforeAll(async () => {
    schema = `verifier_composition_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: db, options: `-c search_path=${schema},public` });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await runStudioMigrations(admin);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO studio_app, studio_worker; GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO studio_app, studio_worker; GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO studio_app, studio_worker`);
    for (const id of ['owner', 'admin', 'member', 'viewer']) {
      await admin.query("INSERT INTO studio_users(id,email,password_hash,tenant_id,status) VALUES($1,$2,'test-only','org-a','active')", [id, `${id}@test.invalid`]);
    }
    await seedUs2(new PostgresStudioStore(admin));
    restricted = createPostgresPool(db!, { role: 'studio_app', options: `-c search_path=${schema},public`, max: 1 });
    worker = createPostgresPool(db!, { role: 'studio_worker', options: `-c search_path=${schema},public`, max: 1 });
  }, 60000);
  afterAll(async () => {
    await restricted?.end();
    await worker?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  test('an open real event stream holds no authorization connection and delivers later events', async () => {
    const runs = new InMemoryRunStore();
    const runId = uid('sse');
    runs.create({ id: runId, workflowId: 'sse-workflow', status: 'running', startedAt: nowIso(), ownerId: 'owner', tenantId: 'org-a', metadata: {} });
    runs.append(runId, { id: uid('event'), runId, type: 'run.created', timestamp: nowIso(), sequence: 0, payload: {} });
    const app = new Hono();
    app.route('/runs', createRunsRouter(new RunExecutor(runs), undefined, new PostgresStudioStore(restricted), () => ({ userId: 'owner', tenantId: 'org-a' })).app);
    const response = await app.request(`/runs/${runId}/events`, { headers: { Accept: 'text/event-stream' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect((restricted as Pool).idleCount).toBe((restricted as Pool).totalCount);
    // With max=1 this would stall if the stream retained its authorization client.
    expect((await restricted.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    runs.update(runId, { status: 'completed', completedAt: nowIso() });
    runs.append(runId, { id: uid('event'), runId, type: 'run.completed', timestamp: nowIso(), sequence: 0, payload: {} });
    const body = await response.text();
    expect(body).toContain('"type":"run.created"');
    expect(body).toContain('"type":"run.completed"');
  }, 10000);

  test('10 admission commits while the request owns the sole application connection', async () => {
    const runs = new PostgresRunStore(worker, { leaseRenewalIntervalMs: 0 });
    const input = createNode('input', { x: 0, y: 0 });
    const output = createNode('output', { x: 1, y: 0 });
    const workflow = { ...createEmptyDefinition(), nodes: [input, output], edges: [createEdge({ source: input.id, target: output.id })] };
    const studio = new PostgresStudioStore(restricted);
    await withOrganization(restricted, 'org-a', 'user', () => studio.saveWorkflow(workflow, { userId: 'owner', tenantId: 'org-a' }));
    const app = createRunsRouter(new RunExecutor(runs), undefined, studio, () => ({ userId: 'owner', tenantId: 'org-a' })).app;
    try {
      const response = await app.request('/', jsonRequest('POST', { workflow, agents: [], input: { durable: true } }));
      expect(response.status).toBe(202);
      const { runId } = await response.json() as { runId: string };
      await waitFor(() => runs.get(runId)?.run.status === 'completed');
      await runs.flush();
      expect((await admin.query('SELECT status, output FROM studio_runs WHERE id=$1', [runId])).rows[0]).toMatchObject({ status: 'completed' });
      expect(Number((await admin.query('SELECT count(*) AS n FROM studio_run_events WHERE run_id=$1', [runId])).rows[0].n)).toBeGreaterThan(0);
    } finally { runs.close(); }
  }, 15000);

  test('10/13 verifier: unscoped worker discovery drives tenant-scoped hydration, reservations and expired lease recovery', async () => {
    const writer = new PostgresRunStore(restricted, { instanceId: 'original', leaseRenewalIntervalMs: 0 });
    const recovered = new PostgresRunStore(restricted, { instanceId: 'recovered', leaseRenewalIntervalMs: 0, recoveryPool: worker });
    const budgets = new PostgresBudgetStore(restricted, worker);
    try {
      for (const tenantId of ['org-a', 'org-b']) {
        writer.create({ id: `worker-${tenantId}`, workflowId: 'worker-workflow', status: 'queued', startedAt: nowIso(), ownerId: 'owner', tenantId, metadata: {} });
      }
      await writer.flush();
      await budgets.setBudget({ tenantId: 'org-a', scope: 'company', scopeId: 'org-a', limitUsd: 10, thresholdPercent: 80 });
      expect(await budgets.reserve('worker-org-a', 'org-a', [{ scope: 'company', scopeId: 'org-a' }], 1)).toBe(true);
      expect((await worker.query('SELECT current_user AS role')).rows[0].role).toBe('studio_worker');
      // Restricted application reads expose no rows before a tenant is supplied.
      expect((await restricted.query('SELECT id FROM studio_runs')).rows).toEqual([]);
      expect((await worker.query('SELECT * FROM studio_recovery_organizations()')).rows).toEqual(expect.arrayContaining([{ tenant_id: 'org-a' }, { tenant_id: 'org-b' }]));
      await recovered.hydrate();
      expect(recovered.get('worker-org-a')?.run.tenantId).toBe('org-a');
      expect(recovered.get('worker-org-b')?.run.tenantId).toBe('org-b');
      expect(await recovered.getDurableStatus('worker-org-a', 'org-b')).toBeUndefined();
      expect(await budgets.openReservations()).toEqual([{ runId: 'worker-org-a', tenantId: 'org-a' }]);
      expect(await recovered.claimOrphanedRuns()).toEqual([]);
      await admin.query("UPDATE studio_runs SET execution_lease_expires_at=now()-interval '1 second' WHERE id='worker-org-a'");
      expect(await recovered.claimOrphanedRuns()).toEqual([{ id: 'worker-org-a', status: 'queued' }]);
      expect(await recovered.claimOrphanedRuns()).toEqual([]);
      await budgets.settle('worker-org-a', .5, 'org-a');
      expect((await budgets.list('org-a'))[0]).toMatchObject({ spentUsd: .5, reservedUsd: 0 });
      expect(await budgets.openReservations()).toEqual([]);
    } finally { writer.close(); recovered.close(); }
  }, 20000);
});
