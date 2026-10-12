// Authorization tests exercise the production boundary, including diagnostic shadow mode.
jest.unmock('../apps/server/src/api/shared/http');
import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { createInternalPrincipalAssertion } from '../src/auth/internalPrincipal';
import { resolveRequestPrincipal, INTERNAL_PRINCIPAL_HEADER } from '../apps/server/src/auth/principal';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';
import { log } from '../apps/server/src/logging';

describe('T082 shadow mode is diagnostics under maintenance, never weaker serving', () => {
  const previous = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  const secret = 'test-shadow-safety-server-secret';
  let store: InMemoryStudioStore;
  beforeEach(async () => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; store = new InMemoryStudioStore(); await seedUs2(store); });
  afterAll(() => { if (previous === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = previous; });
  const principal = (userId: string) => ({ userId, tenantId: 'org-a', organizationId: 'org-a' });
  const signedApp = (userId: string) => {
    const header = createInternalPrincipalAssertion(principal(userId), secret);
    return { app: createStudioRouter(store, request => resolveRequestPrincipal(request, secret)), headers: { [INTERNAL_PRINCIPAL_HEADER]: header } };
  };

  test.each(['removed', 'suspended'] as const)('restart/config downgrade after %s members cannot reopen reads or writes', async status => {
    const warm = signedApp('member'); expect((await warm.app.request('/projects', { headers: warm.headers })).status).toBe(200);
    for (const userId of ['admin', 'member', 'viewer']) {
      const m = (await store.getMembership('org-a', userId))!;
      await store.saveMembership({ ...m, status, version: m.version + 1 });
    }
    // New router represents a restart: cached context and current active-member counts cannot authorize traffic.
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'shadow';
    const downgraded = signedApp('member');
    expect((await downgraded.app.request('/projects', { headers: downgraded.headers })).status).toBe(503);
    const write = await downgraded.app.request('/projects', { ...jsonRequest('POST', { name: 'Unauthorized' }), headers: { ...downgraded.headers, 'content-type': 'application/json' } });
    expect(write.status).toBe(503);
    expect(await store.listProjects()).toEqual([]);
  });

  test('valid owner traffic is diagnosed but cannot mutate data in shadow, even before another member joins', async () => {
    store = new InMemoryStudioStore();
    await store.createOrganizationProfile({ id: 'org-a', name: 'A', description: '', config: {}, ownerId: 'owner', status: 'active', slug: 'org-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, principal('owner'));
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'shadow';
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      const shadow = signedApp('owner');
      expect((await shadow.app.request('/projects', { headers: shadow.headers })).status).toBe(503);
      expect((await shadow.app.request('/projects', { ...jsonRequest('POST', { name: 'Must not run' }), headers: { ...shadow.headers, 'content-type': 'application/json' } })).status).toBe(503);
      expect(await store.listProjects()).toEqual([]);
      expect(warn.mock.calls.filter(c => c[0] === 'authz.would_deny')).toHaveLength(0);
    } finally { warn.mockRestore(); }
  });

  test('disabled accounts, suspended organizations and absent organizations all fail closed in shadow', async () => {
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'shadow';
    jest.spyOn(store, 'isOrganizationUserActive').mockResolvedValue(false);
    const account = signedApp('owner'); expect((await account.app.request('/projects', { headers: account.headers })).status).toBe(503);
    const org = (await store.getOrganizationProfile(principal('owner')))!;
    jest.spyOn(store, 'getOrganizationProfile').mockResolvedValue({ ...org, status: 'suspended' });
    const suspended = signedApp('owner'); expect((await suspended.app.request('/projects', { headers: suspended.headers })).status).toBe(503);
    jest.spyOn(store, 'getOrganizationProfile').mockResolvedValue(null);
    const absent = signedApp('owner'); expect((await absent.app.request('/projects', { headers: absent.headers })).status).toBe(503);
  });

  test('enforce still serves authorized requests and denies stale signed assertions immediately', async () => {
    const member = signedApp('member'); expect((await member.app.request('/projects', { headers: member.headers })).status).toBe(200);
    const m = (await store.getMembership('org-a', 'member'))!; await store.saveMembership({ ...m, status: 'removed', version: 2 });
    const denial = await member.app.request('/projects', { headers: member.headers });
    expect(denial.status).toBe(404); expect(await denial.json()).toEqual({ error: 'Not found' });
  });
});
