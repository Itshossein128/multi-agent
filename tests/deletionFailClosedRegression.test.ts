jest.unmock('../apps/server/src/api/shared/http');
import { nowIso } from '@multi-agent/types';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { RunOrganizationAccess } from '../apps/server/src/runtime/runOrganizationAccess';
import { seedUs2,jsonRequest } from './organizationUs2Fixtures';
import { OrganizationPurgeWorker } from '../apps/server/src/organization/organizationPurgeWorker';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemorySecretStore } from '../src/broker/secretStore';
import { InMemoryLeaseStore } from '../src/broker/leaseStore';
import { InMemoryMemoryStore } from '../src/memory/infrastructure/in-memory-memory-store';
import { InMemoryOrganizationStore } from '../apps/server/src/organization/organizationStore';
import { InMemoryBudgetStore } from '../apps/server/src/budgets/budgetStore';
test('11: unavailable cleanup rejects deletion before changing the organization or cached runs',async()=>{
  process.env.ORG_MEMBERSHIP_ENFORCEMENT='enforce';process.env.ORG_DELETION_ENABLED='true';
  const studio=new InMemoryStudioStore();await seedUs2(studio);
  const runs=new InMemoryRunStore();runs.create({id:'cached',workflowId:'wf',status:'queued',startedAt:nowIso(),tenantId:'org-a',ownerId:'owner',metadata:{}});
  const app=createStudioRouter(studio,()=>({userId:'owner',tenantId:'org-a'}));
  const response=await app.request('/organizations/current',jsonRequest('DELETE',{confirmationName:'org-a'}));
  expect(response.status).toBe(503);
  expect((await studio.getOrganizationProfile({userId:'owner',tenantId:'org-a'}))?.status).toBe('active');
  await expect(new RunOrganizationAccess(studio).assertRunActive(runs.get('cached')!.run)).resolves.toBeUndefined();
  expect((await app.request('/projects')).status).toBe(200);
});
test('11: purged profile cannot authorize cached organization-bound runs; status failures propagate',async()=>{
  const studio=new InMemoryStudioStore();await seedUs2(studio);
  await studio.purgeOrganizationData('org-a');
  await expect(new RunOrganizationAccess(studio).assertRunActive({tenantId:'org-a',ownerId:'owner',initiatorKind:'service'})).rejects.toMatchObject({code:'ORGANIZATION_ACCESS_REVOKED'});
  const setStatus=jest.spyOn(studio,'updateOrganizationStatus').mockRejectedValue(new Error('status failure'));
  const worker = new OrganizationPurgeWorker({studioStore:studio,runStore:new InMemoryRunStore(),secretStore:new InMemorySecretStore(),leaseStore:new InMemoryLeaseStore(),memoryStore:new InMemoryMemoryStore(),organizationStore:new InMemoryOrganizationStore(),budgetStore:new InMemoryBudgetStore(),workspaceCleanup:async()=>{}});
  await expect(worker.purgeOrganization('org-a')).rejects.toThrow('status failure');
  setStatus.mockRestore();
});

test('11: failed cleanup and verification retain deleting marker, resume cancels caches and removes only tenant workspace; neighboring budgets survive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'delete-regression-'));
  try {
    await mkdir(join(root,'org-a'));await mkdir(join(root,'org-b'));await writeFile(join(root,'org-a','work'),'a');await writeFile(join(root,'org-b','work'),'b');
    const studio=new InMemoryStudioStore();await seedUs2(studio);
    const runs=new InMemoryRunStore();runs.create({id:'active',workflowId:'wf',status:'running',startedAt:nowIso(),tenantId:'org-a',ownerId:'owner',metadata:{}});const signal=runs.signal('active');
    const budgets=new InMemoryBudgetStore();await budgets.setBudget({tenantId:'org-b',scope:'company',scopeId:'org-b',limitUsd:10,thresholdPercent:50});await budgets.reserve('neighbor','org-b',[{scope:'company',scopeId:'org-b'}],1);
    const secrets=new InMemorySecretStore();const deletion=jest.spyOn(secrets,'deleteTenantSecrets').mockRejectedValueOnce(new Error('external cleanup failed'));
    const worker=new OrganizationPurgeWorker({studioStore:studio,runStore:runs,secretStore:secrets,leaseStore:new InMemoryLeaseStore(),memoryStore:new InMemoryMemoryStore(),organizationStore:new InMemoryOrganizationStore(),budgetStore:budgets,workspaceStorageRoot:root});
    await expect(worker.purgeOrganization('org-a')).rejects.toThrow('external cleanup failed');expect(signal?.aborted).toBe(true);expect(runs.get('active')).toBeUndefined();
    expect((await studio.getOrganizationProfile({userId:'owner',tenantId:'org-a'}))?.status).toBe('deleting');
    const verify=jest.spyOn(worker,'assertClean').mockRejectedValueOnce(new Error('verification failed'));
    await expect(worker.resumePurge('org-a')).rejects.toThrow('verification failed');expect((await studio.getOrganizationProfile({userId:'owner',tenantId:'org-a'}))?.status).toBe('deleting');verify.mockRestore();
    expect((await worker.resumePurge('org-a')).status).toBe('completed');expect(await readFile(join(root,'org-b','work'),'utf8')).toBe('b');await expect(readFile(join(root,'org-a','work'))).rejects.toThrow();
    await budgets.settle('neighbor',.5,'org-b');expect((await budgets.list('org-b'))[0]).toMatchObject({spentUsd:.5,reservedUsd:0});deletion.mockRestore();
  }finally{await rm(root,{recursive:true,force:true});}
});
