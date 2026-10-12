import 'server-only';
import { getSessionUserId } from '@/auth';
import { proxyExecutionWith } from '@/lib/executionBff';

/** Global invitation APIs authenticate identity independently of active organization membership. */
export async function proxyInvitations(request: Request, organizationId?: string) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  return proxyExecutionWith(request, organizationId ? `/studio/organizations/${encodeURIComponent(organizationId)}/invitations/accept` : '/studio/me/invitations', {
    // Legacy transport requires an org alias. Bootstrap routes treat it as a hint only;
    // acceptance loads the URL organization and the authenticated user's invitation.
    principal: async () => ({ userId, tenantId: organizationId ?? userId }),
    fetchImpl: fetch,
    secret: process.env.INTERNAL_PRINCIPAL_SECRET,
    base: process.env.EXECUTION_SERVER_URL ?? 'http://localhost:4000',
  });
}
