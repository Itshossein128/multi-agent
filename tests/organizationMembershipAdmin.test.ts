import { nowIso } from '@multi-agent/types';
import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

describe('US2 membership administration', () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(() => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; });
  afterAll(() => { if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old; });
  const appFor = (store: InMemoryStudioStore, userId: string, tenantId = 'org-a') => createStudioRouter(store, () => ({ userId, tenantId, organizationId: tenantId }));
  test('invite, accept without membership, role-change, suspend, restore, remove bump versions and audit each change', async () => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const audit = jest.spyOn(store, 'appendOrganizationAudit');
    const owner = appFor(store, 'owner');
    let res = await owner.request('/organizations/current/members', jsonRequest('POST', { userId: 'new-user', role: 'viewer' }));
    expect(res.status).toBe(201); expect(await res.json()).toMatchObject({ status: 'invited', version: 1 });
    const invitee = appFor(store, 'new-user', 'unused-hint');
    res = await invitee.request('/organizations/org-a/invitations/accept', jsonRequest('POST', {}));
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ status: 'active', version: 2, role: 'viewer' });
    for (const [patch, version] of [[{ role: 'member' }, 3], [{ status: 'suspended' }, 4], [{ status: 'active' }, 5]] as const) {
      res = await owner.request('/organizations/current/members/new-user', jsonRequest('PATCH', patch));
      expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ ...patch, version });
    }
    res = await owner.request('/organizations/current/members/new-user', { method: 'DELETE' });
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ status: 'removed', version: 6 });
    expect(audit).toHaveBeenCalledTimes(6);
  });
  test.each([{ role: 'member' }, { status: 'suspended' }, { status: 'removed' }])('last active owner is protected: %j', async patch => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const res = await appFor(store, 'owner').request('/organizations/current/members/owner', jsonRequest('PATCH', patch));
    expect(res.status).toBe(409); expect((await store.getMembership('org-a', 'owner'))?.role).toBe('owner');
  });
  test.each([{ role: 'member' }, { status: 'suspended' }, { status: 'removed' }, { role: 'owner' }])('admin cannot modify any owner even with two owners: %j', async patch => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const stamp = nowIso(); await store.saveMembership({ organizationId: 'org-a', userId: 'owner-2', role: 'owner', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp });
    const res = await appFor(store, 'admin').request('/organizations/current/members/owner', jsonRequest('PATCH', patch));
    expect(res.status).toBe(403);
  });
  test('admin cannot invite or promote owner; foreign member and uninvited acceptance return uniform 404', async () => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const admin = appFor(store, 'admin');
    expect((await admin.request('/organizations/current/members', jsonRequest('POST', { userId: 'new-user', role: 'owner' }))).status).toBe(403);
    expect((await admin.request('/organizations/current/members/member', jsonRequest('PATCH', { role: 'owner' }))).status).toBe(403);
    for (const res of [await admin.request('/organizations/current/members/foreign', { method: 'DELETE' }), await appFor(store, 'viewer').request('/organizations/org-b/invitations/accept', jsonRequest('POST', {}))]) {
      expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'Not found' });
    }
  });
  test('two concurrent self-demotions retain one active owner', async () => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const stamp = nowIso(); await store.saveMembership({ organizationId: 'org-a', userId: 'owner-2', role: 'owner', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp });
    const results = await Promise.all(['owner', 'owner-2'].map(user => appFor(store, user).request(`/organizations/current/members/${user}`, jsonRequest('PATCH', { role: 'admin' }))));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await store.listMemberships('org-a')).filter(m => m.role === 'owner' && m.status === 'active')).toHaveLength(1);
  });
  test('audit failure rolls back membership mutation', async () => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    jest.spyOn(store, 'appendOrganizationAudit').mockRejectedValue(new Error('secret database detail'));
    const res = await appFor(store, 'owner').request('/organizations/current/members/member', jsonRequest('PATCH', { role: 'viewer' }));
    expect(res.status).toBe(500); expect(await res.json()).toEqual({ error: 'Internal server error' });
    expect((await store.getMembership('org-a', 'member'))?.role).toBe('member');
  });
  test('shadow mode refuses invitations', async () => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'shadow';
    try { expect((await appFor(store, 'owner').request('/organizations/current/members', jsonRequest('POST', { userId: 'new-user', role: 'viewer' }))).status).toBe(503); }
    finally { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; }
  });
  test('disabled user is denied at the server, including global bootstrap APIs', async () => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    jest.spyOn(store, 'isOrganizationUserActive').mockResolvedValue(false);
    const app = appFor(store, 'owner');
    for (const path of ['/projects', '/me/organizations', '/me/invitations']) {
      const response = await app.request(path); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Not found' });
    }
  });
  test('untrusted role and version hints cannot grant privileges or accept somebody else’s invitation', async () => {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const owner = appFor(store, 'owner');
    await owner.request('/organizations/current/members', jsonRequest('POST', { userId: 'invited-user', role: 'viewer' }));
    const wrong = await appFor(store, 'member').request('/organizations/org-a/invitations/accept', jsonRequest('POST', { userId: 'invited-user', role: 'owner' }));
    expect(wrong.status).toBe(404);
    const accepted = await appFor(store, 'invited-user').request('/organizations/org-a/invitations/accept', jsonRequest('POST', { role: 'owner', version: 999 }));
    expect(await accepted.json()).toMatchObject({ role: 'viewer', version: 2 });
    const viewer = createStudioRouter(store, () => ({ userId: 'viewer', tenantId: 'org-a', permissions: ['budgets.manage'] }));
    expect((await viewer.request('/budgets', jsonRequest('PUT', { scope: 'company', limitUsd: 100 }))).status).toBe(403);
  });

});
