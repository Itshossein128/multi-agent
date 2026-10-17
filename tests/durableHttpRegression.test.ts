import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Hono } from 'hono';
import { createAgentRecord, createSingleAgentWorkflow, nowIso } from '@multi-agent/types';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { withOrganization, scopedDbClient } from '../src/studio/infrastructure/withOrganization';
import { createPostgresPool } from '../apps/server/src/infrastructure/postgresPool';
import { PostgresRunStore } from '../apps/server/src/runtime/store/postgresRunStore';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { createRunsRouter } from '../apps/server/src/api/runs';

const db = process.env.MEMORY_TEST_DATABASE_URL;
(db ? describe : describe.skip)('finding 10: detached HTTP durability under FORCE RLS', () => {
  let admin: Pool; let restricted: ReturnType<typeof createPostgresPool>; let schema: string;
  beforeAll(async () => {
    schema = `durable_http_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: db, options: `-c search_path=${schema},public` });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await runStudioMigrations(admin);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO studio_app; GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO studio_app; GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO studio_app`);
    restricted = createPostgresPool(db!, { role: 'studio_app', options: `-c search_path=${schema},public`, max: 4 });
  }, 60000);
  afterAll(async () => { await restricted?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });

  test('202 admits a committed run; execution owns no request client and persists exact output, events and renewed lease', async () => {
    const store = new PostgresRunStore(restricted, { leaseDurationMs: 10000, leaseRenewalIntervalMs: 0 });
    let finish!: () => void; const gate = new Promise<void>(r => finish = r);
    let borrowed: unknown; let started!: () => void; const start = new Promise<void>(r => started = r);
    const executor = new RunExecutor(store, { async *execute(input) {
      borrowed = Boolean(scopedDbClient(restricted)); started(); await gate;
      yield { type: 'agent.completed' as const, timestamp: new Date().toISOString(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { content: 'durable exact answer' } };
    } });
    const principal = { userId: 'owner', tenantId: 'org-a' };
    const app = new Hono();
    app.use('*', async (_c, next) => withOrganization(restricted, 'org-a', 'user', async () => next()));
    app.route('/runs', createRunsRouter(executor, undefined, undefined, () => principal).app);
    try {
      const response = await app.request('/runs/agent-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: createAgentRecord(), input: { question: 'hello' } }) });
      expect(response.status).toBe(202);
      const { runId } = await response.json() as { runId: string };
      const admitted = await admin.query('SELECT status FROM studio_runs WHERE id=$1', [runId]);
      expect(admitted.rows).toHaveLength(1);
      await start;
      expect(borrowed).toBe(false);
      expect(await store.renewActiveLeases()).toContain(runId);
      finish();
      for (let i=0; i<100 && store.get(runId)?.run.status !== 'completed'; i++) await new Promise(r => setTimeout(r, 10));
      await store.flush();
      const durable = await admin.query('SELECT status, output, execution_heartbeat_at FROM studio_runs WHERE id=$1', [runId]);
      expect(durable.rows[0]).toMatchObject({ status: 'completed', output: { content: 'durable exact answer' } });
      const fresh = new PostgresRunStore(restricted, { leaseRenewalIntervalMs: 0 });
      await withOrganization(restricted, 'org-a', 'service', () => fresh.hydrate());
      expect(fresh.get(runId)?.run.output).toEqual({ content: 'durable exact answer' });
      expect(fresh.events(runId).map(e=>e.type)).toEqual(['run.created','run.started','agent.completed','run.completed']);
      expect(fresh.events(runId).map(e=>e.sequence)).toEqual([1,2,3,4]);
      fresh.close();
    } finally { finish(); await new Promise(r=>setTimeout(r,50)); await store.flush().catch(()=>{}); store.close(); }
  }, 20000);
  test('fresh restricted stores recover only expired leases and fence duplicate execution', async()=>{
    const agent=createAgentRecord();const workflow=createSingleAgentWorkflow(agent,'durable recovery');
    const original=new PostgresRunStore(restricted,{instanceId:'original',leaseRenewalIntervalMs:0});
    original.create({id:'recover-queued',workflowId:workflow.id,status:'queued',startedAt:nowIso(),metadata:{},tenantId:'org-a',ownerId:'owner'},undefined,{workflow,agents:[agent]});await original.flush();
    const a=new PostgresRunStore(restricted,{instanceId:'recovery-a',leaseRenewalIntervalMs:0});
    const b=new PostgresRunStore(restricted,{instanceId:'recovery-b',leaseRenewalIntervalMs:0});
    await withOrganization(restricted,'org-a','service',()=>a.hydrate());await withOrganization(restricted,'org-a','service',()=>b.hydrate());
    expect(await withOrganization(restricted,'org-a','service',()=>a.claimOrphanedRuns())).toEqual([]);
    await admin.query("UPDATE studio_runs SET execution_lease_expires_at=now()-interval '1 second' WHERE id='recover-queued'");
    const claimed=await Promise.all([a,b].map(store=>withOrganization(restricted,'org-a','service',()=>store.claimOrphanedRuns())));
    expect(claimed.flat().map(r=>r.id)).toEqual(['recover-queued']);
    let executions=0;
    const runtime={async *execute(input:any){executions++;yield {type:'agent.completed' as const,timestamp:nowIso(),runId:input.runId,nodeId:input.nodeId,agentId:agent.id,payload:{content:'recovered once'}};}};
    new RunExecutor(a,runtime).resumeQueuedRun('recover-queued');new RunExecutor(b,runtime).resumeQueuedRun('recover-queued');
    for(let i=0;i<200;i++){const row=(await admin.query("SELECT status FROM studio_runs WHERE id='recover-queued'")).rows[0];if(row.status==='completed')break;await new Promise(r=>setTimeout(r,10));}
    await a.flush();await b.flush();expect(executions).toBe(1);
    expect((await admin.query("SELECT status,output FROM studio_runs WHERE id='recover-queued'")).rows[0]).toMatchObject({status:'completed'});
    original.update('recover-queued',{status:'failed'});await original.flush();
    expect((await admin.query("SELECT status FROM studio_runs WHERE id='recover-queued'")).rows[0].status).toBe('completed');
    original.close();a.close();b.close();
  },20000);

});
