jest.unmock('../apps/server/src/api/shared/http');
import { createAgentRecord, createSingleAgentWorkflow, nowIso } from '@multi-agent/types';
import { createRunsRouter } from '../apps/server/src/api/runs';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { RunOrganizationAccess } from '../apps/server/src/runtime/runOrganizationAccess';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

test('8: mounted browser cannot turn revoked user into service/schedule/trigger using metadata', async () => {
  process.env.ORG_MEMBERSHIP_ENFORCEMENT='enforce';
  const studio = new InMemoryStudioStore(); await seedUs2(studio);
  const principal = {userId:'member',tenantId:'org-a'};
  const agent=createAgentRecord(); const workflow=createSingleAgentWorkflow(agent,'forged initiator');
  await studio.saveAgent(agent,principal); await studio.saveWorkflow(workflow,principal);
  const runs=new InMemoryRunStore(); const access=new RunOrganizationAccess(studio);
  const used=jest.fn();
  const executor=new RunExecutor(runs,{async *execute(input){used();yield {type:'agent.completed' as const,timestamp:nowIso(),runId:input.runId,nodeId:input.nodeId,agentId:agent.id,payload:{content:'should not run'}};}},undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,access);
  const app=createRunsRouter(executor,undefined,studio,()=>principal).app;
  for(const kind of ['service','schedule','trigger']) {
    const response=await app.request('/',jsonRequest('POST',{workflow,agents:[agent],input:{},metadata:{initiatorKind:kind,triggerEventId:'forged',triggerEventType:'routine_tick',triggerDispatchKey:`forged-${kind}`}}));
    expect(response.status).toBe(202);
    const {runId}=await response.json() as {runId:string};
    expect(runs.get(runId)?.run.initiatorKind).toBe('user');
    const membership=await studio.getMembership('org-a','member'); await studio.saveMembership({...membership!,status:'removed',version:2});
    await expect(access.assertRunActive(runs.get(runId)!.run)).rejects.toMatchObject({code:'ORGANIZATION_ACCESS_REVOKED'});
    await studio.saveMembership({...membership!,status:'active',version:3});
  }
});

test('8: legacy stored service label without server provenance still revalidates membership',async()=>{
  const studio=new InMemoryStudioStore();await seedUs2(studio);
  const membership=await studio.getMembership('org-a','member');await studio.saveMembership({...membership!,status:'removed',version:2});
  await expect(new RunOrganizationAccess(studio).assertRunActive({tenantId:'org-a',ownerId:'member',initiatorKind:'service',metadata:{initiatorKind:'service',triggerEventId:'fake'}})).rejects.toMatchObject({code:'ORGANIZATION_ACCESS_REVOKED'});
});

test('8: forged mounted queued run is stopped after revocation before agent or credential use; retry stays denied',async()=>{
  const previous=process.env.WORKFLOW_MAX_CONCURRENT_RUNS;process.env.WORKFLOW_MAX_CONCURRENT_RUNS='1';process.env.ORG_MEMBERSHIP_ENFORCEMENT='enforce';
  const studio=new InMemoryStudioStore();await seedUs2(studio);
  const agent=createAgentRecord();const workflow=createSingleAgentWorkflow(agent,'queued revocation');const principal={userId:'member',tenantId:'org-a'};
  await studio.saveAgent(agent,principal);await studio.saveWorkflow(workflow,principal);
  let unblock!:()=>void;const block=new Promise<void>(r=>unblock=r);let started!:()=>void;const start=new Promise<void>(r=>started=r);
  const uses=jest.fn();const runs=new InMemoryRunStore();
  const executor=new RunExecutor(runs,{async *execute(input){uses(input.input);if((input.input as any).block){started();await block;}yield {type:'agent.completed' as const,timestamp:nowIso(),runId:input.runId,nodeId:input.nodeId,agentId:agent.id,payload:{content:'done'}};}},undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,new RunOrganizationAccess(studio));
  try{
    executor.start({workflow,agents:[agent],input:{block:true}},undefined,{userId:'owner',tenantId:'org-a'});await start;
    const app=createRunsRouter(executor,undefined,studio,()=>principal).app;
    const response=await app.request('/',jsonRequest('POST',{workflow,agents:[agent],input:{target:true},metadata:{initiatorKind:'service',triggerEventId:'spoof',triggerEventType:'routine_tick',triggerDispatchKey:'spoof'}}));expect(response.status).toBe(202);
    const {runId}=await response.json() as {runId:string};expect(runs.get(runId)?.run.status).toBe('queued');
    const membership=await studio.getMembership('org-a','member');await studio.saveMembership({...membership!,status:'removed',version:2});unblock();
    for(let i=0;i<100 && runs.get(runId)?.run.status==='queued';i++)await new Promise(r=>setTimeout(r,10));
    expect(runs.get(runId)?.run).toMatchObject({status:'failed',initiatorKind:'user'});expect(uses).toHaveBeenCalledTimes(1);
    await expect(executor.retry(runId)).rejects.toMatchObject({code:'ORGANIZATION_ACCESS_REVOKED'});
    const {RunAccessCheckpoint,checkpointedApiCredentials}=await import('../apps/server/src/runtime/runAccessCheckpoint');const checkpoint=new RunAccessCheckpoint();checkpoint.install(({runId,tenantId})=>executor.assertRunAccess(runId,tenantId));const resolve=jest.fn();
    await expect(checkpointedApiCredentials({resolve},checkpoint).resolve({provider:'openai',tenantId:'org-a',principalId:'member',runId,agentId:agent.id})).rejects.toMatchObject({code:'ORGANIZATION_ACCESS_REVOKED'});expect(resolve).not.toHaveBeenCalled();
  }finally{unblock();if(previous===undefined)delete process.env.WORKFLOW_MAX_CONCURRENT_RUNS;else process.env.WORKFLOW_MAX_CONCURRENT_RUNS=previous;}
});
