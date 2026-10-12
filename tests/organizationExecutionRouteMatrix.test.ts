import { Hono } from 'hono';
import { createRunsRouter } from '../apps/server/src/api/runs';
import { createToolsRouter } from '../apps/server/src/api/tools';
import { createDashboardRouter } from '../apps/server/src/api/dashboard';
import { createMemoriesRouter } from '../apps/server/src/api/memories';
import { requireOrganizationContext, respondWithApiError, type PrincipalVariables } from '../apps/server/src/api/shared/http';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

function routers(store: InMemoryStudioStore, principal?: { userId: string; tenantId: string }): [string, Hono<any>][] {
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
        if (allowed) expect(response.status).not.toBe(403); else expect(response.status).toBe(403);
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
});
