import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createAgentRecord, createToolRecord, nowIso } from '@multi-agent/types';
import type { StudioPrincipal, StudioStore } from '../src/studio/contracts';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

type Fixture = { principal: StudioPrincipal; projectId: string; taskId: string; stamp: string };
const project = (id: string, f: Fixture) => ({ id, tenantId: f.principal.tenantId, ownerId: f.principal.userId,
  name: 'Original', nameSource: 'manual' as const, description: '', status: 'active' as const,
  settings: {}, createdAt: f.stamp, updatedAt: f.stamp });
const cases = [
  { name: 'workflow', write: (s: StudioStore, id: string, f: Fixture) => s.saveWorkflow({ id, name: 'Original', nodes: [], edges: [], updatedAt: f.stamp }, f.principal), read: (s: StudioStore, id: string) => s.getWorkflow(id) },
  { name: 'agent', write: (s: StudioStore, id: string, f: Fixture) => s.saveAgent({ ...createAgentRecord({ name: 'Original' }), id }, f.principal), read: (s: StudioStore, id: string) => s.getAgent(id) },
  { name: 'tool', write: (s: StudioStore, id: string, f: Fixture) => s.saveTool({ ...createToolRecord({ name: 'Original' }), id }, f.principal), read: (s: StudioStore, id: string) => s.getTool(id) },
  { name: 'project', write: (s: StudioStore, id: string, f: Fixture) => s.saveProject(project(id, f), f.principal), read: (s: StudioStore, id: string) => s.getProject(id) },
  { name: 'task', write: (s: StudioStore, id: string, f: Fixture) => s.saveTask({ id, title: 'Original', description: '', priority: 'medium', status: 'backlog', assignedAgent: null,
    createdAt: f.stamp, updatedAt: f.stamp, dependencies: [], output: null, retryCount: 0, paused: false, projectId: f.projectId }, f.principal), read: (s: StudioStore, id: string) => s.getTask(id) },
  { name: 'workspace', write: (s: StudioStore, id: string, f: Fixture) => s.saveWorkspace({ ...project(id, f), projectId: f.projectId, settingsOverrides: {}, effectiveSettings: {}, overriddenKeys: [] }, f.principal), read: (s: StudioStore, id: string) => s.getWorkspace(id) },
  { name: 'repository', write: (s: StudioStore, id: string, f: Fixture) => s.saveProjectRepository({ id, tenantId: f.principal.tenantId, projectId: f.projectId, name: 'Original', source: 'https://example.test/repo', defaultBranch: 'main', status: 'active', createdAt: f.stamp, updatedAt: f.stamp }, f.principal), read: (s: StudioStore, id: string) => s.getProjectRepository(id) },
  { name: 'comment', write: (s: StudioStore, id: string, f: Fixture) => s.saveComment({ id, tenantId: f.principal.tenantId, taskId: f.taskId, authorId: f.principal.userId, authorType: 'user', content: 'Original', mentions: [], createdAt: f.stamp, updatedAt: f.stamp }, f.principal), read: (s: StudioStore, id: string) => s.getComment(id) },
  { name: 'routine', write: (s: StudioStore, id: string, f: Fixture) => s.saveRoutine({ id, tenantId: f.principal.tenantId, ownerId: f.principal.userId, name: 'Original', description: '', scheduleType: 'interval', scheduleExpr: '60', timezone: 'UTC', targetType: 'agent', targetId: 'agent', inputPayload: {}, misfirePolicy: 'skip', enabled: false, createdAt: f.stamp, updatedAt: f.stamp }, f.principal), read: (s: StudioStore, id: string) => s.getRoutine(id) },
  { name: 'webhook', write: (s: StudioStore, id: string, f: Fixture) => s.saveWebhookTrigger({ id, tenantId: f.principal.tenantId, ownerId: f.principal.userId, name: 'Original', description: '', secretHash: 'hash', targetType: 'agent', targetId: 'agent', enabled: false, rateLimitPerMinute: 10, createdAt: f.stamp, updatedAt: f.stamp }, f.principal), read: (s: StudioStore, id: string) => s.getWebhookTrigger(id) },
];

for (const adapter of ['memory', 'postgres'] as const) {
  const suite = adapter === 'postgres' && !process.env.MEMORY_TEST_DATABASE_URL ? describe.skip : describe;
  suite(`T081 ${adapter} writes preserve the organization boundary`, () => {
    let store: StudioStore, pool: Pool, admin: Pool, schema: string, a: Fixture, b: Fixture;
    const previous = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
    beforeAll(async () => {
      process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
      if (adapter === 'postgres') {
        admin = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL });
        schema = `write_isolation_${randomUUID().replace(/-/g, '')}`;
        await admin.query(`CREATE SCHEMA "${schema}"`);
        pool = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
        await runStudioMigrations(pool);
        for (const user of ['owner', 'admin', 'member', 'viewer']) {
          await pool.query("INSERT INTO studio_users (id, email, password_hash, status) VALUES ($1, $2, 'hash', 'active')", [user, `${user}@test.local`]);
        }
      }
    }, 60000);
    beforeEach(async () => {
      store = adapter === 'memory' ? new InMemoryStudioStore() : new PostgresStudioStore(pool);
      const fixture = async (org: string): Promise<Fixture> => {
        await seedUs2(store, org);
        const f = { principal: { tenantId: org, userId: 'owner' }, projectId: randomUUID(), taskId: randomUUID(), stamp: nowIso() };
        await store.saveProject(project(f.projectId, f), f.principal);
        await cases.find(c => c.name === 'task')!.write(store, f.taskId, f);
        return f;
      };
      a = await fixture(`a-${randomUUID()}`); b = await fixture(`b-${randomUUID()}`);
    });
    afterAll(async () => {
      await pool?.end();
      if (admin) { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
      if (previous === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = previous;
    });

    test.each(cases)('$name refuses a foreign ID without modifying the stored record', async c => {
      const id = randomUUID(); await c.write(store, id, a); const original = await c.read(store, id);
      await expect(c.write(store, id, b)).rejects.toThrow('Access denied');
      expect(await c.read(store, id)).toEqual(original);
      await expect(c.write(store, id, a)).resolves.toBeDefined();
    });

    test.each(cases)('$name internal writes with explicit record tenant cannot overwrite a foreign ID', async c => {
      const id = randomUUID(); await c.write(store, id, a); const original = await c.read(store, id);
      const internal = new Proxy(store, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          if (!String(key).startsWith('save')) return value.bind(target);
          return (record: Record<string, unknown>, principal: StudioPrincipal) => value.call(target, { ...record, tenantId: principal.tenantId, ownerId: principal.userId });
        },
      });
      await expect(c.write(internal, id, b)).rejects.toThrow();
      expect(await c.read(store, id)).toEqual(original);
      await expect(c.write(internal, id, a)).resolves.toBeDefined();
    });

    test.each(['workflow', 'agent', 'tool'])('%s import rejects foreign/private/system collisions atomically through HTTP', async kind => {
      const c = cases.find(c => c.name === kind)!;
      for (const collision of ['foreign', 'private', ...(kind === 'workflow' ? [] : ['system'])]) {
        const id = randomUUID();
        if (adapter !== 'memory' || collision !== 'system') await c.write(store, id, collision === 'foreign' ? b : a);
        if (collision === 'system') {
          if (adapter === 'postgres') await pool.query(`UPDATE studio_${kind}s SET is_system=true, tenant_id=NULL, owner_id=NULL, record=record || '{"isSystem":true,"tenantId":null,"ownerId":null}'::jsonb WHERE id=$1`, [id]);
          else if (kind === 'agent') await store.saveAgent({ ...createAgentRecord({ name: 'System' }), id, isSystem: true });
          else await store.saveTool({ ...createToolRecord({ name: 'System' }), id, isSystem: true });
        }
        const original = await c.read(store, id);
        const freeId = randomUUID(), collection = `${kind}s`;
        const app = createStudioRouter(store, () => ({ userId: 'member', tenantId: a.principal.tenantId }));
        const response = await app.request('/workspace/import', jsonRequest('POST', { [collection]: [{ ...original, id: freeId }, { ...original, name: 'Overwrite' }] }));
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'Not found' });
        expect(await c.read(store, id)).toEqual(original);
        expect(await c.read(store, freeId)).toBeNull();
      }
    });

    test('valid imports create personal copies and update only their own IDs', async () => {
      const id = randomUUID(), agent = { ...createAgentRecord({ name: 'Imported' }), id };
      const app = createStudioRouter(store, () => a.principal);
      for (const name of ['Imported', 'Updated']) expect((await app.request('/workspace/import', jsonRequest('POST', { agents: [{ ...agent, name }] }))).status).toBe(200);
      expect(await store.getAgent(id)).toMatchObject({ name: 'Updated', tenantId: a.principal.tenantId, ownerId: 'owner', isSystem: false });
    });

    test('concurrent HTTP imports reject the losing organization uniformly and roll back its batch', async () => {
      const id = randomUUID(), freeA = randomUUID(), freeB = randomUUID();
      const responses = await Promise.all([a, b].map((f, index) => {
        const app = createStudioRouter(store, () => f.principal);
        return app.request('/workspace/import', jsonRequest('POST', { agents: [
          { ...createAgentRecord({ name: 'Free' }), id: index === 0 ? freeA : freeB },
          { ...createAgentRecord({ name: 'Collision' }), id },
        ] }));
      }));
      expect(responses.map(r => r.status).sort()).toEqual([200, 404]);
      const winner = responses[0].status === 200 ? a : b;
      expect(await store.getAgent(id)).toMatchObject({ tenantId: winner.principal.tenantId });
      expect(await store.getAgent(responses[0].status === 200 ? freeB : freeA)).toBeNull();
      expect(await responses.find(r => r.status === 404)!.json()).toEqual({ error: 'Not found' });
    });

    if (adapter === 'postgres') {
      test.each(cases)('$name concurrently created with one ID cannot move between organizations', async c => {
        const id = randomUUID(); let release!: () => void, reads = 0;
        const barrier = new Promise<void>(resolve => { release = resolve; });
        const racingPool = {
          connect: () => pool.connect(),
          query: async (sql: string, values?: unknown[]) => {
            const result = await pool.query(sql, values);
            if (/^SELECT (?:is_system, )?tenant_id.*WHERE id = \$1/.test(sql) && values?.[0] === id) {
              if (++reads === 2) release();
              await barrier;
            }
            return result;
          },
        };
        const concurrent = new PostgresStudioStore(racingPool);
        const results = await Promise.allSettled([c.write(concurrent, id, a), c.write(concurrent, id, b)]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
        expect(failure.reason.message).toContain('Access denied');
        const winner = results[0].status === 'fulfilled' ? a : b;
        expect(await c.read(store, id)).toMatchObject({ tenantId: winner.principal.tenantId });
      });
    }
  });
}
