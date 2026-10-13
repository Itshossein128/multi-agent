import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

/** Independent policy declaration for all registered Studio routes. No production policy helper is used. */
const adminMutations = new Set([
  'PUT /budgets', 'PUT /organization/agents/:id', 'PATCH /organization/goals/:id',
  'PUT /agents/:id/heartbeat', 'POST /webhooks/triggers/:id/rotate-secret',
  'POST /webhooks/triggers', 'PUT /webhooks/triggers/:id', 'DELETE /webhooks/triggers/:id',
  'POST /organizations/current/members', 'PATCH /organizations/current/members/:userId', 'DELETE /organizations/current/members/:userId',
  'PATCH /organizations/current',
]);
const ownerOnlyMutations = new Set(['DELETE /organizations/current']);
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
        const executor = new RunExecutor(new InMemoryRunStore());
        const app = createStudioRouter(store, () => ({ userId: role, tenantId: 'org-a', organizationId: 'org-a' }), executor);
        const isOwnerOnly = ownerOnlyMutations.has(key);
        const isAdminMutation = adminMutations.has(key);
        const isPrivilegedRead = privilegedReads.has(key);

        let allowed = false;
        if (role === 'owner') {
          allowed = true;
        } else if (role === 'admin') {
          allowed = !isOwnerOnly;
        } else if (role === 'member') {
          allowed = !isOwnerOnly && !isAdminMutation && !isPrivilegedRead;
        } else if (role === 'viewer') {
          allowed = route.method === 'GET' && !isPrivilegedRead;
        }

        const res = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
        if (allowed) {
          expect(res.status).not.toBe(403);
          expect(res.status).not.toBe(500);
          if (path.includes('missing') || key === 'DELETE /organizations/current') {
            expect([400, 404]).toContain(res.status);
          } else if (route.method === 'GET') {
            expect(res.status).toBe(200);
          }
        } else {
          expect(res.status).toBe(403);
        }
      });
    }
    test(`non-member ${key}`, async () => {
      const store = new InMemoryStudioStore(); await seedUs2(store);
      const executor = new RunExecutor(new InMemoryRunStore());
      const app = createStudioRouter(store, () => ({ userId: 'stranger', tenantId: 'org-a', organizationId: 'org-a' }), executor);
      const res = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
      expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'Not found' });
    });
    test(`removed ${key}`, async () => {
      const store = new InMemoryStudioStore(); await seedUs2(store);
      const m = (await store.getMembership('org-a', 'member'))!;
      await store.saveMembership({ ...m, status: 'removed', version: 2 });
      const executor = new RunExecutor(new InMemoryRunStore());
      const app = createStudioRouter(store, () => ({ userId: 'member', tenantId: 'org-a', organizationId: 'org-a' }), executor);
      const res = await app.request(path, route.method === 'GET' ? {} : jsonRequest(route.method, {}));
      expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'Not found' });
    });
  }
  test('registered route inventory is nonempty and every route receives the matrix', () => { expect(scoped.length).toBeGreaterThan(60); expect(scoped.length + bootstrap.size).toBe(routes.length); });
});

describe('Foreign resource isolation for member of two organizations', () => {
  async function seedTwoOrgs(store: InMemoryStudioStore) {
    await seedUs2(store, 'org-a');
    await seedUs2(store, 'org-b');
    const stamp = new Date().toISOString();
    await store.saveMembership({
      organizationId: 'org-a',
      userId: 'dual-user',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await store.saveMembership({
      organizationId: 'org-b',
      userId: 'dual-user',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });

    await store.saveWorkflow({
      id: 'wf-a',
      name: 'Workflow A',
      nodes: [],
      edges: [],
      ownerId: 'dual-user',
      tenantId: 'org-a',
      updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-a' });
    await store.saveAgent({
      id: 'agent-a',
      name: 'Agent A',
      record: {},
      ownerId: 'dual-user',
      tenantId: 'org-a',
      isSystem: false,
      createdAt: stamp,
      updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-a' });
    await store.saveProject({
      id: 'proj-a',
      name: 'Project A',
      description: '',
      tenantId: 'org-a',
      createdAt: stamp,
      updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-a' });

    await store.saveWorkflow({
      id: 'wf-b',
      name: 'Workflow B',
      nodes: [],
      edges: [],
      ownerId: 'dual-user',
      tenantId: 'org-b',
      updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-b' });
    await store.saveAgent({
      id: 'agent-b',
      name: 'Agent B',
      record: {},
      ownerId: 'dual-user',
      tenantId: 'org-b',
      isSystem: false,
      createdAt: stamp,
      updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-b' });
    await store.saveProject({
      id: 'proj-b',
      name: 'Project B',
      description: '',
      tenantId: 'org-b',
      createdAt: stamp,
      updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-b' });
  }

  it('allows access to current organization resources and returns 404 for foreign organization resources', async () => {
    const store = new InMemoryStudioStore();
    await seedTwoOrgs(store);
    const executor = new RunExecutor(new InMemoryRunStore());

    // In org-a context:
    const appA = createStudioRouter(store, () => ({ userId: 'dual-user', tenantId: 'org-a', organizationId: 'org-a' }), executor);

    // org-a resources succeed (200)
    expect((await appA.request('/workflows/wf-a')).status).toBe(200);
    expect((await appA.request('/agents/agent-a')).status).toBe(200);
    expect((await appA.request('/projects/proj-a')).status).toBe(200);

    // org-b resources return 404 (without existence disclosure)
    const resWfB = await appA.request('/workflows/wf-b');
    expect(resWfB.status).toBe(404);
    expect(await resWfB.json()).toEqual({ error: 'Not found' });

    const resAgentB = await appA.request('/agents/agent-b');
    expect(resAgentB.status).toBe(404);

    const resProjB = await appA.request('/projects/proj-b');
    expect(resProjB.status).toBe(404);

    // Attempted mutation on foreign resource returns 404 and does not mutate
    const resPatchProjB = await appA.request('/projects/proj-b', jsonRequest('PATCH', { name: 'Compromised' }));
    expect(resPatchProjB.status).toBe(404);
    const unchangedProjB = await store.getProject('proj-b', { userId: 'owner', tenantId: 'org-b' });
    expect(unchangedProjB?.name).toBe('Project B');

    const resDeleteWfB = await appA.request('/workflows/wf-b', { method: 'DELETE' });
    expect(resDeleteWfB.status).toBe(404);
    const unchangedWfB = await store.getWorkflow('wf-b', { userId: 'dual-user', tenantId: 'org-b' });
    expect(unchangedWfB).not.toBeNull();

    // Now switch to org-b context:
    const appB = createStudioRouter(store, () => ({ userId: 'dual-user', tenantId: 'org-b', organizationId: 'org-b' }), executor);

    // org-b resources succeed (200)
    expect((await appB.request('/workflows/wf-b')).status).toBe(200);
    expect((await appB.request('/agents/agent-b')).status).toBe(200);
    expect((await appB.request('/projects/proj-b')).status).toBe(200);

    // org-a resources return 404
    expect((await appB.request('/workflows/wf-a')).status).toBe(404);
    expect((await appB.request('/agents/agent-a')).status).toBe(404);
    expect((await appB.request('/projects/proj-a')).status).toBe(404);
  });
});

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('PostgreSQL Studio route matrix and foreign resource isolation', () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let store: PostgresStudioStore;

  beforeEach(async () => {
    schema = `rt_matrix_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
    store = new PostgresStudioStore(pool);

    for (const u of ['owner', 'admin', 'member', 'viewer', 'dual-user']) {
      await pool.query("INSERT INTO studio_users (id, email, password_hash, status) VALUES ($1, $2, 'hash', 'active')", [u, `${u}@test.local`]);
    }

    const stamp = new Date().toISOString();
    await store.createOrganizationProfile({
      id: 'org-a', name: 'Org A', slug: 'org-a', status: 'active',
      description: '', config: {}, ownerId: 'owner', createdAt: stamp, updatedAt: stamp,
    }, { userId: 'owner', tenantId: 'org-a' });

    await store.createOrganizationProfile({
      id: 'org-b', name: 'Org B', slug: 'org-b', status: 'active',
      description: '', config: {}, ownerId: 'owner', createdAt: stamp, updatedAt: stamp,
    }, { userId: 'owner', tenantId: 'org-b' });

    await store.saveMembership({ organizationId: 'org-a', userId: 'dual-user', role: 'member', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp });
    await store.saveMembership({ organizationId: 'org-b', userId: 'dual-user', role: 'member', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp });

    await store.saveWorkflow({
      id: 'wf-pg-a', name: 'WF PG A', nodes: [], edges: [], ownerId: 'dual-user', tenantId: 'org-a', updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-a' });

    await store.saveWorkflow({
      id: 'wf-pg-b', name: 'WF PG B', nodes: [], edges: [], ownerId: 'dual-user', tenantId: 'org-b', updatedAt: stamp,
    } as any, { userId: 'dual-user', tenantId: 'org-b' });
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin && schema) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('proves foreign resource isolation on PostgreSQL for a member of two organizations', async () => {
    const executor = new RunExecutor(new InMemoryRunStore());
    const appA = createStudioRouter(store, () => ({ userId: 'dual-user', tenantId: 'org-a', organizationId: 'org-a' }), executor);

    const resA = await appA.request('/workflows/wf-pg-a');
    expect(resA.status).toBe(200);

    const resBFromA = await appA.request('/workflows/wf-pg-b');
    expect(resBFromA.status).toBe(404);

    const appB = createStudioRouter(store, () => ({ userId: 'dual-user', tenantId: 'org-b', organizationId: 'org-b' }), executor);
    const resB = await appB.request('/workflows/wf-pg-b');
    expect(resB.status).toBe(200);

    const resAFromB = await appB.request('/workflows/wf-pg-a');
    expect(resAFromB.status).toBe(404);
  });
});
