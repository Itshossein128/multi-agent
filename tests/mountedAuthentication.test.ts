import { Hono } from 'hono';
import { createInternalPrincipalAssertion, clearSeenNonces } from '../src/auth/internalPrincipal';
import { resolveRequestPrincipal, INTERNAL_PRINCIPAL_HEADER } from '../apps/server/src/auth/principal';
import { requirePrincipal, type PrincipalVariables } from '../apps/server/src/api/shared/http';

beforeEach(clearSeenNonces);

test('mounted authentication reuses the verified principal and retains server permissions', async () => {
  const secret = 'mounted-test-secret';
  const resolve = (request: Request) => resolveRequestPrincipal(request, secret);
  const app = new Hono<{ Variables: PrincipalVariables }>();
  app.use('*', requirePrincipal(resolve));
  app.use('*', async (c, next) => {
    c.set('principal', { ...c.get('principal'), permissions: ['budgets.manage'] });
    await next();
  });
  const router = new Hono<{ Variables: PrincipalVariables }>();
  router.use('*', requirePrincipal(resolve));
  router.get('/', c => c.json(c.get('principal')));
  app.route('/mounted', router);
  const assertion = createInternalPrincipalAssertion({ userId: 'owner', tenantId: 'org' }, secret);
  const headers = { [INTERNAL_PRINCIPAL_HEADER]: assertion };
  const response = await app.request('/mounted', { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ permissions: ['budgets.manage'] });
  expect((await app.request('/mounted', { headers })).status).toBe(401);
});

test('the same request may resolve memory identity after authentication; another request is a replay', () => {
  const secret = 'memory-test-secret';
  const headers = { [INTERNAL_PRINCIPAL_HEADER]: createInternalPrincipalAssertion({ userId: 'owner', tenantId: 'org' }, secret) };
  const request = new Request('http://localhost/runs', { headers });
  expect(resolveRequestPrincipal(request, secret)).not.toBeNull();
  expect(resolveRequestPrincipal(request, secret)).not.toBeNull();
  expect(resolveRequestPrincipal(new Request('http://localhost/runs', { headers }), secret)).toBeNull();
  expect(resolveRequestPrincipal(request, 'wrong-secret')).toBeNull();
});
