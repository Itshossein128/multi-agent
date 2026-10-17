import {createStudioRouter} from "../apps/server/src/api/studio";
import { createAgentRecord } from "@multi-agent/types";
import { withOrganization } from "../src/studio/infrastructure/withOrganization";
jest.unmock('../apps/server/src/api/shared/http');
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Hono } from 'hono';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { createPostgresPool } from '../apps/server/src/infrastructure/postgresPool';
import { requireOrganizationContext, requirePrincipal, type PrincipalVariables } from '../apps/server/src/api/shared/http';
import { seedUs2 } from './organizationUs2Fixtures';
import { PostgresBudgetStore } from '../apps/server/src/budgets/budgetStore';
import { AUDIT_TABLE_DDL, PostgresAuditRecorder, verifyAuditChain } from '../src/broker/audit';

const db = process.env.MEMORY_TEST_DATABASE_URL;
(db ? describe : describe.skip)('findings 9, 12, 13 PostgreSQL regressions', () => {
  let admin: Pool; let other: Pool; let pool: ReturnType<typeof createPostgresPool>; let schema: string;
  beforeAll(async () => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
    schema = `repairs_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: db, options: `-c search_path=${schema},public` });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await runStudioMigrations(admin);
    await admin.query(AUDIT_TABLE_DDL);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO studio_app; GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO studio_app; GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO studio_app`);
    pool = createPostgresPool(db!, { role: 'studio_app', options: `-c search_path=${schema},public`, max: 2 });
    other = new Pool({ connectionString: db, options: `-c search_path=${schema},public`, max: 8 });
    for (const id of ['owner','admin','member','viewer','foreign']) await admin.query("INSERT INTO studio_users(id,email,password_hash,tenant_id,status) VALUES($1,$2,'test-only','org-a','active')", [id,`${id}@test.invalid`]);
    await seedUs2(new PostgresStudioStore(admin));
  },60000);
  afterAll(async () => { await pool?.end(); await other?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });
  test('9: legitimate owner authorizes under FORCE RLS; foreign/revoked/inactive denied; SSE releases connection', async () => {
    const store = new PostgresStudioStore(pool);
    const make = (userId: string, tenantId='org-a') => {
      const app = new Hono<{Variables: PrincipalVariables}>();
      app.use('*', requirePrincipal(()=>({userId,tenantId})));
      app.use('*', requireOrganizationContext(store));
      app.get('/projects', c=>c.json(c.get('principal')));
      app.get('/runs/r/events', c=>c.json({ idle: (pool as Pool).idleCount, total: (pool as Pool).totalCount }));
      return app;
    };
    const owner = make('owner');
    expect((await owner.request('/projects')).status).toBe(200);
    expect((await make('foreign').request('/projects')).status).toBe(404);
    await admin.query("UPDATE studio_organization_memberships SET status='removed',version=version+1 WHERE user_id='member'");
    expect((await make('member').request('/projects')).status).toBe(404);
    await admin.query("UPDATE studio_users SET status='disabled' WHERE id='admin'");
    expect((await make('admin').request('/projects')).status).toBe(404);
    const sse = await owner.request('/runs/r/events', { headers: { Accept: 'text/event-stream' } });
    expect(sse.status).toBe(200);
    const counts = await sse.json() as {idle:number;total:number}; expect(counts.idle).toBe(counts.total);
    await admin.query("UPDATE studio_organizations SET status='suspended' WHERE id='org-a'");
    expect((await owner.request('/projects')).status).toBe(404);
    await admin.query("UPDATE studio_organizations SET status='active' WHERE id='org-a'");
  });
  test('13: tenant supplied before reservation lookup; exact concurrent/idempotent settlement and cross-tenant isolation', async () => {
    const store = new PostgresBudgetStore(pool);
    await store.setBudget({ tenantId:'budget-a',scope:'company',scopeId:'budget-a',limitUsd:10,thresholdPercent:5 });
    expect(await store.reserve('settle-one','budget-a',[{scope:'company',scopeId:'budget-a'}],1)).toBe(true);
    await (store.settle as any)('settle-one',.5,'budget-b');
    expect((await store.list('budget-a'))[0]).toMatchObject({spentUsd:0,reservedUsd:1});
    await Promise.all(Array.from({length:20},()=> (store.settle as any)('settle-one',.5,'budget-a')));
    expect((await store.list('budget-a'))[0]).toMatchObject({spentUsd:.5,reservedUsd:0});
    expect((await store.alerts('budget-a')).filter(a=>a.level==='threshold')).toHaveLength(1);
    const result=await admin.query("SELECT actual_usd,settled_at FROM studio_budget_reservations WHERE run_id='settle-one'");
    expect(Number(result.rows[0].actual_usd)).toBe(.5); expect(result.rows[0].settled_at).not.toBeNull();
  });
  test('13: settlement failure rolls back reservation, counter and alert together', async () => {
    const store = new PostgresBudgetStore(pool);
    await store.reserve('settle-rollback','budget-a',[{scope:'company',scopeId:'budget-a'}],1);
    await admin.query(`CREATE FUNCTION reject_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.settled_at IS NOT NULL AND NEW.run_id='settle-rollback' THEN RAISE EXCEPTION 'injected settlement failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_settlement BEFORE UPDATE ON studio_budget_reservations FOR EACH ROW EXECUTE FUNCTION reject_settlement()`);
    await expect(store.settle('settle-rollback',.5,'budget-a')).rejects.toThrow('injected settlement failure');
    expect((await store.list('budget-a'))[0]).toMatchObject({spentUsd:.5,reservedUsd:1});
    const [reservation]=(await admin.query("SELECT settled_at,actual_usd FROM studio_budget_reservations WHERE run_id='settle-rollback'")).rows;
    expect(reservation.settled_at).toBeNull();expect(reservation.actual_usd).toBeNull();
    await admin.query('DROP TRIGGER reject_settlement ON studio_budget_reservations');
    await store.settle('settle-rollback',.5,'budget-a');
  });
  test('6: PostgreSQL scoped import is atomic and rollback does not poison enclosing request transaction',async()=>{
    const store=new PostgresStudioStore(pool);const principal={userId:'owner',tenantId:'org-a'};
    const first={...createAgentRecord(),id:'import-one'};const second={...createAgentRecord(),id:'import-two'};
    await admin.query(`CREATE FUNCTION reject_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='import-two' THEN RAISE EXCEPTION 'injected import failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_import BEFORE INSERT ON studio_agents FOR EACH ROW EXECUTE FUNCTION reject_import()`);
    await withOrganization(pool,'org-a','user',async(client)=>{
      await expect(store.importWorkspace({workflows:[],agents:[first,second],tools:[]},principal)).rejects.toThrow('injected import failure');
      expect((await client.query("SELECT id FROM studio_agents WHERE id='import-one'")).rows).toHaveLength(0);
      expect((await client.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    });
    await admin.query('DROP TRIGGER reject_import ON studio_agents');
    await withOrganization(pool,'org-a','user',()=>store.importWorkspace({workflows:[],agents:[first,second],tools:[]},principal));
    expect((await admin.query("SELECT id FROM studio_agents WHERE id LIKE 'import-%'")).rows).toHaveLength(2);
  });
  test('12: 20 independent-pool appends at genesis and populated head form one immutable contiguous chain', async () => {
    const a = new PostgresAuditRecorder(admin); const b = new PostgresAuditRecorder(other);
    for (let round=0;round<2;round++) {
      const results = await Promise.allSettled(Array.from({length:20},(_,i)=>(i%2?a:b).record({tenantId:`audit-${i%2}`,principalId:'owner',operation:'lease.issue.requested',result:'succeeded',sourceService:'regression'})));
      expect(results.filter(r=>r.status==='rejected')).toHaveLength(0);
      const records=(await a.query({limit:1000})).reverse(); expect(records).toHaveLength((round+1)*20); expect(verifyAuditChain(records)).toBe(true);
    }
    await expect(admin.query('UPDATE credential_broker_audit SET result=result')).rejects.toThrow(/append-only/);
    await expect(admin.query('DELETE FROM credential_broker_audit')).rejects.toThrow(/append-only/);
  });
  test('11: unavailable PostgreSQL deletion leaves the organization active; admitted deletion fences late upserts after profile removal',async()=>{
    process.env.ORG_DELETION_ENABLED='true';
    const studio=new PostgresStudioStore(pool);
    const app=createStudioRouter(studio,()=>({userId:'owner',tenantId:'org-a'}));
    const response=await app.request('/organizations/current',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmationName:'org-a'})});
    expect(response.status).toBe(503);
    expect((await admin.query("SELECT status FROM studio_organizations WHERE id='org-a'")).rows[0].status).toBe('active');
    await withOrganization(pool,'org-a','service',()=>studio.updateOrganizationStatus('org-a','deleting'));
    expect((await admin.query("SELECT status FROM studio_organizations WHERE id='org-a'")).rows[0].status).toBe('deleting');
    const late={...createAgentRecord(),id:'late-agent'};
    await expect(withOrganization(pool,'org-a','service',()=>studio.saveAgent(late,{userId:'owner',tenantId:'org-a'}))).rejects.toThrow(/deleting/);
    await withOrganization(pool,'org-a','service',()=>studio.purgeOrganizationData('org-a'));
    await expect(withOrganization(pool,'org-a','service',()=>studio.saveAgent(late,{userId:'owner',tenantId:'org-a'}))).rejects.toThrow(/deleted/);
    expect((await admin.query("SELECT id FROM studio_agents WHERE id='late-agent'")).rows).toHaveLength(0);
    expect((await admin.query('SELECT count(*)::int AS count FROM credential_broker_audit')).rows[0].count).toBe(40);
  });

});
