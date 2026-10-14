import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { permissionsForRole } from '../apps/server/src/auth/organizationPermissions';
import * as authorization from '../apps/server/src/auth/authorization';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';
import type { StudioStore } from '../src/studio/contracts';

async function seedFixtures(store: StudioStore, org = 'org-a') {
  await seedUs2(store, org);
  const stamp = new Date().toISOString();
  await store.saveAgent({
    id: `agent-1-${org}`,
    name: 'Agent 1',
    record: { id: `agent-1-${org}`, name: 'Agent 1', backend: { type: 'built-in' } },
    backend: { type: 'built-in' },
    ownerId: null,
    tenantId: org,
    isSystem: false,
    createdAt: stamp,
    updatedAt: stamp,
  } as any);

  await store.saveWorkflow({
    id: `wf-1-${org}`,
    name: 'Workflow 1',
    nodes: [],
    edges: [],
    ownerId: 'owner',
    tenantId: org,
    updatedAt: stamp,
  } as any, { userId: 'owner', tenantId: org });

  await store.saveProject({
    id: `proj-1-${org}`,
    name: 'Project 1',
    description: '',
    status: 'active',
    settings: {},
    tenantId: org,
    createdAt: stamp,
    updatedAt: stamp,
  } as any, { userId: 'owner', tenantId: org });

  await store.saveTool({
    id: `tool-1-${org}`,
    name: 'Tool 1',
    description: '',
    configuration: {},
    ownerId: null,
    tenantId: org,
    isSystem: false,
    createdAt: stamp,
    updatedAt: stamp,
  } as any, { userId: 'owner', tenantId: org });

  await store.saveWebhookTrigger({
    id: `trigger-1-${org}`,
    name: 'Trigger 1',
    description: 'Trigger 1',
    targetType: 'agent',
    targetId: `agent-1-${org}`,
    events: ['test'],
    secretHash: 'enc:01:02:03',
    enabled: true,
    rateLimitPerMinute: 60,
    tenantId: org,
    createdAt: stamp,
    updatedAt: stamp,
  } as any, { userId: 'owner', tenantId: org });
}

interface ActionSpec {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  allowed: ('owner' | 'admin' | 'member' | 'viewer')[];
  expectedStatus: number;
  verifyNonMutation?: (store: StudioStore) => Promise<void>;
}

const actions: ActionSpec[] = [
  {
    name: 'POST /webhooks/triggers',
    method: 'POST',
    path: '/webhooks/triggers',
    body: { name: 'NewTrigger', targetType: 'agent', targetId: 'agent-1-org-a', events: ['test'] },
    allowed: ['owner', 'admin'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const triggers = await s.listWebhookTriggers({ userId: 'owner', tenantId: 'org-a' });
      expect(triggers.some(t => t.name === 'NewTrigger')).toBe(false);
    },
  },
  {
    name: 'PUT /webhooks/triggers/:id',
    method: 'PUT',
    path: '/webhooks/triggers/trigger-1-org-a',
    body: { name: 'UpdatedTrigger', targetType: 'agent', targetId: 'agent-1-org-a' },
    allowed: ['owner', 'admin'],
    expectedStatus: 200,
    verifyNonMutation: async (s) => {
      const t = await s.getWebhookTrigger('trigger-1-org-a', { userId: 'owner', tenantId: 'org-a' });
      expect(t?.name).toBe('Trigger 1');
    },
  },
  {
    name: 'DELETE /webhooks/triggers/:id',
    method: 'DELETE',
    path: '/webhooks/triggers/trigger-1-org-a',
    allowed: ['owner', 'admin'],
    expectedStatus: 200,
    verifyNonMutation: async (s) => {
      const t = await s.getWebhookTrigger('trigger-1-org-a', { userId: 'owner', tenantId: 'org-a' });
      expect(t).not.toBeNull();
    },
  },
  {
    name: 'POST /tools (credential-bearing)',
    method: 'POST',
    path: '/tools',
    body: { name: 'DatabaseTool', category: 'database', configuration: { connection: 'main' } },
    allowed: ['owner', 'admin'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const tools = await s.listTools({ userId: 'owner', tenantId: 'org-a' });
      expect(tools.some(t => t.name === 'DatabaseTool')).toBe(false);
    },
  },
  {
    name: 'POST /tools (credential-free)',
    method: 'POST',
    path: '/tools',
    body: { name: 'SimpleTool', category: 'custom', configuration: {} },
    allowed: ['owner', 'admin', 'member'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const tools = await s.listTools({ userId: 'owner', tenantId: 'org-a' });
      expect(tools.some(t => t.name === 'SimpleTool')).toBe(false);
    },
  },
  {
    name: 'GET /agents/:id/diagnostics',
    method: 'GET',
    path: '/agents/agent-1-org-a/diagnostics',
    allowed: ['owner', 'admin'],
    expectedStatus: 200,
  },
  {
    name: 'POST /agents (credential-bearing)',
    method: 'POST',
    path: '/agents',
    body: { name: 'ConnectedAgent', backend: { type: 'webhook', url: 'https://example.test', credentialAlias: 'shared-secret' } },
    allowed: ['owner', 'admin'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const agents = await s.listAgents({ userId: 'owner', tenantId: 'org-a' });
      expect(agents.some(a => a.name === 'ConnectedAgent')).toBe(false);
    },
  },
  {
    name: 'POST /agents (credential-free)',
    method: 'POST',
    path: '/agents',
    body: { name: 'SimpleAgent', backend: { type: 'built-in' } },
    allowed: ['owner', 'admin', 'member'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const agents = await s.listAgents({ userId: 'owner', tenantId: 'org-a' });
      expect(agents.some(a => a.name === 'SimpleAgent')).toBe(false);
    },
  },
  {
    name: 'PUT /budgets',
    method: 'PUT',
    path: '/budgets',
    body: { scope: 'company', limitUsd: 100 },
    allowed: ['owner', 'admin'],
    expectedStatus: 200,
  },
  {
    name: 'POST /organization/goals',
    method: 'POST',
    path: '/organization/goals',
    body: { title: 'New Goal' },
    allowed: ['owner', 'admin', 'member'],
    expectedStatus: 201,
  },
  {
    name: 'POST /projects',
    method: 'POST',
    path: '/projects',
    body: { name: 'New Project' },
    allowed: ['owner', 'admin', 'member'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const projs = await s.listProjects({ userId: 'owner', tenantId: 'org-a' });
      expect(projs.some(p => p.name === 'New Project')).toBe(false);
    },
  },
  {
    name: 'POST /tasks',
    method: 'POST',
    path: '/tasks',
    body: { projectId: 'proj-1-org-a', title: 'New Task' },
    allowed: ['owner', 'admin', 'member'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const tasks = await s.listTasks({ userId: 'owner', tenantId: 'org-a' });
      expect(tasks.some(t => t.title === 'New Task')).toBe(false);
    },
  },
  {
    name: 'POST /organizations/current/members',
    method: 'POST',
    path: '/organizations/current/members',
    body: { userId: 'new-user', role: 'viewer' },
    allowed: ['owner', 'admin'],
    expectedStatus: 201,
    verifyNonMutation: async (s) => {
      const m = await s.getMembership('org-a', 'new-user');
      expect(m).toBeNull();
    },
  },
];

describe('US2 role permission matrix', () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  const oldWebhookKey = process.env.WEBHOOK_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
    process.env.WEBHOOK_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });
  afterAll(() => {
    if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old;
    if (oldWebhookKey === undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY = oldWebhookKey;
  });

  test('requires permission with a typed denial and fails closed without context', () => {
    const helper = (authorization as unknown as { requirePermission?: (context: unknown, permission: string) => void }).requirePermission;
    expect(typeof helper).toBe('function');
    if (!helper) return;
    expect(() => helper(undefined, 'members.manage')).toThrow();
    expect(() => helper({ permissions: permissionsForRole('viewer') }, 'budgets.manage')).toThrow();
    expect(() => helper({ permissions: permissionsForRole('owner') }, 'org.delete')).not.toThrow();
  });

  const sensitive = ['budgets.manage', 'agent_org.manage', 'members.manage', 'credentials.manage', 'org.delete', 'runs.read_all'] as const;
  for (const membershipRole of ['owner', 'admin', 'member', 'viewer'] as const) {
    test.each(sensitive)(`${membershipRole} permission %s`, permission => {
      const allowed = membershipRole === 'owner' || (membershipRole === 'admin' && permission !== 'org.delete');
      const invoke = () => authorization.requirePermission({ permissions: permissionsForRole(membershipRole) }, permission);
      if (allowed) expect(invoke).not.toThrow(); else expect(invoke).toThrow(authorization.PermissionDeniedError);
    });
  }

  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    describe(`role: ${role}`, () => {
      for (const action of actions) {
        test(`${action.method} ${action.path} (${action.name})`, async () => {
          const store = new InMemoryStudioStore();
          await seedFixtures(store);
          const executor = new RunExecutor(new InMemoryRunStore());
          const app = createStudioRouter(store, () => ({ userId: role, tenantId: 'org-a', organizationId: 'org-a' }), executor);

          const res = await app.request(
            action.path,
            action.method === 'GET' ? { method: 'GET' } : jsonRequest(action.method, action.body),
          );

          const isAllowed = action.allowed.includes(role);
          if (isAllowed) {
            expect(res.status).toBe(action.expectedStatus);
          } else {
            expect(res.status).toBe(403);
            const err = await res.json();
            expect(err.code).toBe('ORGANIZATION_PERMISSION_DENIED');
            if (action.verifyNonMutation) {
              await action.verifyNonMutation(store);
            }
          }
        });
      }
    });
  }

  test('uniform 404 for missing resources on allowed roles', async () => {
    const store = new InMemoryStudioStore();
    await seedFixtures(store);
    const executor = new RunExecutor(new InMemoryRunStore());
    const app = createStudioRouter(store, () => ({ userId: 'owner', tenantId: 'org-a', organizationId: 'org-a' }), executor);

    expect((await app.request('/workflows/missing-wf')).status).toBe(404);
    expect((await app.request('/agents/missing-agent')).status).toBe(404);
    expect((await app.request('/tools/missing-tool')).status).toBe(404);
    expect((await app.request('/projects/missing-proj')).status).toBe(404);
    expect((await app.request('/tasks/missing-task')).status).toBe(404);
    expect((await app.request('/webhooks/triggers/missing-trigger')).status).toBe(404);
    expect((await app.request('/agents/missing-agent/diagnostics')).status).toBe(404);
  });

  test('proves foreign resource isolation for a member of two organizations', async () => {
    const store = new InMemoryStudioStore();
    await seedFixtures(store, 'org-a');
    await seedFixtures(store, 'org-b');
    const stamp = new Date().toISOString();

    await store.saveMembership({
      organizationId: 'org-a',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await store.saveMembership({
      organizationId: 'org-b',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });

    await store.saveWorkflow({
      id: 'wf-dual-org-a',
      name: 'Workflow Dual A',
      nodes: [],
      edges: [],
      ownerId: 'dualUser',
      tenantId: 'org-a',
      updatedAt: stamp,
    } as any, { userId: 'dualUser', tenantId: 'org-a' });

    await store.saveWorkflow({
      id: 'wf-dual-org-b',
      name: 'Workflow Dual B',
      nodes: [],
      edges: [],
      ownerId: 'dualUser',
      tenantId: 'org-b',
      updatedAt: stamp,
    } as any, { userId: 'dualUser', tenantId: 'org-b' });

    const executor = new RunExecutor(new InMemoryRunStore());
    const appA = createStudioRouter(store, () => ({ userId: 'dualUser', tenantId: 'org-a', organizationId: 'org-a' }), executor);

    // Reading own org resources succeeds
    expect((await appA.request('/workflows/wf-dual-org-a')).status).toBe(200);
    expect((await appA.request('/projects/proj-1-org-a')).status).toBe(200);

    // Reading foreign org resources returns 404
    expect((await appA.request('/workflows/wf-dual-org-b')).status).toBe(404);
    expect((await appA.request('/agents/agent-1-org-b')).status).toBe(404);
    expect((await appA.request('/projects/proj-1-org-b')).status).toBe(404);

    // Mutating foreign org resource returns 404 and does not mutate
    const patchRes = await appA.request('/projects/proj-1-org-b', jsonRequest('PATCH', { name: 'Hacked' }));
    expect(patchRes.status).toBe(404);
    const pB = await store.getProject('proj-1-org-b', { userId: 'owner', tenantId: 'org-b' });
    expect(pB?.name).toBe('Project 1');

    // Context switch to org-b:
    const appB = createStudioRouter(store, () => ({ userId: 'dualUser', tenantId: 'org-b', organizationId: 'org-b' }), executor);
    expect((await appB.request('/workflows/wf-dual-org-b')).status).toBe(200);
    expect((await appB.request('/projects/proj-1-org-b')).status).toBe(200);
    expect((await appB.request('/workflows/wf-dual-org-a')).status).toBe(404);
    expect((await appB.request('/projects/proj-1-org-a')).status).toBe(404);
  });
});

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('PostgreSQL US2 permissions and foreign resource isolation', () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let store: PostgresStudioStore;
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  const oldWebhookKey = process.env.WEBHOOK_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
    process.env.WEBHOOK_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterAll(() => {
    if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old;
    if (oldWebhookKey === undefined) delete process.env.WEBHOOK_ENCRYPTION_KEY; else process.env.WEBHOOK_ENCRYPTION_KEY = oldWebhookKey;
  });

  beforeEach(async () => {
    schema = `perm_matrix_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
    store = new PostgresStudioStore(pool);

    for (const u of ['owner', 'admin', 'member', 'viewer', 'dualUser', 'new-user']) {
      await pool.query("INSERT INTO studio_users (id, email, password_hash, status) VALUES ($1, $2, 'hash', 'active')", [u, `${u}@test.local`]);
    }

    await seedFixtures(store, 'org-a');
    await seedFixtures(store, 'org-b');

    const stamp = new Date().toISOString();
    await store.saveMembership({
      organizationId: 'org-a',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await store.saveMembership({
      organizationId: 'org-b',
      userId: 'dualUser',
      role: 'member',
      status: 'active',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await store.saveWorkflow({
      id: 'wf-dual-org-a',
      name: 'Workflow Dual A',
      nodes: [],
      edges: [],
      ownerId: 'dualUser',
      tenantId: 'org-a',
      updatedAt: stamp,
    } as any, { userId: 'dualUser', tenantId: 'org-a' });

    await store.saveWorkflow({
      id: 'wf-dual-org-b',
      name: 'Workflow Dual B',
      nodes: [],
      edges: [],
      ownerId: 'dualUser',
      tenantId: 'org-b',
      updatedAt: stamp,
    } as any, { userId: 'dualUser', tenantId: 'org-b' });
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin && schema) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('enforces permissions and non-mutation on PostgreSQL', async () => {
    const executor = new RunExecutor(new InMemoryRunStore());

    // Member attempts credential-bearing tool creation -> 403
    const appMember = createStudioRouter(store, () => ({ userId: 'member', tenantId: 'org-a', organizationId: 'org-a' }), executor);
    const deniedToolRes = await appMember.request(
      '/tools',
      jsonRequest('POST', { name: 'SecretTool', category: 'database', configuration: { connection: 'main' } }),
    );
    expect(deniedToolRes.status).toBe(403);
    const tools = await store.listTools({ userId: 'owner', tenantId: 'org-a' });
    expect(tools.some(t => t.name === 'SecretTool')).toBe(false);

    // Admin creates credential-bearing tool -> 201
    const appAdmin = createStudioRouter(store, () => ({ userId: 'admin', tenantId: 'org-a', organizationId: 'org-a' }), executor);
    const allowedToolRes = await appAdmin.request(
      '/tools',
      jsonRequest('POST', { name: 'AdminTool', category: 'database', configuration: { connection: 'main' } }),
    );
    expect(allowedToolRes.status).toBe(201);
    const updatedTools = await store.listTools({ userId: 'admin', tenantId: 'org-a' });
    expect(updatedTools.some(t => t.name === 'AdminTool')).toBe(true);
  });

  it('proves foreign resource isolation on PostgreSQL for two-org member', async () => {
    const executor = new RunExecutor(new InMemoryRunStore());
    const appA = createStudioRouter(store, () => ({ userId: 'dualUser', tenantId: 'org-a', organizationId: 'org-a' }), executor);

    expect((await appA.request('/workflows/wf-dual-org-a')).status).toBe(200);
    expect((await appA.request('/workflows/wf-dual-org-b')).status).toBe(404);

    const appB = createStudioRouter(store, () => ({ userId: 'dualUser', tenantId: 'org-b', organizationId: 'org-b' }), executor);
    expect((await appB.request('/workflows/wf-dual-org-b')).status).toBe(200);
    expect((await appB.request('/workflows/wf-dual-org-a')).status).toBe(404);
  });
});
