jest.unmock('../apps/server/src/api/shared/http');
import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { log } from '../apps/server/src/logging';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

test('Phase 2 shadow gate: valid owner diagnostics have zero authz.would_deny; no scoped handler serves', async () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT; process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'shadow';
  const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
  try {
    const store = new InMemoryStudioStore(); await seedUs2(store);
    const app = createStudioRouter(store, () => ({ userId: 'owner', tenantId: 'org-a' }));
    for (const path of ['/projects', '/tasks', '/workspaces', '/agents', '/tools', '/workflows', '/workspace', '/routines', '/webhooks/triggers', '/organization', '/budgets', '/organizations/current', '/organizations/current/members', '/organizations/current/audit']) {
      expect((await app.request(path)).status).toBe(503);
    }
    expect((await app.request('/budgets', jsonRequest('PUT', { scope: 'company', limitUsd: 100 }))).status).toBe(503);
    expect(warn.mock.calls.filter(c => c[0] === 'authz.would_deny')).toHaveLength(0);
    const denied = createStudioRouter(store, () => ({ userId: 'viewer', tenantId: 'org-a' }));
    expect((await denied.request('/budgets', jsonRequest('PUT', { scope: 'company', limitUsd: 100 }))).status).toBe(503);
    expect(warn).toHaveBeenCalledWith('authz.would_deny', expect.anything());
  } finally { warn.mockRestore(); if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old; }
});
