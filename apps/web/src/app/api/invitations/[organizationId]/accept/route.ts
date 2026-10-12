import { proxyInvitations } from '@/lib/organizationInvitations';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return proxyInvitations(request, (await context.params).organizationId);
}
