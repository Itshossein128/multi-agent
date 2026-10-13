import { Hono } from 'hono';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Run } from '@multi-agent/types';
import type { StudioStore } from '../src/studio/contracts';
import { createRunsRouter } from '../apps/server/src/api/runs';
import { createToolsRouter } from '../apps/server/src/api/tools';
import { createDashboardRouter } from '../apps/server/src/api/dashboard';
import { createMemoriesRouter } from '../apps/server/src/api/memories';
import { requireOrganizationContext, respondWithApiError, type PrincipalVariables } from '../apps/server/src/api/shared/http';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore, PostgresRunStore } from '../apps/server/src/runtime/runStore';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

function routers(store: StudioStore, principal?: { userId: string; tenantId: string }): [string, Hono<any>][] {
  const runs = new InMemoryRunStore(), executor = new RunExecutor(runs);
  const resolve = principal ? () => principal : undefined;
  return [
    ['/runs', createRunsRouter(executor, async () => null, store, resolve).app],
    ['/tools', createToolsRouter(undefined, store, resolve)],
    ['/dashboard', createDashboardRouter(runs, store, executor, resolve)],
    ['/memories', createMemoriesRouter(undefined, async () => null)],
  ];
}

const inventory = routers(new InMemoryStudioStore()).flatMap(([prefix, app]) => app.routes.filter(r => r.method !== 'ALL').map(r => ({ prefix, method: r.method, path: r.path })));

describe('US2 execution routes organization boundary', () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(() => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; });
  afterAll(() => { if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old; });

  for (const route of inventory) {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      test(`${route.method} ${route.prefix}${route.path}: ${role}`, async () => {
        const store = new InMemoryStudioStore(); await seedUs2(store);
        const principal = { userId: role, tenantId: 'org-a' };
        const app = new Hono<{ Variables: PrincipalVariables }>();
        app.use('*', async (c, next) => { c.set('principal', principal); await next(); });
        app.use('*', requireOrganizationContext(store)); app.onError(respondWithApiError);
        for (const [prefix, router] of routers(store, principal)) app.route(prefix, router);
        const path = `${route.prefix}${route.path === '/' ? '' : route.path}`.replace(/:[^/]+/g, 'missing');
        const read = route.method === 'GET' || path === '/memories/search';
        const allowed = read || role === 'owner' || role === 'admin' || (role === 'member' && route.prefix !== '/memories');
        const response = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
        if (allowed) {
          expect(response.status).not.toBe(500);
          expect(response.status).not.toBe(403);
          if (route.prefix === '/memories') {
            expect(response.status).toBe(401);
          } else if (['/runs', '/dashboard'].includes(path) && route.method === 'GET') {
            expect(response.status).toBe(200);
          } else if (path.includes('missing')) {
            expect(response.status).toBe(404);
          } else {
            expect([200, 202, 400, 404, 422]).toContain(response.status);
          }
        } else {
          expect(response.status).toBe(403);
          const err = await response.json();
          expect(err).toHaveProperty('error');
        }
      });
    }

    test.each(['stranger', 'removed'])(`${route.method} ${route.prefix}${route.path}: %s`, async userId => {
      const store = new InMemoryStudioStore(); await seedUs2(store);
      if (userId === 'removed') { const m = (await store.getMembership('org-a', 'member'))!; await store.saveMembership({ ...m, userId, status: 'removed', version: 2 }); }
      const principal = { userId, tenantId: 'org-a' };
      const app = new Hono<{ Variables: PrincipalVariables }>();
      app.use('*', async (c, next) => { c.set('principal', principal); await next(); });
      app.use('*', requireOrganizationContext(store)); app.onError(respondWithApiError);
      for (const [prefix, router] of routers(store)) app.route(prefix, router);
      const path = `${route.prefix}${route.path === '/' ? '' : route.path}`.replace(/:[^/]+/g, 'missing');
      const r = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
      expect(r.status).toBe(404); expect(await r.json()).toEqual({ error: 'Not found' });
    });
  }

  test.each(['/runs', '/runs/agent-test', '/tools/test', '/dashboard', '/memories', '/memories/missing/feedback'])('viewer cannot mutate %s', async path => {
    const store = new InMemoryStudioStore(); await seedUs2(store); const principal = { userId: 'viewer', tenantId: 'org-a' };
    const app = new Hono<{ Variables: PrincipalVariables }>();
    app.use('*', async (c, next) => { c.set('principal', principal); await next(); });
    app.use('*', requireOrganizationContext(store)); app.onError(respondWithApiError);
    for (const [prefix, router] of routers(store)) app.route(prefix, router);
    expect((await app.request(path, jsonRequest('POST', {}))).status).toBe(403);
  });

  test('proves foreign resource isolation for a member of two organizations', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');
    await seedUs2(store, 'org-b');
    const stamp = new Date().toISOString();
    await store.saveMembership({
      organizationId: 'org-a',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await store.saveMembership({
      organizationId: 'org-b',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });

    const runStore = new InMemoryRunStore();
    const runA: Run = {
      id: 'run-dual-org-a',
      workflowId: 'wf-1',
      status: 'completed',
      tenantId: 'org-a',
      ownerId: 'dualUser',
      startedAt: stamp,
      metadata: {},
    };
    runStore.create(runA, { principalId: 'dualUser', tenantId: 'org-a' });

    const runB: Run = {
      id: 'run-dual-org-b',
      workflowId: 'wf-1',
      status: 'completed',
      tenantId: 'org-b',
      ownerId: 'dualUser',
      startedAt: stamp,
      metadata: {},
    };
    runStore.create(runB, { principalId: 'dualUser', tenantId: 'org-b' });

    const executor = new RunExecutor(runStore);
    const routerA = createRunsRouter(executor, async () => null, store, () => ({ userId: 'dualUser', tenantId: 'org-a', organizationId: 'org-a' }));
    const resA1 = await routerA.app.request('/run-dual-org-a');
    expect(resA1.status).toBe(200);
    const resA2 = await routerA.app.request('/run-dual-org-b');
    expect(resA2.status).toBe(404);
    expect(await resA2.json()).toEqual({ error: 'Not found' });

    const routerB = createRunsRouter(executor, async () => null, store, () => ({ userId: 'dualUser', tenantId: 'org-b', organizationId: 'org-b' }));
    const resB1 = await routerB.app.request('/run-dual-org-b');
    expect(resB1.status).toBe(200);
    const resB2 = await routerB.app.request('/run-dual-org-a');
    expect(resB2.status).toBe(404);
    expect(await resB2.json()).toEqual({ error: 'Not found' });

    const listA = await (await routerA.app.request('/')).json();
    expect(listA.some((r: any) => r.id === 'run-dual-org-a')).toBe(true);
    expect(listA.some((r: any) => r.id === 'run-dual-org-b')).toBe(false);

    const listB = await (await routerB.app.request('/')).json();
    expect(listB.some((r: any) => r.id === 'run-dual-org-b')).toBe(true);
    expect(listB.some((r: any) => r.id === 'run-dual-org-a')).toBe(false);
  });
});

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('PostgreSQL US2 execution routes and foreign resource isolation', () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let store: PostgresStudioStore;
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;

  beforeAll(() => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
  });

  afterAll(() => {
    if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old;
  });

  beforeEach(async () => {
    schema = `exec_matrix_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
    store = new PostgresStudioStore(pool);

    for (const u of ['owner', 'admin', 'member', 'viewer', 'dualUser']) {
      await pool.query("INSERT INTO studio_users (id, email, password_hash, status) VALUES ($1, $2, 'hash', 'active')", [u, `${u}@test.local`]);
    }

    await seedUs2(store, 'org-a');
    await seedUs2(store, 'org-b');

    const stamp = new Date().toISOString();
    await store.saveMembership({
      organizationId: 'org-a',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await store.saveMembership({
      organizationId: 'org-b',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin && schema) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('proves foreign resource isolation on PostgreSQL for two-org member on execution routes', async () => {
    const runStore = new PostgresRunStore(pool, { leaseRenewalIntervalMs: 0 });
    const stamp = new Date().toISOString();
    const runA: Run = {
      id: 'run-dual-org-a',
      workflowId: 'wf-1',
      status: 'completed',
      tenantId: 'org-a',
      ownerId: 'dualUser',
      startedAt: stamp,
      metadata: {},
    };
    runStore.create(runA, { principalId: 'dualUser', tenantId: 'org-a' });

    const runB: Run = {
      id: 'run-dual-org-b',
      workflowId: 'wf-1',
      status: 'completed',
      tenantId: 'org-b',
      ownerId: 'dualUser',
      startedAt: stamp,
      metadata: {},
    };
    runStore.create(runB, { principalId: 'dualUser', tenantId: 'org-b' });

    const executor = new RunExecutor(runStore);
    const routerA = createRunsRouter(executor, async () => null, store, () => ({ userId: 'dualUser', tenantId: 'org-a', organizationId: 'org-a' }));
    const resA1 = await routerA.app.request('/run-dual-org-a');
    expect(resA1.status).toBe(200);
    const resA2 = await routerA.app.request('/run-dual-org-b');
    expect(resA2.status).toBe(404);
    expect(await resA2.json()).toEqual({ error: 'Not found' });

    const routerB = createRunsRouter(executor, async () => null, store, () => ({ userId: 'dualUser', tenantId: 'org-b', organizationId: 'org-b' }));
    const resB1 = await routerB.app.request('/run-dual-org-b');
    expect(resB1.status).toBe(200);
    const resB2 = await routerB.app.request('/run-dual-org-a');
    expect(resB2.status).toBe(404);
    expect(await resB2.json()).toEqual({ error: 'Not found' });

    const listA = await (await routerA.app.request('/')).json();
    expect(listA.some((r: any) => r.id === 'run-dual-org-a')).toBe(true);
    expect(listA.some((r: any) => r.id === 'run-dual-org-b')).toBe(false);

    const listB = await (await routerB.app.request('/')).json();
    expect(listB.some((r: any) => r.id === 'run-dual-org-b')).toBe(true);
    expect(listB.some((r: any) => r.id === 'run-dual-org-a')).toBe(false);

    runStore.close();
  });
});
