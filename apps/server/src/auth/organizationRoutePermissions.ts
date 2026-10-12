import type { OrganizationPermission } from '../../../../src/studio/contracts';

/** Every scoped request receives a gate; specialized actions override the read/write baseline. */
export function organizationRoutePermission(method: string, path: string): OrganizationPermission {
  const read = method === 'GET' || method === 'HEAD';
  if (/^\/organizations\/current\/audit(?:\/|$)/.test(path)) return 'audit.read';
  if (/^\/organizations\/current\/members(?:\/|$)/.test(path)) return read ? 'org.read' : 'members.manage';
  if (/^\/organizations(?:\/|$)/.test(path)) return read ? 'org.read' : method === 'DELETE' ? 'org.delete' : 'org.update';
  if (/^\/budgets(?:\/|$)/.test(path)) return read ? 'resources.read' : 'budgets.manage';
  if (/^\/organization(?:\/|$)/.test(path)) {
    if (read) return 'org.read';
    if (path === '/organization/goals' && method === 'POST') return 'goals.create';
    if (path === '/organization/strategy' && method === 'POST') return 'strategy.request';
    if (/\/goals\/[^/]+\/delegate$/.test(path) && method === 'POST') return 'goals.delegate';
    return 'agent_org.manage';
  }
  if (/^\/agents\/[^/]+\/diagnostics$/.test(path)) return 'credentials.manage';
  if ((!read && /^\/webhooks\/triggers(?:\/|$)/.test(path)) || /^\/credentials(?:\/|$)/.test(path) || /\/rotate-secret$/.test(path)) return 'credentials.manage';
  if (/^\/agents\/[^/]+\/heartbeat$/.test(path) && !read) return 'agent_org.manage';
  if (/^\/projects(?:\/|$)/.test(path) && !read) return 'projects.manage';
  if (/^\/runs(?:\/|$)/.test(path) || path === '/tools/test' || (path === '/dashboard' && !read) || /\/tasks\/[^/]+\/(start|cancel|retry|pause|resume|clarification)$/.test(path)) return read ? 'resources.read' : 'runs.execute';
  if (/^\/memories(?:\/|$)/.test(path)) {
    if (read || path === '/memories/search') return 'memory.org.read';
    return method === 'DELETE' ? 'memory.org.forget' : 'memory.org.write';
  }
  return read ? 'resources.read' : 'resources.write';
}

export function isOrganizationBootstrap(method: string, path: string): boolean {
  return (method === 'POST' && path === '/organizations')
    || (method === 'GET' && (path === '/me/organizations' || path === '/me/invitations'))
    || (method === 'POST' && /^\/organizations\/[^/]+\/invitations\/accept$/.test(path));
}
