import { createStudioRouter } from '../apps/server/src/api/studio';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { permissionsForRole } from '../apps/server/src/auth/organizationPermissions';
import * as authorization from '../apps/server/src/auth/authorization';
import { seedUs2, jsonRequest } from './organizationUs2Fixtures';

describe('US2 role permission matrix', () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(() => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; });
  afterAll(() => { if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old; });
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
  const actions = [
    ['POST', '/webhooks/triggers', {}, ['owner', 'admin']],
    ['PUT', '/webhooks/triggers/missing', {}, ['owner', 'admin']],
    ['DELETE', '/webhooks/triggers/missing', {}, ['owner', 'admin']],
    ['POST', '/tools', { name: 'Database', category: 'database', configuration: { connection: 'main' } }, ['owner', 'admin']],
    ['GET', '/agents/missing/diagnostics', undefined, ['owner', 'admin']],
    ['POST', '/agents', { name: 'Connected', backend: { type: 'webhook', url: 'https://example.test', credentialAlias: 'shared-secret' } }, ['owner', 'admin']],
    ['PUT', '/budgets', { scope: 'company', limitUsd: 100 }, ['owner', 'admin']],
    ['PUT', '/organization/agents/missing', {}, ['owner', 'admin']],
    ['PATCH', '/organization/goals/missing', {}, ['owner', 'admin']],
    ['POST', '/organization/goals', {}, ['owner', 'admin', 'member']],
    ['POST', '/organization/strategy', {}, ['owner', 'admin', 'member']],
    ['POST', '/organization/goals/missing/delegate', {}, ['owner', 'admin', 'member']],
    ['POST', '/projects', { name: 'Project' }, ['owner', 'admin', 'member']],
    ['POST', '/tasks', {}, ['owner', 'admin', 'member']],
    ['POST', '/organizations/current/members', { userId: 'new-user', role: 'viewer' }, ['owner', 'admin']],
  ] as const;
  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    test.each(actions)(`${role}: %s %s`, async (method, path, body, allowed) => {
      const store = new InMemoryStudioStore(); await seedUs2(store);
      const app = createStudioRouter(store, () => ({ userId: role, tenantId: 'org-a', organizationId: 'org-a' }));
      const res = await app.request(path, method === 'GET' ? { method } : jsonRequest(method, body));
      if ((allowed as readonly string[]).includes(role)) expect(res.status).not.toBe(403);
      else expect(res.status).toBe(403);
    });
  }
});
