import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

test('US2 warmed legacy principal is denied on the next request after removal; demotion takes effect immediately', async () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT; process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce';
  try {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const owner = createStudioRouter(store, () => ({ userId: 'owner', tenantId: 'org-a' }));
    const member = createStudioRouter(store, () => ({ userId: 'member', tenantId: 'org-a' }));
    expect((await member.request('/projects')).status).toBe(200);
    expect((await owner.request('/organizations/current/members/member', { method: 'DELETE' })).status).toBe(200);
    const denied = await member.request('/projects'); expect(denied.status).toBe(404); expect(await denied.json()).toEqual({ error: 'Not found' });
    const admin = createStudioRouter(store, () => ({ userId: 'admin', tenantId: 'org-a' }));
    expect((await admin.request('/budgets', jsonRequest('PUT', { scope: 'company', limitUsd: 100 }))).status).toBe(200);
    expect((await owner.request('/organizations/current/members/admin', jsonRequest('PATCH', { role: 'viewer' }))).status).toBe(200);
    expect((await admin.request('/budgets', jsonRequest('PUT', { scope: 'company', limitUsd: 100 }))).status).toBe(403);
  } finally { if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old; }
});
