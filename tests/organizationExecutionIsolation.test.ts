import { createEdge, createEmptyDefinition, createNode, nowIso, type WorkflowDefinition } from '@multi-agent/types';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import {
  ORGANIZATION_ACCESS_REVOKED,
  RunOrganizationAccess,
} from '../apps/server/src/runtime/runOrganizationAccess';
import {
  RunAccessCheckpoint,
  checkpointedApiCredentials,
} from '../apps/server/src/runtime/runAccessCheckpoint';
import { RoutineScheduler } from '../apps/server/src/triggers/routineScheduler';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import type { RoutineRecord } from '@multi-agent/types';
import { seedUs2 } from './organizationUs2Fixtures';

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function simpleWorkflow(): WorkflowDefinition {
  const input = createNode('input', { x: 0, y: 0 });
  const output = createNode('output', { x: 1, y: 0 });
  return {
    ...createEmptyDefinition(),
    nodes: [input, output],
    edges: [createEdge({ source: input.id, target: output.id })],
  };
}

function approvalWorkflow(): WorkflowDefinition {
  const input = createNode('input', { x: 0, y: 0 });
  const approval = createNode('approval', { x: 1, y: 0 });
  approval.config = { message: 'Approve to continue?', approvalType: 'manual', timeoutSeconds: 300 };
  const output = createNode('output', { x: 2, y: 0 });
  return {
    ...createEmptyDefinition(),
    nodes: [input, approval, output],
    edges: [
      createEdge({ source: input.id, target: approval.id }),
      createEdge({ source: approval.id, target: output.id }),
    ],
  };
}

function removedMember(store: InMemoryStudioStore, org = 'org-a', userId = 'member') {
  return store.getMembership(org, userId).then((membership) =>
    store.saveMembership({ ...membership!, status: 'removed', version: membership!.version + 1, removedAt: nowIso() }),
  );
}

function suspendOrganization(store: InMemoryStudioStore, org = 'org-a') {
  const organizations = (store as unknown as { organizations: Map<string, { status: string }> }).organizations;
  const profile = organizations.get(org);
  if (!profile) throw new Error('organization fixture missing');
  profile.status = 'suspended';
}

describe('US3 execution isolation — initiator identity and D-5 revocation policy', () => {
  test('T045 a run records its initiator kind and the membership version at start', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, new RunOrganizationAccess(store));

    const runId = executor.start({ workflow: simpleWorkflow(), agents: [], input: {} }, undefined,
      { userId: 'member', tenantId: 'org-a' });
    await waitFor(() => ['completed', 'failed', 'cancelled'].includes(runStore.get(runId)!.run.status));

    const run = runStore.get(runId)!.run as { initiatorKind?: string; membershipVersionAtStart?: number };
    expect(run.initiatorKind).toBe('user');
    expect(run.membershipVersionAtStart).toBe(1);
  });

  test('T045 in-flight run of a removed initiator stops at approval resume with ORGANIZATION_ACCESS_REVOKED and keeps task and history', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    const principal = { userId: 'member', tenantId: 'org-a' };
    await store.saveTask({
      id: 'task-keep',
      title: 'Keep me',
      description: '',
      priority: 'high',
      status: 'running',
      assignedAgent: null,
      dependencies: [],
      output: null,
      retryCount: 0,
      paused: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      projectId: 'project-1',
      workspaceId: null,
      tenantId: 'org-a',
      runId: 'pending',
    }, principal);

    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, new RunOrganizationAccess(store));
    const runId = executor.start({ workflow: approvalWorkflow(), agents: [], input: {}, taskId: 'task-keep' },
      undefined, principal);
    await waitFor(() => runStore.get(runId)?.run.status === 'waiting_for_human');
    const approval = runStore.listApprovals(runId)[0];
    expect(approval.status).toBe('requested');

    await removedMember(store);
    executor.resolveApproval(runId, approval.id, { decision: 'approved', response: 'ship it' });

    await waitFor(() => runStore.get(runId)!.run.status === 'failed');
    const entry = runStore.get(runId)!;
    expect(entry.run.result?.error?.code).toBe(ORGANIZATION_ACCESS_REVOKED);
    expect(entry.run.error).toContain(ORGANIZATION_ACCESS_REVOKED);
    // D-5: task and run history stay in the organization.
    const eventTypes = entry.events.map((event) => event.type);
    expect(eventTypes).toContain('human_approval.requested');
    expect(eventTypes).toContain('run.created');
    expect(eventTypes).toContain('run.failed');
    expect(eventTypes).not.toContain('run.completed');
    const task = await store.getTask('task-keep', { userId: 'owner', tenantId: 'org-a' });
    expect(task).not.toBeNull();
    expect(task!.status).not.toBe('completed');
  });

  test('T045 retry after initiator removal fails with ORGANIZATION_ACCESS_REVOKED and creates no new run', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, new RunOrganizationAccess(store));
    const principal = { userId: 'member', tenantId: 'org-a' };
    const runId = executor.start({ workflow: approvalWorkflow(), agents: [], input: {} }, undefined, principal);
    await waitFor(() => runStore.get(runId)?.run.status === 'waiting_for_human');
    executor.cancel(runId);
    await waitFor(() => runStore.get(runId)!.run.status === 'cancelled');
    const runsBefore = runStore.list().length;

    await removedMember(store);
    const failure = await (async () => {
      try {
        await executor.retry(runId);
        return null;
      } catch (error) {
        return error as { code?: string; message?: string };
      }
    })();

    expect(failure?.code).toBe(ORGANIZATION_ACCESS_REVOKED);
    expect(failure?.message).toContain(ORGANIZATION_ACCESS_REVOKED);
    expect(runStore.list().length).toBe(runsBefore);
  });

  test('T045 a queued run restored after restart does not execute once the initiator lost access', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    const runStore = new InMemoryRunStore();
    runStore.create({
      id: 'run-queued-revoked',
      workflowId: 'wf-revoked',
      status: 'queued',
      startedAt: nowIso(),
      input: {},
      metadata: {},
      ownerId: 'member',
      tenantId: 'org-a',
    }, undefined, { workflow: approvalWorkflow(), agents: [] });

    await removedMember(store);
    const executor = new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, new RunOrganizationAccess(store));
    expect(executor.resumeQueuedRun('run-queued-revoked')).toBe(true);

    await waitFor(() => runStore.get('run-queued-revoked')!.run.status === 'failed');
    const entry = runStore.get('run-queued-revoked')!;
    expect(entry.run.result?.error?.code).toBe(ORGANIZATION_ACCESS_REVOKED);
    expect(entry.run.error).toContain(ORGANIZATION_ACCESS_REVOKED);
    expect(entry.events.map((event) => event.type)).not.toContain('human_approval.requested');
  });

  test('T045 no new credential lease is issued after the initiator loses access', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, new RunOrganizationAccess(store));
    const principal = { userId: 'member', tenantId: 'org-a' };
    const runId = executor.start({ workflow: approvalWorkflow(), agents: [], input: {} }, undefined, principal);
    await waitFor(() => runStore.get(runId)?.run.status === 'waiting_for_human');

    await removedMember(store);
    const checkpoint = new RunAccessCheckpoint();
    checkpoint.install(({ runId: guardedRunId }) => executor.assertRunAccess(guardedRunId));
    const base = { resolve: jest.fn(async () => 'sk-leased-key') };
    const guarded = checkpointedApiCredentials(base, checkpoint);

    const failure = await guarded
      .resolve({ provider: 'openai', tenantId: 'org-a', principalId: 'member', runId, agentId: 'agent-1' })
      .then(() => null, (error: unknown) => error as { code?: string });
    expect(failure?.code).toBe(ORGANIZATION_ACCESS_REVOKED);
    expect(base.resolve).not.toHaveBeenCalled();
  });

  test('T045 a run in a suspended organization does not execute', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    suspendOrganization(store);
    const runStore = new InMemoryRunStore();
    const executor = new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, new RunOrganizationAccess(store));
    const runId = executor.start({ workflow: simpleWorkflow(), agents: [], input: {} }, undefined,
      { userId: 'owner', tenantId: 'org-a' });
    await waitFor(() => ['failed', 'cancelled', 'completed'].includes(runStore.get(runId)!.run.status));
    const entry = runStore.get(runId)!;
    expect(entry.run.status).toBe('failed');
    expect(entry.run.result?.error?.code).toBe(ORGANIZATION_ACCESS_REVOKED);
  });
});

describe('US3 execution isolation — routines stop with their owner', () => {
  function routine(id: string, ownerId: string, org = 'org-a'): RoutineRecord {
    const stamp = nowIso();
    return {
      id,
      tenantId: org,
      name: id,
      description: '',
      scheduleType: 'interval',
      scheduleExpr: 'every:60s',
      timezone: 'UTC',
      targetType: 'task',
      targetId: 'task-target',
      inputPayload: {},
      misfirePolicy: 'coalesce',
      enabled: true,
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      createdAt: stamp,
      updatedAt: stamp,
      ownerId,
    };
  }

  test('T045 routines of a removed owner stop firing while active owners keep firing', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    await store.saveRoutine(routine('routine-removed-owner', 'member'), { tenantId: 'org-a', userId: 'member' });
    await store.saveRoutine(routine('routine-active-owner', 'owner'), { tenantId: 'org-a', userId: 'owner' });

    await removedMember(store);
    const scheduler = new RoutineScheduler(store, { pollIntervalMs: 60_000, claimLimit: 10 },
      new RunOrganizationAccess(store));
    const processed = await scheduler.tick();
    const processedIds = processed.map((entry) => entry.id);
    expect(processedIds).not.toContain('routine-removed-owner');
    expect(processedIds).toContain('routine-active-owner');

    const events = await store.listTriggerEvents({ tenantId: 'org-a' });
    const dispatchedKeys = events.map((event) => event.idempotencyKey);
    expect(dispatchedKeys.some((key) => key.includes('routine-removed-owner'))).toBe(false);
    expect(dispatchedKeys.some((key) => key.includes('routine-active-owner'))).toBe(true);

    const skipped = await store.listRoutineHistory('routine-removed-owner');
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0].status).toBe('skipped');
  });

  test('T045 scheduled work of a suspended organization does not fire', async () => {
    const store = new InMemoryStudioStore();
    await seedUs2(store);
    await store.saveRoutine(routine('routine-suspended-org', 'owner'), { tenantId: 'org-a', userId: 'owner' });
    suspendOrganization(store);

    const scheduler = new RoutineScheduler(store, { pollIntervalMs: 60_000, claimLimit: 10 },
      new RunOrganizationAccess(store));
    const processed = await scheduler.tick();
    expect(processed.map((entry) => entry.id)).not.toContain('routine-suspended-org');
    expect(await store.listTriggerEvents({ tenantId: 'org-a' })).toHaveLength(0);
  });
});
