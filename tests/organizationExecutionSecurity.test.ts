import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { nowIso, type WorkflowDefinition, createEdge, createEmptyDefinition, createNode } from '@multi-agent/types';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import {
  MEMORY_ACCESS_ORGANIZATION_MISMATCH,
  ORGANIZATION_ACCESS_REVOKED,
  RunOrganizationAccess,
} from '../apps/server/src/runtime/runOrganizationAccess';
import { RunAccessCheckpoint, checkpointedApiCredentials } from '../apps/server/src/runtime/runAccessCheckpoint';
import { BrokerApiCredentialResolver } from '../src/security/providerCredentials';
import { HttpCredentialGateway, type CredentialGatewayFetch } from '../src/security/credentialGateway';
import { createBrokerApp, StaticServiceAuth } from '../src/broker/httpApp';
import { assertWorkspacePathBelongsToOrganization } from '../src/studio/infrastructure/workspace-storage';
import { resolveTaskExecutionWorkspaceRoot } from '../apps/server/src/api/studio/workspaceWorkingCopyService';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2 } from './organizationUs2Fixtures';
import { createBrokerHarness, type BrokerHarness } from './helpers/brokerHarness';

const TOKEN = 'us3-broker-token-0001';

function gatewayFor(harness: BrokerHarness): HttpCredentialGateway {
  const app = createBrokerApp({
    service: harness.service,
    auth: new StaticServiceAuth([
      { token: TOKEN, name: 'execution-server', scopes: ['leases:issue', 'leases:consume', 'leases:revoke'] },
    ]),
  });
  const fetchFor: CredentialGatewayFetch = async (input, init) => app.fetch(new Request(String(input), {
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    ...(init?.body !== undefined ? { body: init.body as string } : {}),
  }));
  return new HttpCredentialGateway('https://broker.internal', TOKEN, fetchFor);
}

function simpleWorkflow(id = 'wf-security'): WorkflowDefinition {
  const input = createNode('input', { x: 0, y: 0 });
  const output = createNode('output', { x: 1, y: 0 });
  return {
    ...createEmptyDefinition(),
    id,
    name: id,
    nodes: [input, output],
    edges: [createEdge({ source: input.id, target: output.id })],
    updatedAt: nowIso(),
  };
}

function executorFor(store: InMemoryStudioStore, runStore: InMemoryRunStore) {
  return new RunExecutor(runStore, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, new RunOrganizationAccess(store));
}

describe('US3 execution security — memory grants must match the run organization', () => {
  let store: InMemoryStudioStore;
  let runStore: InMemoryRunStore;
  let executor: RunExecutor;
  const principal = { userId: 'member', tenantId: 'org-a' };

  beforeEach(async () => {
    store = new InMemoryStudioStore();
    await seedUs2(store);
    runStore = new InMemoryRunStore();
    executor = executorFor(store, runStore);
  });

  test('T047 starting a run with a memory grant from another organization is rejected', () => {
    const foreignGrant = {
      principalId: 'member',
      tenantId: 'org-b',
      readableNamespaces: [{ scope: 'workflow' as const, id: 'run-x' }],
      writableNamespaces: [{ scope: 'workflow' as const, id: 'run-x' }],
    };
    const failure = (() => {
      try {
        executor.start({ workflow: simpleWorkflow(), agents: [], input: {} }, foreignGrant, principal);
        return null;
      } catch (error) {
        return error as { code?: string; message?: string };
      }
    })();
    expect(failure?.code).toBe(MEMORY_ACCESS_ORGANIZATION_MISMATCH);
    expect(runStore.list()).toHaveLength(0);
  });

  test('T047 retrying a run with a foreign memory grant is rejected', async () => {
    runStore.create({
      id: 'run-failed',
      workflowId: 'wf-failed',
      status: 'failed',
      startedAt: nowIso(),
      completedAt: nowIso(),
      input: {},
      metadata: {},
      ownerId: 'member',
      tenantId: 'org-a',
    }, undefined, { workflow: simpleWorkflow('wf-failed'), agents: [] });
    const foreignGrant = {
      principalId: 'member',
      tenantId: 'org-b',
      readableNamespaces: [{ scope: 'workflow' as const, id: 'run-y' }],
      writableNamespaces: [{ scope: 'workflow' as const, id: 'run-y' }],
    };
    await expect(executor.retry('run-failed', foreignGrant)).rejects.toMatchObject({
      code: MEMORY_ACCESS_ORGANIZATION_MISMATCH,
    });
    expect(runStore.get('run-failed')!.run.status).toBe('failed');
  });

  test('T047 restoring a queued run with a foreign memory grant is rejected', () => {
    runStore.create({
      id: 'run-queued-foreign',
      workflowId: 'wf-queued',
      status: 'queued',
      startedAt: nowIso(),
      input: {},
      metadata: {},
      ownerId: 'member',
      tenantId: 'org-a',
    }, undefined, { workflow: simpleWorkflow('wf-queued'), agents: [] });
    const foreignGrant = {
      principalId: 'member',
      tenantId: 'org-b',
      readableNamespaces: [{ scope: 'workflow' as const, id: 'run-z' }],
      writableNamespaces: [{ scope: 'workflow' as const, id: 'run-z' }],
    };
    expect(() => executor.resumeQueuedRun('run-queued-foreign', foreignGrant)).toThrow(
      expect.objectContaining({ code: MEMORY_ACCESS_ORGANIZATION_MISMATCH }),
    );
    expect(runStore.get('run-queued-foreign')!.run.status).toBe('queued');
  });
});

describe('US3 execution security — workspace paths stay inside the originating organization', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'us3-workspace-'));
    env = { ...process.env, STUDIO_WORKSPACE_STORAGE_ROOT: root, CLI_AGENT_WORKSPACE_ROOTS: '' };
  });

  test('T047 a foreign organization working copy is never handed to an execution', async () => {
    const foreignPath = join(root, 'org-b', 'project-b', 'default', 'repo-b');
    await mkdir(foreignPath, { recursive: true });
    const resolved = await resolveTaskExecutionWorkspaceRoot({
      tenantId: 'org-a',
      projectId: 'project-a',
      workspaceId: null,
      preferredPath: foreignPath,
      env,
    });
    expect(resolved).not.toBe(foreignPath);
    expect(resolved).toContain(`${sep}org-a${sep}`);
    expect(resolved).not.toContain(`${sep}org-b${sep}`);
  });

  test('T047 organization prefix assertions reject traversal and foreign prefixes', () => {
    expect(() => assertWorkspacePathBelongsToOrganization(join(root, 'org-b', 'p', 'w', 'r'), 'org-a', env))
      .toThrow(/organization/i);
    expect(() => assertWorkspacePathBelongsToOrganization(join(root, 'org-a', 'project-a', 'default', 'repo-a'), 'org-a', env))
      .not.toThrow();
    expect(() => assertWorkspacePathBelongsToOrganization(join(root, '..', 'escape', 'p'), 'org-a', env))
      .toThrow(/organization|escape/i);
  });
});

describe('US3 execution security — broker leases cannot cross organizations', () => {
  test('T047 the credential path refuses foreign-organization lease use for a run', async () => {
    const harness = createBrokerHarness();
    const gateway = gatewayFor(harness);
    const resolver = new BrokerApiCredentialResolver(gateway, { openai: 'team' });

    const store = new InMemoryStudioStore();
    const runStore = new InMemoryRunStore();
    runStore.create({
      id: 'run-a', workflowId: 'wf-a', status: 'running', startedAt: nowIso(),
      input: {}, metadata: {}, ownerId: 'user-a', tenantId: 'tenant-a',
    });
    runStore.create({
      id: 'run-b', workflowId: 'wf-b', status: 'running', startedAt: nowIso(),
      input: {}, metadata: {}, ownerId: 'user-b', tenantId: 'tenant-b',
    });
    const executor = executorFor(store, runStore);
    const checkpoint = new RunAccessCheckpoint();
    checkpoint.install(({ runId, tenantId }) => executor.assertRunAccess(runId, tenantId));
    const guarded = checkpointedApiCredentials(resolver, checkpoint);
    const issueSpy = jest.spyOn(harness.service, 'issue');

    // Legitimate originating-organization lease still works.
    const secret = await guarded.resolve({
      provider: 'openai', tenantId: 'tenant-a', principalId: 'user-a', runId: 'run-a', agentId: 'agent-1',
    });
    expect(secret).toBe('sk-fake-not-real');
    expect(issueSpy).toHaveBeenCalledTimes(1);

    // A foreign organization's tenant may never be used for this run's lease.
    const foreignTenant = await guarded.resolve({
      provider: 'openai', tenantId: 'tenant-b', principalId: 'user-a', runId: 'run-a', agentId: 'agent-1',
    }).then(() => null, (error: unknown) => error as { code?: string });
    expect(foreignTenant?.code).toBe(ORGANIZATION_ACCESS_REVOKED);

    // And the run of another organization cannot borrow this organization's tenant.
    const foreignRun = await guarded.resolve({
      provider: 'openai', tenantId: 'tenant-a', principalId: 'user-b', runId: 'run-b', agentId: 'agent-1',
    }).then(() => null, (error: unknown) => error as { code?: string });
    expect(foreignRun?.code).toBe(ORGANIZATION_ACCESS_REVOKED);
    expect(issueSpy).toHaveBeenCalledTimes(1);
  });

  test('T047 a stolen lease cannot be consumed by another organization at the broker boundary', async () => {
    const harness = createBrokerHarness();
    const gateway = gatewayFor(harness);
    const lease = await gateway.issue({
      provider: 'openai', alias: 'team', tenantId: 'tenant-a', principalId: 'user-a',
      runId: 'run-a', agentId: 'agent-1', purpose: 'agent',
    });
    const stolen = await gateway.consume(lease, {
      provider: 'openai', alias: 'team', tenantId: 'tenant-b', principalId: 'user-b',
      runId: 'run-b', agentId: 'agent-1', purpose: 'agent',
    }).then(() => null, (error: unknown) => error as { code?: string });
    expect(stolen?.code).toBe('context_mismatch');
    expect(String(stolen)).not.toContain('sk-fake-not-real');
    const legitimate = await gateway.consume(lease, {
      provider: 'openai', alias: 'team', tenantId: 'tenant-a', principalId: 'user-a',
      runId: 'run-a', agentId: 'agent-1', purpose: 'agent',
    });
    expect(legitimate).toBe('sk-fake-not-real');
  });
});
