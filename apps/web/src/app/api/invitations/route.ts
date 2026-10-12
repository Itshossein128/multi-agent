import { proxyInvitations } from '@/lib/organizationInvitations';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return proxyInvitations(request); }
