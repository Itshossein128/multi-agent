jest.unmock('../apps/server/src/api/shared/http');
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { createPostgresPool } from '../apps/server/src/infrastructure/postgresPool';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { OrganizationPurgeWorker } from '../apps/server/src/organization/organizationPurgeWorker';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { PostgresOrganizationStore } from '../apps/server/src/organization/organizationStore';
import { PostgresBudgetStore } from '../apps/server/src/budgets/budgetStore';
import { InMemorySecretStore } from '../src/broker/secretStore';
import { InMemoryLeaseStore } from '../src/broker/leaseStore';
import { InMemoryMemoryStore } from '../src/memory/infrastructure/in-memory-memory-store';
import { withOrganization } from '../src/studio/infrastructure/withOrganization';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nowIso } from '@multi-agent/types';
import { createOrganizationPurgeWorker } from '../apps/server/src/organization/purgeComposition';
import { createBrokerHarness } from './helpers/brokerHarness';
import { createBrokerApp, StaticServiceAuth } from '../src/broker/httpApp';
import { HttpCredentialGateway } from '../src/security/credentialGateway';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { requirePrincipal, requireOrganizationContext } from '../apps/server/src/api/shared/http';
import { createInternalPrincipalAssertion } from '../src/auth/internalPrincipal';
import { PostgresRunStore } from '../apps/server/src/runtime/store/postgresRunStore';
import { prepareOrganizationCheckpoints } from '../apps/server/src/organization/checkpointCleanup';

const db = process.env.MEMORY_TEST_DATABASE_URL;
(db ? describe : describe.skip)('organization lifecycle completion with actual RLS roles', () => {
  let admin: Pool, appPool: ReturnType<typeof createPostgresPool>, workerPool: ReturnType<typeof createPostgresPool>;
  let schema: string, root: string, store: PostgresStudioStore;
  const body = (value: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  beforeEach(async () => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; process.env.ORG_DELETION_ENABLED = 'true';
    schema = `lifecycle_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: db, options: `-c search_path=${schema},public` });
    await admin.query(`CREATE SCHEMA ${schema}`); await runStudioMigrations(admin);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO studio_app,studio_worker; GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO studio_app,studio_worker; GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schema} TO studio_app,studio_worker`);
    for (const id of ['owner', 'guest', 'outsider']) await admin.query("INSERT INTO studio_users(id,email,password_hash,status) VALUES($1,$2,'unused','active')", [id,`${id}@test.invalid`]);
    const bootstrap = new PostgresStudioStore(admin), stamp = nowIso();
    for (const id of ['org-a', 'org-b']) await bootstrap.createOrganizationProfile({id,name:id,slug:id,status:'active',description:'',config:{},ownerId:'owner',createdAt:stamp,updatedAt:stamp},{userId:'owner',tenantId:id});
    await bootstrap.saveMembership({organizationId:'org-b',userId:'guest',role:'member',status:'invited',version:1,createdAt:stamp,updatedAt:stamp});
    appPool = createPostgresPool(db!, {role:'studio_app',max:2,options:`-c search_path=${schema},public`});
    workerPool = createPostgresPool(db!, {role:'studio_worker',options:`-c search_path=${schema},public`});
    store = new PostgresStudioStore(appPool); root = await mkdtemp(join(tmpdir(),'lifecycle-workspaces-'));
  },60000);
  afterEach(async () => { await appPool?.end(); await workerPool?.end(); await admin?.query(`DROP SCHEMA ${schema} CASCADE`); await admin?.end(); if(root)await rm(root,{recursive:true,force:true}); });

  test('bootstrap creates an organization and lists all own organizations under studio_app', async () => {
    const client = await appPool.connect();
    try {
      await client.query(`CREATE TEMP TABLE studio_organizations (LIKE ${schema}.studio_organizations)`);
      expect((await client.query('SELECT id FROM studio_user_organizations($1)', ['owner'])).rows).toEqual([{id:'org-a'},{id:'org-b'}]);
    } finally { await client.query('DROP TABLE IF EXISTS pg_temp.studio_organizations'); client.release(); }
    const app = createStudioRouter(store,()=>({userId:'owner',tenantId:'org-a'}));
    const list = await app.request('/me/organizations'); expect(list.status).toBe(200);
    expect((await list.json() as {id:string}[]).map(o=>o.id)).toEqual(['org-a','org-b']);
    const creator = createStudioRouter(store,()=>({userId:'guest',tenantId:'org-new'}));
    const created = await creator.request('/organizations',body({name:'New organization',slug:'new-organization'}));
    expect(created.status).toBe(201);
    expect((await admin.query("SELECT role,status FROM studio_organization_memberships WHERE organization_id='org-new' AND user_id='guest'")).rows[0]).toEqual({role:'owner',status:'active'});
    expect((await admin.query("SELECT action FROM studio_organization_audit WHERE organization_id='org-new'")).rows[0].action).toBe('organization.created');
    expect((await appPool.query('SELECT id FROM studio_organizations')).rows).toEqual([]);
  });
  test('invitation discovery returns only the authenticated user invitations with organization details', async () => {
    const guest = createStudioRouter(store,()=>({userId:'guest',tenantId:'guest'}));
    const response=await guest.request('/me/invitations'); expect(response.status).toBe(200);
    expect(await response.json()).toEqual([expect.objectContaining({organizationId:'org-b',userId:'guest',organization:expect.objectContaining({id:'org-b'})})]);
    const foreign=createStudioRouter(store,()=>({userId:'outsider',tenantId:'outsider'}));
    expect(await (await foreign.request('/me/invitations')).json()).toEqual([]);
    const accepted=await guest.request('/organizations/org-b/invitations/accept',body({}));expect(accepted.status).toBe(200);
    expect((await guest.request('/me/organizations')).status).toBe(200);
  });
  test('unsupported deletion is rejected before marking the organization or deleting its runs', async () => {
    const app=createStudioRouter(store,()=>({userId:'owner',tenantId:'org-a'}));
    const result=await app.request('/organizations/current',{...body({confirmationName:'org-a'}),method:'DELETE'});
    expect(result.status).toBe(503);
    expect((await admin.query("SELECT status FROM studio_organizations WHERE id='org-a'")).rows[0].status).toBe('active');
  });
  test('checkpoint setup works for the owning non-bypass worker role', async () => {
    await admin.query(`GRANT CREATE ON SCHEMA ${schema} TO studio_worker`);
    await workerPool.query('CREATE TABLE checkpoints(thread_id text); CREATE TABLE checkpoint_blobs(thread_id text); CREATE TABLE checkpoint_writes(thread_id text)');
    await expect(prepareOrganizationCheckpoints(workerPool, schema)).resolves.toBeUndefined();
    expect((await admin.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='studio_checkpoint_fence' AND tgrelid IN ($1::regclass,$2::regclass,$3::regclass)", [`${schema}.checkpoints`,`${schema}.checkpoint_blobs`,`${schema}.checkpoint_writes`])).rows[0].count).toBe(3);
  });
  test('fully wired PostgreSQL deletion completes and worker discovery finds interrupted deletions', async () => {
    const runs=new PostgresRunStore(workerPool,{leaseRenewalIntervalMs:0});runs.create({id:'cached',workflowId:'wf',tenantId:'org-a',ownerId:'owner',status:'running',startedAt:nowIso(),metadata:{}});
    runs.create({id:'neighbor-run',workflowId:'wf',tenantId:'org-b',ownerId:'owner',status:'running',startedAt:nowIso(),metadata:{}});
    await runs.flush();
    // LangGraph uses run ids as checkpoint thread ids; keep its payloads tenant-scoped too.
    await admin.query('CREATE TABLE checkpoints(thread_id text, payload text); CREATE TABLE checkpoint_blobs(thread_id text, payload text); CREATE TABLE checkpoint_writes(thread_id text, payload text)');
    for(const table of ['checkpoints','checkpoint_blobs','checkpoint_writes'])await admin.query(`INSERT INTO ${table} VALUES('cached','private'),('neighbor-run','neighbor')`);
    await prepareOrganizationCheckpoints(admin, schema);
    await prepareOrganizationCheckpoints(admin, schema); // Idempotent startup.
    await admin.query("INSERT INTO checkpoints VALUES('cached','active checkpoint')");
    const worker=new OrganizationPurgeWorker({studioStore:store,runStore:runs,organizationStore:new PostgresOrganizationStore(appPool),budgetStore:new PostgresBudgetStore(appPool),secretStore:new InMemorySecretStore(),leaseStore:new InMemoryLeaseStore(),memoryStore:new InMemoryMemoryStore(),workspaceStorageRoot:root,discoveryPool:workerPool});
    await withOrganization(appPool,'org-a','service',()=>store.updateOrganizationStatus('org-a','deleting'));
    await expect(admin.query("INSERT INTO checkpoints VALUES('cached','late')")).rejects.toThrow(/deleting/);
    expect(await worker.findPendingPurges()).toContain('org-a');
    expect((await worker.resumePurge('org-a')).status).toBe('completed');expect(runs.get('cached')).toBeUndefined();
    expect((await admin.query("SELECT id FROM studio_runs WHERE tenant_id='org-a'")).rows).toEqual([]);
    for(const table of ['checkpoints','checkpoint_blobs','checkpoint_writes'])expect((await admin.query(`SELECT thread_id FROM ${table}`)).rows).toEqual([{thread_id:'neighbor-run'}]);
    expect(runs.get('neighbor-run')?.run.status).toBe('running');
    await expect(admin.query("INSERT INTO checkpoints VALUES('neighbor-run','still active')")).resolves.toBeDefined();
    await expect(admin.query("INSERT INTO checkpoints VALUES('cached','late-after-removal')")).rejects.toThrow(/does not exist/);
    expect((await admin.query("SELECT id FROM studio_organizations WHERE id='org-a'")).rows).toEqual([]);
    expect((await admin.query("SELECT id FROM studio_organizations WHERE id='org-b'")).rows).toHaveLength(1);
  });
  test('the server composition accepts failed cleanup as pending and a restarted recovery worker completes it', async () => {
    const memory=new InMemoryMemoryStore(), runs=new InMemoryRunStore();
    runs.create({id:'active-run',workflowId:'wf',tenantId:'org-a',ownerId:'owner',status:'running',startedAt:nowIso(),metadata:{}});
    const signal=runs.signal('active-run');
    await memory.insert({id:'memory-a',tenantId:'org-a',kind:'semantic',visibility:'organization',content:'private content',contentHash:'hash-a',namespace:{scope:'organization',id:'org-a'},source:{type:'system'},importance:5,status:'active',version:1,createdAt:nowIso(),updatedAt:nowIso()});
    const secrets=new InMemorySecretStore([{tenantId:'org-a',provider:'database',alias:'main',value:'fake-private-secret'},{tenantId:'org-b',provider:'database',alias:'main',value:'fake-neighbor-secret'}]);
    const broker=createBrokerHarness({secrets});
    const brokerApp=createBrokerApp({service:broker.service,auth:new StaticServiceAuth([{token:'purge-scoped-token',name:'cleanup',scopes:['tenants:purge']}])});
    const credentials=new HttpCredentialGateway('https://broker.internal','purge-scoped-token',async(input,init)=>brokerApp.fetch(new Request(String(input),init)));
    const budgets=new PostgresBudgetStore(appPool); await budgets.setBudget({tenantId:'org-b',scope:'company',scopeId:'org-b',limitUsd:10,thresholdPercent:80});
    await mkdir(join(root,'org-a'));await mkdir(join(root,'org-b'));await writeFile(join(root,'org-a','work'),'private');await writeFile(join(root,'org-b','work'),'neighbor');
    const compose=()=>createOrganizationPurgeWorker({studioStore:store,runStore:runs,organizationStore:new PostgresOrganizationStore(appPool),budgetStore:budgets,discoveryPool:workerPool,credentialCleanup:credentials,memory:{purgeTenantMemories:tenant=>memory.deleteTenantMemories(tenant)}},{STUDIO_WORKSPACE_STORAGE_ROOT:root});
    const worker=compose();
    const app=new Hono();const secret='composed-lifecycle-principal-secret';
    app.use('*',requirePrincipal(request=>require('../apps/server/src/auth/principal').resolveRequestPrincipal(request,secret)));
    app.use('*',requireOrganizationContext(store));
    app.route('/studio',createStudioRouter(store,undefined,undefined,undefined,undefined,undefined,worker));
    jest.spyOn(secrets,'deleteTenantSecrets').mockRejectedValueOnce(new Error('transient Vault outage'));
    const response=await app.request('/studio/organizations/current',{method:'DELETE',headers:{'Content-Type':'application/json','X-Multi-Agent-Principal':createInternalPrincipalAssertion({userId:'owner',tenantId:'org-a'},secret)},body:JSON.stringify({confirmationName:'org-a'})});
    expect(response.status).toBe(202);expect(await response.json()).toEqual({status:'pending',organizationId:'org-a'});
    expect(signal?.aborted).toBe(true);
    expect((await admin.query("SELECT status FROM studio_organizations WHERE id='org-a'")).rows[0].status).toBe('deleting');
    const restarted=compose();
    try {
      restarted.startRecovery(20);
      for(let i=0;i<200;i++){if(!(await admin.query("SELECT id FROM studio_organizations WHERE id='org-a'")).rows.length)break;await new Promise(r=>setTimeout(r,10));}
      expect((await admin.query("SELECT id FROM studio_organizations WHERE id='org-a'")).rows).toEqual([]);
    } finally { await restarted.stopRecovery(); }
    expect(await memory.get('org-a','memory-a')).toBeNull();
    await expect(secrets.getSecret({tenantId:'org-a',provider:'database',alias:'main'})).rejects.toThrow();
    expect((await secrets.getSecret({tenantId:'org-b',provider:'database',alias:'main'})).value).toBe('fake-neighbor-secret');
    await expect(readFile(join(root,'org-a','work'))).rejects.toThrow();expect(await readFile(join(root,'org-b','work'),'utf8')).toBe('neighbor');
    expect(await budgets.list('org-b')).toHaveLength(1);
  });
});
