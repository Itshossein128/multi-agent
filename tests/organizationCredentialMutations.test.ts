import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertNoCredentials, createAgentRecord, createToolRecord, type AgentRecord, type ToolRecord } from '@multi-agent/types';
import type { StudioStore } from '../src/studio/contracts';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

const backend = { type: 'webhook' as const, url: 'https://example.test/agent', credentialAlias: 'org-alias' };
const operations = ['create', 'rename', 'reconfigure', 'clear', 'duplicate', 'delete', 'import'] as const;
const roles = ['owner', 'admin', 'member', 'viewer'] as const;
const alias = (record: AgentRecord | ToolRecord | null) => record && ('backend' in record ? (record.backend.type === 'webhook' ? record.backend.credentialAlias : undefined) : record.configuration.connection);

test('credential aliases remain bounded identifiers, and raw secrets stay forbidden', () => {
  expect(() => assertNoCredentials({ backend })).not.toThrow();
  for (const value of [
    { backend: { credentialAlias: 'a'.repeat(65) } },
    { backend: { credentialAlias: '../foreign' } },
    { backend: { credentialAlias: { token: 'hidden-value' } } },
    { backend: { credentialAlias: 'sk-abcdefghijklmnop' } },
    { backend: { credentialAlias: 'org-alias', apiKey: 'hidden-value' } },
  ]) expect(() => assertNoCredentials(value)).toThrow();
});

for (const adapter of ['memory', 'postgres'] as const) {
  const suite = adapter === 'postgres' && !process.env.MEMORY_TEST_DATABASE_URL ? describe.skip : describe;
  suite(`T083 ${adapter} credential-bearing mutations`, () => {
    const previous = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
    let store: StudioStore, pool: Pool, admin: Pool, schema: string, org: string;
    beforeAll(async () => {
      process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
      if (adapter === 'postgres') {
        admin = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL }); schema = `credential_mutations_${randomUUID().replace(/-/g, '')}`;
        await admin.query(`CREATE SCHEMA "${schema}"`);
        pool = new Pool({ connectionString: process.env.MEMORY_TEST_DATABASE_URL, options: `-c search_path=${schema},public` }); await runStudioMigrations(pool);
        for (const user of roles) await pool.query("INSERT INTO studio_users (id,email,password_hash,status) VALUES ($1,$2,'hash','active')", [user, `${user}@test.local`]);
      }
    }, 60000);
    beforeEach(async () => {
      store = adapter === 'memory' ? new InMemoryStudioStore() : new PostgresStudioStore(pool);
      org = `org-${randomUUID()}`; await seedUs2(store, org);
    });
    afterAll(async () => {
      await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
      if (previous === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = previous;
    });
    const seed = async (kind: 'agents' | 'tools') => {
      const record = kind === 'agents'
        ? { ...createAgentRecord({ name: 'Shared', backend }), id: randomUUID(), tenantId: org }
        : { ...createToolRecord({ name: 'Shared', category: 'database' }), id: randomUUID(), configuration: { connection: 'org-alias' }, tenantId: org };
      if (adapter === 'postgres') await pool.query(`INSERT INTO studio_${kind} (id,name,record,owner_id,tenant_id,is_system,created_at,updated_at) VALUES ($1,$2,$3::jsonb,NULL,$4,false,$5::timestamptz,$6::timestamptz)`, [record.id, record.name, JSON.stringify(record), org, record.createdAt, record.updatedAt]);
      else if (kind === 'agents') await store.saveAgent(record as AgentRecord); else await store.saveTool(record as ToolRecord);
      return record;
    };
    const read = (kind: 'agents' | 'tools', id: string) => kind === 'agents' ? store.getAgent(id) : store.getTool(id);

    for (const kind of ['agents', 'tools'] as const) for (const role of roles) {
      test.each(operations)(`${role} ${kind} %s checks credentials permission and side effects`, async operation => {
        const record = await seed(kind), original = await read(kind, record.id);
        const app = createStudioRouter(store, () => ({ userId: role, tenantId: org }));
        const credentialBody = kind === 'agents' ? { name: 'Connected', backend } : { name: 'Connected', category: 'database', configuration: { connection: 'org-alias' } };
        const newId = randomUUID(), plainId = randomUUID();
        let path = `/${kind}/${record.id}`, method = 'PATCH', body: unknown = { name: 'Renamed' };
        if (operation === 'create') { path = `/${kind}`; method = 'POST'; body = credentialBody; }
        if (operation === 'duplicate') { path += '/duplicate'; method = 'POST'; body = {}; }
        if (operation === 'delete') { method = 'DELETE'; body = undefined; }
        if (operation === 'reconfigure') body = kind === 'agents' ? { backend: { ...backend, credentialAlias: 'changed-alias' } } : { configuration: { connection: 'changed-alias' } };
        if (operation === 'clear') body = kind === 'agents' ? { backend: { type: 'api', provider: 'openai', model: 'gpt-4.1-mini' } } : { configuration: {} };
        if (operation === 'import') {
          path = '/workspace/import'; method = 'POST';
          const plain = kind === 'agents' ? createAgentRecord({ name: 'Plain' }) : createToolRecord({ name: 'Plain' });
          body = { [kind]: [{ ...plain, id: plainId }, { ...record, id: newId }] };
        }
        const response = await app.request(path, body === undefined ? { method } : jsonRequest(method, body));
        if (role === 'member' || role === 'viewer') {
          expect(response.status).toBe(403);
          expect(await read(kind, record.id)).toEqual(original);
          expect(await read(kind, newId)).toBeNull(); expect(await read(kind, plainId)).toBeNull();
          expect((await (kind === 'agents' ? store.listAgents({ userId: role, tenantId: org }) : store.listTools({ userId: role, tenantId: org })))).toHaveLength(1);
        } else {
          expect(response.status).toBe(operation === 'create' || operation === 'duplicate' ? 201 : 200);
          const result = await response.json();
          if (operation === 'delete') expect(await read(kind, record.id)).toBeNull();
          else {
            const saved = await read(kind, operation === 'import' ? newId : operation === 'create' || operation === 'duplicate' ? result.id : record.id);
            expect(saved).not.toBeNull();
            expect(alias(saved)).toBe(operation === 'clear' ? undefined : operation === 'reconfigure' ? 'changed-alias' : 'org-alias');
          }
        }
      });
    }
    test.each(['agents', 'tools'] as const)('members retain credential-free %s CRUD, duplicate and import', async kind => {
      const app = createStudioRouter(store, () => ({ userId: 'member', tenantId: org }));
      const created = await app.request(`/${kind}`, jsonRequest('POST', { name: 'Plain' })); expect(created.status).toBe(201);
      const record = await created.json();
      expect((await app.request(`/${kind}/${record.id}`, jsonRequest('PATCH', { name: 'Renamed' }))).status).toBe(200);
      expect((await app.request(`/${kind}/${record.id}/duplicate`, jsonRequest('POST', {}))).status).toBe(201);
      expect((await app.request('/workspace/import', jsonRequest('POST', { [kind]: [{ ...record, id: randomUUID() }] }))).status).toBe(200);
      expect((await app.request(`/${kind}/${record.id}`, { method: 'DELETE' })).status).toBe(200);
    });
  });
}
