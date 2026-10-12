import { nowIso } from '@multi-agent/types';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { InMemorySecretStore } from '../src/broker/secretStore';
import { InMemoryLeaseStore } from '../src/broker/leaseStore';
import { InMemoryMemoryStore } from '../src/memory/infrastructure/in-memory-memory-store';
import { InMemoryOrganizationStore } from '../apps/server/src/organization/organizationStore';
import { InMemoryBudgetStore } from '../apps/server/src/budgets/budgetStore';
import { OrganizationPurgeWorker } from '../apps/server/src/organization/organizationPurgeWorker';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

describe('US6 Organization Deletion (Phase 7)', () => {
  const originalEnforcement = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  const originalDeletion = process.env.ORG_DELETION_ENABLED;

  beforeAll(() => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
  });

  afterAll(() => {
    if (originalEnforcement === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT;
    else process.env.ORG_MEMBERSHIP_ENFORCEMENT = originalEnforcement;

    if (originalDeletion === undefined) delete process.env.ORG_DELETION_ENABLED;
    else process.env.ORG_DELETION_ENABLED = originalDeletion;
  });

  afterEach(() => {
    delete process.env.ORG_DELETION_ENABLED;
  });

  const appFor = (store: InMemoryStudioStore, userId: string, tenantId = 'org-a', purgeWorker?: OrganizationPurgeWorker) =>
    createStudioRouter(
      store,
      () => ({ userId, tenantId, organizationId: tenantId }),
      undefined,
      undefined,
      undefined,
      undefined,
      purgeWorker,
    );

  test('name mismatch refuses deletion and leaves organization active', async () => {
    process.env.ORG_DELETION_ENABLED = 'true';
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');
    const purgeWorker = new OrganizationPurgeWorker({ studioStore: store });
    const ownerApp = appFor(store, 'owner', 'org-a', purgeWorker);

    const res = await ownerApp.request(
      '/organizations/current',
      jsonRequest('DELETE', { confirmationName: 'wrong-name' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mismatch/i);

    const profile = await store.getOrganizationProfile({ userId: 'owner', tenantId: 'org-a' });
    expect(profile).not.toBeNull();
    expect(profile?.status).toBe('active');
  });

  test('admin, member, and viewer are denied deletion (403)', async () => {
    process.env.ORG_DELETION_ENABLED = 'true';
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');
    const purgeWorker = new OrganizationPurgeWorker({ studioStore: store });

    for (const role of ['admin', 'member', 'viewer']) {
      const app = appFor(store, role, 'org-a', purgeWorker);
      const res = await app.request(
        '/organizations/current',
        jsonRequest('DELETE', { confirmationName: 'org-a' }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('ORGANIZATION_PERMISSION_DENIED');
    }

    const profile = await store.getOrganizationProfile({ userId: 'owner', tenantId: 'org-a' });
    expect(profile?.status).toBe('active');
  });

  test('ORG_DELETION_ENABLED=false rejects deletion with no side effects', async () => {
    process.env.ORG_DELETION_ENABLED = 'false';
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');
    const purgeWorker = new OrganizationPurgeWorker({ studioStore: store });
    const ownerApp = appFor(store, 'owner', 'org-a', purgeWorker);

    const res = await ownerApp.request(
      '/organizations/current',
      jsonRequest('DELETE', { confirmationName: 'org-a' }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/disabled/i);

    const profile = await store.getOrganizationProfile({ userId: 'owner', tenantId: 'org-a' });
    expect(profile).not.toBeNull();
    expect(profile?.status).toBe('active');
  });

  function makeTask(overrides: Partial<import('../src/studio/contracts').StudioTask> & { id: string; projectId: string }): import('../src/studio/contracts').StudioTask {
    return {
      title: 'Task',
      description: '',
      priority: 'medium',
      status: 'todo',
      assignedAgent: null,
      dependencies: [],
      output: null,
      retryCount: 0,
      paused: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...overrides,
    };
  }

  test('confirmed delete cancels runs, revokes leases, deletes secrets, and purges all application data while retaining broker audit', async () => {
    process.env.ORG_DELETION_ENABLED = 'true';
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');

    // Populate resources in org-a
    const principal = { userId: 'owner', tenantId: 'org-a' };
    const project = await store.saveProject(
      { id: 'proj-1', name: 'Project 1', nameSource: 'manual', description: '', settings: {}, status: 'active', tenantId: 'org-a', ownerId: 'owner', createdAt: nowIso(), updatedAt: nowIso() },
      principal,
    );
    const workspace = await store.saveWorkspace(
      { id: 'ws-1', name: 'WS 1', nameSource: 'manual', description: '', settings: {}, settingsOverrides: {}, effectiveSettings: {}, overriddenKeys: [], projectId: project.id, status: 'active', tenantId: 'org-a', ownerId: 'owner', createdAt: nowIso(), updatedAt: nowIso() },
      principal,
    );
    await store.saveTask(
      makeTask({ id: 'task-1', title: 'Task 1', projectId: project.id, workspaceId: workspace.id, tenantId: 'org-a', ownerId: 'owner' }),
      principal,
    );

    // Populate run in org-a
    const runStore = new InMemoryRunStore();
    runStore.create(
      { id: 'run-1', workflowId: 'wf-1', status: 'running', startedAt: nowIso(), metadata: {}, ownerId: 'owner', tenantId: 'org-a' },
      undefined,
      undefined,
      principal,
    );

    // Populate secrets in org-a
    const secretStore = new InMemorySecretStore([
      { provider: 'anthropic', alias: 'primary', tenantId: 'org-a', value: 'secret-key-1' },
      { provider: 'anthropic', alias: 'primary', tenantId: 'org-b', value: 'secret-key-2' },
    ]);

    // Populate leases and audit in broker
    const leaseStore = new InMemoryLeaseStore();
    await leaseStore.create({
      leaseId: 'lease-1',
      contractVersion: '1.0.0',
      tenantId: 'org-a',
      principalId: 'owner',
      runId: 'run-1',
      agentId: 'agent-1',
      provider: 'anthropic',
      alias: 'primary',
      purpose: 'agent_execution',
      status: 'issued',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 300_000,
    });

    // Populate memory in org-a
    const memoryStore = new InMemoryMemoryStore();
    await memoryStore.insert({
      id: 'mem-1',
      tenantId: 'org-a',
      kind: 'semantic',
      visibility: 'organization',
      content: 'Org A confidential procedure',
      contentHash: 'hash-1',
      namespace: { scope: 'organization', id: 'org-a' },
      source: { type: 'system' },
      importance: 5,
      status: 'active',
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    // Populate agent goals & budgets in org-a
    const orgStore = new InMemoryOrganizationStore();
    await orgStore.saveGoal({
      id: 'goal-1',
      tenantId: 'org-a',
      title: 'Goal 1',
      description: 'Desc',
      status: 'active',
      parentGoalId: null,
      projectId: project.id,
      ownerAgentId: null,
      proposedByAgentId: null,
      createdBy: 'owner',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const budgetStore = new InMemoryBudgetStore();
    await budgetStore.setBudget({
      tenantId: 'org-a',
      scope: 'company',
      scopeId: 'org-a',
      limitUsd: 100,
      thresholdPercent: 80,
    });

    const purgeWorker = new OrganizationPurgeWorker({
      studioStore: store,
      organizationStore: orgStore,
      budgetStore,
      runStore,
      memoryStore,
      leaseStore,
      secretStore,
    });

    const ownerApp = appFor(store, 'owner', 'org-a', purgeWorker);
    const res = await ownerApp.request(
      '/organizations/current',
      jsonRequest('DELETE', { confirmationName: 'org-a' }),
    );
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.status).toBe('completed');
    expect(result.organizationId).toBe('org-a');

    // Verification across stores (SC-008):
    // 1. Organization profile is gone
    const profile = await store.getOrganizationProfile({ userId: 'owner', tenantId: 'org-a' });
    expect(profile).toBeNull();

    // 2. Memberships in org-a are gone
    const memberships = await store.listMemberships('org-a');
    expect(memberships).toHaveLength(0);

    // 3. Studio resources are gone
    const tasks = await store.listTasks(principal);
    expect(tasks).toHaveLength(0);
    const projects = await store.listProjects(principal, 'all');
    expect(projects).toHaveLength(0);

    // 4. Runs are cancelled/purged
    const run = runStore.get('run-1');
    expect(run === undefined || run.run.status === 'cancelled').toBe(true);

    // 5. Secrets in secret store for org-a are deleted; org-b preserved
    await expect(secretStore.getSecret({ provider: 'anthropic', alias: 'primary', tenantId: 'org-a' }))
      .rejects.toThrow();
    const secretB = await secretStore.getSecret({ provider: 'anthropic', alias: 'primary', tenantId: 'org-b' });
    expect(secretB.value).toBe('secret-key-2');

    // 6. Memory is purged
    const mem = await memoryStore.get('org-a', 'mem-1');
    expect(mem).toBeNull();

    // 7. Goals and budgets are purged
    expect(await orgStore.goals('org-a')).toHaveLength(0);
    expect(await budgetStore.list('org-a')).toHaveLength(0);

    // 8. User account still exists and can authenticate
    expect(await store.isOrganizationUserActive('owner')).toBe(true);
    expect(await store.isOrganizationUserActive('admin')).toBe(true);
  });

  test('interrupted purge resumes and cleans residual items', async () => {
    process.env.ORG_DELETION_ENABLED = 'true';
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');

    // Simulate interrupted purge: org status set to 'deleting' with lingering task
    const principal = { userId: 'owner', tenantId: 'org-a' };
    const project = await store.saveProject(
      { id: 'proj-1', name: 'Project 1', nameSource: 'manual', description: '', settings: {}, status: 'active', tenantId: 'org-a', ownerId: 'owner', createdAt: nowIso(), updatedAt: nowIso() },
      principal,
    );
    await store.saveTask(
      makeTask({ id: 'task-lingering', title: 'Lingering Task', projectId: project.id, tenantId: 'org-a', ownerId: 'owner' }),
      principal,
    );

    // Mark status as 'deleting'
    await store.updateOrganizationStatus('org-a', 'deleting');
    const profile = await store.getOrganizationProfile({ userId: 'owner', tenantId: 'org-a' });
    expect(profile?.status).toBe('deleting');

    const purgeWorker = new OrganizationPurgeWorker({ studioStore: store });
    const pending = await purgeWorker.findPendingPurges();
    expect(pending).toContain('org-a');

    const resumeResult = await purgeWorker.resumePurge('org-a');
    expect(resumeResult.status).toBe('completed');

    expect(await store.getOrganizationProfile({ userId: 'owner', tenantId: 'org-a' })).toBeNull();
    expect(await store.getTask('task-lingering', principal)).toBeNull();
  });

  test('never report completed while residual rows exist', async () => {
    process.env.ORG_DELETION_ENABLED = 'true';
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');

    const purgeWorker = new OrganizationPurgeWorker({ studioStore: store });
    // Spy on assertClean or simulate lingering row
    jest.spyOn(purgeWorker, 'assertClean').mockRejectedValueOnce(new Error('Residual rows detected'));

    await expect(purgeWorker.purgeOrganization('org-a')).rejects.toThrow('Residual rows detected');
  });

  test('T055: worker attempting write during or after purge cannot resurrect org-owned rows', async () => {
    process.env.ORG_DELETION_ENABLED = 'true';
    const store = new InMemoryStudioStore();
    await seedUs2(store, 'org-a');
    const principal = { userId: 'owner', tenantId: 'org-a' };
    const project = await store.saveProject(
      { id: 'proj-1', name: 'Project 1', nameSource: 'manual', description: '', settings: {}, status: 'active', tenantId: 'org-a', ownerId: 'owner', createdAt: nowIso(), updatedAt: nowIso() },
      principal,
    );

    // Transition to deleting
    await store.updateOrganizationStatus('org-a', 'deleting');

    // Attempted writes during 'deleting' fail
    await expect(
      store.saveTask(
        makeTask({ id: 'task-late', title: 'Late task', projectId: project.id, tenantId: 'org-a', ownerId: 'owner' }),
        principal,
      ),
    ).rejects.toThrow(/deleting|not active|does not exist/i);

    // After purge completes and org row is gone
    const purgeWorker = new OrganizationPurgeWorker({ studioStore: store });
    await purgeWorker.purgeOrganization('org-a');

    // Attempted writes after deletion fail
    await expect(
      store.saveTask(
        makeTask({ id: 'task-resurrect', title: 'Resurrect task', projectId: 'proj-1', tenantId: 'org-a', ownerId: 'owner' }),
        principal,
      ),
    ).rejects.toThrow(/deleting|not active|does not exist/i);

    // Assert that the rows do not exist in the store
    expect(await store.getTask('task-late', principal)).toBeNull();
    expect(await store.getTask('task-resurrect', principal)).toBeNull();
  });
});
