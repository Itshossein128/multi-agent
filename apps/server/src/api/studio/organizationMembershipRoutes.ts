import type { Hono } from 'hono';
import type { StudioStore } from '../../../../../src/studio/contracts';
import { ApiError, type PrincipalVariables } from '../shared/http';
import { OrganizationMembershipService } from './organizationMembershipService';

export function registerOrganizationMembershipRoutes(app: Hono<{ Variables: PrincipalVariables }>, store: StudioStore) {
  const service = new OrganizationMembershipService(store);
  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    try { return await c.req.json(); } catch { throw new ApiError(400, 'Invalid JSON body'); }
  };
  app.post('/organizations/current/members', async c => c.json(await service.invite(await body(c), c.get('principal')), 201));
  app.patch('/organizations/current/members/:userId', async c => c.json(await service.change(c.req.param('userId'), await body(c), c.get('principal'))));
  app.delete('/organizations/current/members/:userId', async c => c.json(await service.change(c.req.param('userId'), { status: 'removed' }, c.get('principal'))));
  app.post('/organizations/:organizationId/invitations/accept', async c => c.json(await service.accept(c.req.param('organizationId'), c.get('principal'))));
  app.get('/me/invitations', async c => {
    const principal = c.get('principal');
    if (principal.principalKind === 'service' || !await store.isOrganizationUserActive(principal.userId)) throw new ApiError(404, 'Not found');
    const invitations = await store.listInvitationsForUser(principal.userId);
    return c.json(await Promise.all(invitations.map(async membership => ({ ...membership, organization: await store.getOrganizationProfile({ userId: principal.userId, tenantId: membership.organizationId }) }))));
  });
  app.get('/organizations/current/audit', async c => c.json(await store.listOrganizationAudit(c.get('principal').tenantId)));
}
