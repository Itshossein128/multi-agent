import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { nowIso } from '@multi-agent/types';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { OrganizationMembershipService } from '../apps/server/src/api/studio/organizationMembershipService';

const url = process.env.MEMORY_TEST_DATABASE_URL;
(url ? describe : describe.skip)('US2 PostgreSQL membership atomicity', () => {
  let admin: Pool, pool: Pool, schema: string, store: PostgresStudioStore;
  const org = randomUUID(), owners = [randomUUID(), randomUUID()], target = randomUUID();
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(async () => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
    schema = `us2_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: url }); await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
    await runStudioMigrations(pool); store = new PostgresStudioStore(pool);
    for (const user of [...owners, target]) await pool.query("INSERT INTO studio_users (id, email, password_hash, status) VALUES ($1, $2, 'hash', 'active')", [user, `${user}@test.local`]);
    const stamp = nowIso();
    await store.createOrganizationProfile({ id: org, name: 'Acme', description: '', config: {}, ownerId: owners[0], status: 'active', slug: 'acme', createdAt: stamp, updatedAt: stamp }, { tenantId: org, userId: owners[0] });
    await store.saveMembership({ organizationId: org, userId: owners[1], role: 'owner', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp });
  }, 60000);
  afterAll(async () => {
    await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old;
  });
  test('separate store instances serialize owner-count reads and cannot demote both owners', async () => {
    const results = await Promise.allSettled(owners.map(userId => new OrganizationMembershipService(new PostgresStudioStore(pool)).change(userId, { role: 'admin' }, { userId, tenantId: org })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect((await store.listMemberships(org)).filter(m => m.role === 'owner' && m.status === 'active')).toHaveLength(1);
    expect((await store.listOrganizationAudit(org)).filter(e => e.action === 'membership.changed')).toHaveLength(1);
  });
  test('invite by registered email, acceptance and append-only audit are persisted; failed audit rolls back', async () => {
    const owner = (await store.listMemberships(org)).find(m => m.role === 'owner')!;
    const service = new OrganizationMembershipService(store); const principal = { userId: owner.userId, tenantId: org };
    await service.invite({ email: `${target}@test.local`, role: 'viewer' }, principal);
    expect(await store.listInvitationsForUser(target)).toHaveLength(1);
    await service.accept(org, { userId: target, tenantId: 'unused' });
    expect(await store.getMembership(org, target)).toMatchObject({ status: 'active', version: 2 });
    await pool.query(`CREATE FUNCTION reject_member_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private storage failure'; END; $$`);
    await pool.query('CREATE TRIGGER fail_audit BEFORE INSERT ON studio_organization_audit FOR EACH ROW EXECUTE FUNCTION reject_member_audit()');
    await expect(service.change(target, { role: 'member' }, principal)).rejects.toThrow('private storage failure');
    expect(await store.getMembership(org, target)).toMatchObject({ role: 'viewer', version: 2 });
    await pool.query('DROP TRIGGER fail_audit ON studio_organization_audit');
    await expect(pool.query("UPDATE studio_organization_audit SET action = 'tampered' WHERE organization_id = $1", [org])).rejects.toThrow();
    await expect(pool.query('DELETE FROM studio_organization_audit WHERE organization_id = $1', [org])).rejects.toThrow();
  });
  test('synthetic identity prefixes confer no PostgreSQL private-resource access; typed service stays tenant-bound', async () => {
    const owner = (await store.listMemberships(org)).find(m => m.role === 'owner')!;
    await store.saveWorkflow({ id: 'private-workflow', name: 'Private', nodes: [], edges: [], updatedAt: nowIso(), ownerId: owner.userId, tenantId: org }, { userId: owner.userId, tenantId: org });
    for (const userId of ['system-imposter', 'internal:agent:imposter']) {
      expect(await store.getWorkflow('private-workflow', { userId, tenantId: org })).toBeNull();
      expect(await store.listWorkflows({ userId, tenantId: org })).toEqual([]);
    }
    const service = { userId: 'worker', tenantId: org, principalKind: 'service' as const };
    expect(await store.getWorkflow('private-workflow', service)).not.toBeNull();
    expect(await store.listWorkflows(service)).toHaveLength(1);
    expect(await store.getWorkflow('private-workflow', { ...service, tenantId: 'foreign' })).toBeNull();
  });

});
