import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

/** Independent policy declaration for all registered Studio routes. No production policy helper is used. */
const adminMutations = new Set([
  'PUT /budgets', 'PUT /organization/agents/:id', 'PATCH /organization/goals/:id',
  'PUT /agents/:id/heartbeat', 'POST /webhooks/triggers/:id/rotate-secret',
  'POST /webhooks/triggers', 'PUT /webhooks/triggers/:id', 'DELETE /webhooks/triggers/:id',
  'POST /organizations/current/members', 'PATCH /organizations/current/members/:userId', 'DELETE /organizations/current/members/:userId',
]);
const privilegedReads = new Set(['GET /organizations/current/audit', 'GET /agents/:id/diagnostics']);
const bootstrap = new Set(['POST /organizations', 'GET /me/organizations', 'GET /me/invitations', 'POST /organizations/:organizationId/invitations/accept']);
const routes = createStudioRouter(new InMemoryStudioStore(), () => null).routes.filter(r => r.method !== 'ALL');
const scoped = routes.filter(r => !bootstrap.has(`${r.method} ${r.path}`));

describe('US2 every registered Studio route × role and membership', () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(() => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; });
  afterAll(() => { if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old; });
  for (const route of scoped) {
    const key = `${route.method} ${route.path}`;
    const path = route.path.replace(/:[^/]+/g, 'missing');
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      test(`${role} ${key}`, async () => {
        const store = new InMemoryStudioStore(); await seedUs2(store);
        const app = createStudioRouter(store, () => ({ userId: role, tenantId: 'org-a' }));
        const allowed = role === 'owner' || role === 'admin' || (role === 'member' && !adminMutations.has(key) && !privilegedReads.has(key)) || (role === 'viewer' && route.method === 'GET' && !privilegedReads.has(key));
        const res = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
        if (allowed) expect(res.status).not.toBe(403); else expect(res.status).toBe(403);
      });
    }
    test(`non-member ${key}`, async () => {
      const store = new InMemoryStudioStore(); await seedUs2(store);
      const app = createStudioRouter(store, () => ({ userId: 'stranger', tenantId: 'org-a' }));
      const res = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
      expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'Not found' });
    });
    test(`removed ${key}`, async () => {
      const store = new InMemoryStudioStore(); await seedUs2(store);
      const m = (await store.getMembership('org-a', 'member'))!;
      await store.saveMembership({ ...m, status: 'removed', version: 2 });
      const app = createStudioRouter(store, () => ({ userId: 'member', tenantId: 'org-a' }));
      const res = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
      expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'Not found' });
    });
  }
  test('registered route inventory is nonempty and every route receives the matrix', () => { expect(scoped.length).toBeGreaterThan(60); expect(scoped.length + bootstrap.size).toBe(routes.length); });
});
