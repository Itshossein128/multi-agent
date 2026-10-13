import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createInternalPrincipalAssertion, verifyInternalPrincipalAssertion } from '../src/auth/internalPrincipal';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { runStudioMigrations } from '../src/studio/infrastructure/migrate';
import { seedUs2 } from './organizationUs2Fixtures';
import type { StudioPrincipal } from '../src/studio/contracts';

test.each(['system-imposter', 'internal:agent:imposter'])('identity name %s cannot read another user workflow', async userId => {
  const store = new InMemoryStudioStore(); await seedUs2(store);
  await store.saveWorkflow({ id: 'private', name: 'Private', nodes: [], edges: [], updatedAt: new Date().toISOString(), ownerId: 'owner', tenantId: 'org-a' } as Parameters<typeof store.saveWorkflow>[0]);
  expect(await store.getWorkflow('private', { userId, tenantId: 'org-a' })).toBeNull();
});
test('service kind is signed, explicit and tenant-bound; an ordinary assertion never infers kind from its name', () => {
  const service = { userId: 'worker', tenantId: 'org-a', principalKind: 'service' as const };
  expect(verifyInternalPrincipalAssertion(createInternalPrincipalAssertion(service, 'secret'), 'secret')).toMatchObject({ principalKind: 'service', tenantId: 'org-a' });
  expect(verifyInternalPrincipalAssertion(createInternalPrincipalAssertion({ userId: 'system-fake', tenantId: 'org-a' }, 'secret'), 'secret')).toMatchObject({ principalKind: 'user' });
});
test('typed service can read a same-org private workflow but not another organization', async () => {
  const store = new InMemoryStudioStore(); await seedUs2(store);
  await store.saveWorkflow({ id: 'private', name: 'Private', nodes: [], edges: [], updatedAt: new Date().toISOString(), ownerId: 'owner', tenantId: 'org-a' } as Parameters<typeof store.saveWorkflow>[0]);
  const service = { userId: 'worker', tenantId: 'org-a', principalKind: 'service' } as StudioPrincipal;
  expect(await store.getWorkflow('private', service)).not.toBeNull();
  expect(await store.getWorkflow('private', { ...service, tenantId: 'org-b' })).toBeNull();
});

test('service principal ownership bypass is strictly bound to allowOwnershipBypass', async () => {
  const store = new InMemoryStudioStore(); await seedUs2(store);
  await store.saveWorkflow({ id: 'private', name: 'Private', nodes: [], edges: [], updatedAt: new Date().toISOString(), ownerId: 'owner', tenantId: 'org-a' } as unknown as Parameters<typeof store.saveWorkflow>[0]);
  await store.saveAgent({ id: 'agent-priv', name: 'Private Agent', record: {}, ownerId: 'owner', tenantId: 'org-a', isSystem: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as unknown as Parameters<typeof store.saveAgent>[0]);

  // allowOwnershipBypass: false -> cannot read another user's private workflow or agent
  const serviceNoBypass = { userId: 'worker', tenantId: 'org-a', principalKind: 'service', allowOwnershipBypass: false } as StudioPrincipal;
  expect(await store.getWorkflow('private', serviceNoBypass)).toBeNull();
  expect(await store.getAgent('agent-priv', serviceNoBypass)).toBeNull();

  // allowOwnershipBypass: true -> can read private workflow and agent
  const serviceWithBypass = { userId: 'worker', tenantId: 'org-a', principalKind: 'service', allowOwnershipBypass: true } as StudioPrincipal;
  expect(await store.getWorkflow('private', serviceWithBypass)).not.toBeNull();
  expect(await store.getAgent('agent-priv', serviceWithBypass)).not.toBeNull();
});

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)('PostgresStudioStore service principal ownership bypass', () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let store: PostgresStudioStore;

  beforeEach(async () => {
    schema = `svc_principal_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await runStudioMigrations(pool);
    store = new PostgresStudioStore(pool);
    await pool.query("INSERT INTO studio_users (id, email, password_hash, status) VALUES ($1, $2, 'hash', 'active')", ['owner', 'owner@test.local']);
    await store.createOrganizationProfile({
      id: 'org-a',
      name: 'Org A',
      slug: 'org-a',
      status: 'active',
      description: '',
      config: {},
      ownerId: 'owner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { userId: 'owner', tenantId: 'org-a' });
    await store.saveWorkflow({
      id: 'private',
      name: 'Private',
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
      ownerId: 'owner',
      tenantId: 'org-a',
    } as unknown as Parameters<typeof store.saveWorkflow>[0], { userId: 'owner', tenantId: 'org-a' });
    await store.saveAgent({
      id: 'agent-priv',
      name: 'Private Agent',
      record: {},
      ownerId: 'owner',
      tenantId: 'org-a',
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Parameters<typeof store.saveAgent>[0], { userId: 'owner', tenantId: 'org-a' });
    await store.saveTool({
      id: 'tool-priv',
      name: 'Private Tool',
      description: 'Private',
      configuration: {},
      ownerId: 'owner',
      tenantId: 'org-a',
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Parameters<typeof store.saveTool>[0], { userId: 'owner', tenantId: 'org-a' });
  }, 60_000);

  afterEach(async () => {
    await pool?.end();
    if (admin && schema) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('binds Postgres service principal ownership bypass strictly to allowOwnershipBypass', async () => {
    const serviceNoBypass = { userId: 'worker', tenantId: 'org-a', principalKind: 'service', allowOwnershipBypass: false } as StudioPrincipal;
    expect(await store.getWorkflow('private', serviceNoBypass)).toBeNull();
    expect(await store.getAgent('agent-priv', serviceNoBypass)).toBeNull();
    expect(await store.getTool('tool-priv', serviceNoBypass)).toBeNull();

    const serviceWithBypass = { userId: 'worker', tenantId: 'org-a', principalKind: 'service', allowOwnershipBypass: true } as StudioPrincipal;
    expect(await store.getWorkflow('private', serviceWithBypass)).not.toBeNull();
    expect(await store.getAgent('agent-priv', serviceWithBypass)).not.toBeNull();
    expect(await store.getTool('tool-priv', serviceWithBypass)).not.toBeNull();
  });
});

describe('T088 / F8 typed service principal resolution in requireOrganizationContext', () => {
  const secret = 'service-test-secret-32-bytes-minimum-len!';
  const originalSecret = process.env.INTERNAL_PRINCIPAL_SECRET;
  const originalEnforce = process.env.ORG_MEMBERSHIP_ENFORCEMENT;

  beforeAll(() => {
    process.env.INTERNAL_PRINCIPAL_SECRET = secret;
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.INTERNAL_PRINCIPAL_SECRET;
    else process.env.INTERNAL_PRINCIPAL_SECRET = originalSecret;
    if (originalEnforce === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT;
    else process.env.ORG_MEMBERSHIP_ENFORCEMENT = originalEnforce;
  });

  async function setupStoreWithServiceGrants(store: InMemoryStudioStore) {
    await seedUs2(store);
    const org = await store.getOrganizationProfile({ userId: 'owner', tenantId: 'org-a' });
    await store.updateOrganizationProfile({
      config: {
        ...org?.config,
        serviceGrants: [
          {
            serviceId: 'granted-reader',
            permissions: ['org.read', 'resources.read'],
            status: 'active',
            allowOwnershipBypass: false,
          },
          {
            serviceId: 'granted-admin',
            permissions: ['org.read', 'resources.read', 'resources.write', 'runs.execute'],
            status: 'active',
            allowOwnershipBypass: true,
          },
          {
            serviceId: 'revoked-service',
            permissions: ['resources.read', 'resources.write'],
            status: 'revoked',
            allowOwnershipBypass: true,
          },
          {
            serviceId: 'foreign-service',
            organizationId: 'org-other',
            permissions: ['resources.read'],
            status: 'active',
          },
        ],
      },
    }, { userId: 'owner', tenantId: 'org-a' });

    // Seed a private workflow belonging to 'owner'
    await store.saveWorkflow({
      id: 'owner-wf',
      name: 'Owner Private WF',
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
      ownerId: 'owner',
      tenantId: 'org-a',
    } as Parameters<typeof store.saveWorkflow>[0]);
  }

  function signedRequest(principalInput: { userId: string; tenantId: string; principalKind?: 'user' | 'service' }, method = 'GET', body?: unknown) {
    const token = createInternalPrincipalAssertion(principalInput, secret);
    const headers: Record<string, string> = {
      'X-Multi-Agent-Principal': token,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    return new Request('http://localhost', {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it('fails closed (404) for absent service grant', async () => {
    const { createStudioRouter } = await import('../apps/server/src/api/studio');
    const store = new InMemoryStudioStore();
    await setupStoreWithServiceGrants(store);
    const app = createStudioRouter(store);

    const req = signedRequest({ userId: 'unregistered-worker', tenantId: 'org-a', principalKind: 'service' });
    const res = await app.request('/workflows', req);
    expect(res.status).toBe(404);
  });

  it('fails closed (404) for revoked service grant', async () => {
    const { createStudioRouter } = await import('../apps/server/src/api/studio');
    const store = new InMemoryStudioStore();
    await setupStoreWithServiceGrants(store);
    const app = createStudioRouter(store);

    const req = signedRequest({ userId: 'revoked-service', tenantId: 'org-a', principalKind: 'service' });
    const res = await app.request('/workflows', req);
    expect(res.status).toBe(404);
  });

  it('fails closed (404) for foreign-bound service grant', async () => {
    const { createStudioRouter } = await import('../apps/server/src/api/studio');
    const store = new InMemoryStudioStore();
    await setupStoreWithServiceGrants(store);
    const app = createStudioRouter(store);

    const req = signedRequest({ userId: 'foreign-service', tenantId: 'org-a', principalKind: 'service' });
    const res = await app.request('/workflows', req);
    expect(res.status).toBe(404);
  });

  it('denies (403) when service principal lacks required permission', async () => {
    const { createStudioRouter } = await import('../apps/server/src/api/studio');
    const store = new InMemoryStudioStore();
    await setupStoreWithServiceGrants(store);
    const app = createStudioRouter(store);

    // granted-reader only has resources.read, not resources.write
    const req = signedRequest(
      { userId: 'granted-reader', tenantId: 'org-a', principalKind: 'service' },
      'POST',
      { id: 'new-wf', name: 'New WF', nodes: [], edges: [] },
    );
    const res = await app.request('/workflows', req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('ORGANIZATION_PERMISSION_DENIED');
  });

  it('denies ownership bypass when service grant does not allow it', async () => {
    const { createStudioRouter } = await import('../apps/server/src/api/studio');
    const store = new InMemoryStudioStore();
    await setupStoreWithServiceGrants(store);
    const app = createStudioRouter(store);

    // granted-reader has resources.read, but allowOwnershipBypass: false
    // owner-wf is owned by 'owner', so granted-reader cannot see it
    const req = signedRequest({ userId: 'granted-reader', tenantId: 'org-a', principalKind: 'service' });
    const res = await app.request('/workflows/owner-wf', req);
    expect(res.status).toBe(404);
  });

  it('allows ownership bypass when service grant explicitly allows it', async () => {
    const { createStudioRouter } = await import('../apps/server/src/api/studio');
    const store = new InMemoryStudioStore();
    await setupStoreWithServiceGrants(store);
    const app = createStudioRouter(store);

    // granted-admin has resources.read AND allowOwnershipBypass: true
    const req = signedRequest({ userId: 'granted-admin', tenantId: 'org-a', principalKind: 'service' });
    const res = await app.request('/workflows/owner-wf', req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe('owner-wf');
  });

  it('preserves legitimate scoped system-heartbeat and system-trigger execution', async () => {
    const { createStudioRouter } = await import('../apps/server/src/api/studio');
    const store = new InMemoryStudioStore();
    await setupStoreWithServiceGrants(store);
    const app = createStudioRouter(store);

    const hbReq = signedRequest({ userId: 'system-heartbeat', tenantId: 'org-a', principalKind: 'service' });
    const hbRes = await app.request('/workflows', hbReq);
    expect(hbRes.status).toBe(200);

    const trigReq = signedRequest({ userId: 'system-trigger', tenantId: 'org-a', principalKind: 'service' });
    const trigRes = await app.request('/workflows', trigReq);
    expect(trigRes.status).toBe(200);
  });
});
