jest.unmock('../apps/server/src/api/shared/http');
import {Hono} from 'hono';
import {createInternalPrincipalAssertion,clearSeenNonces} from '../src/auth/internalPrincipal';
import {resolveRequestPrincipal,INTERNAL_PRINCIPAL_HEADER} from '../apps/server/src/auth/principal';
import {requirePrincipal,type PrincipalVariables} from '../apps/server/src/api/shared/http';
import {createRunsRouter} from '../apps/server/src/api/runs';
import {createMemoriesRouter} from '../apps/server/src/api/memories';
import {createStudioRouter} from '../apps/server/src/api/studio';
import {RunExecutor} from '../apps/server/src/runtime/runExecutor';
import {InMemoryRunStore} from '../apps/server/src/runtime/runStore';
import {InMemoryStudioStore} from '../src/studio/infrastructure/in-memory-studio-store';
import {createMemoryAccessResolver} from '../apps/server/src/memory/access';
import {seedUs2} from './organizationUs2Fixtures';
import type {MemoryService} from '../src/memory/contracts';

test('6: mounted Studio/runs/memories accept one signed request, deny replay/signature/expiry and derive permissions',async()=>{
  process.env.ORG_MEMBERSHIP_ENFORCEMENT='enforce';clearSeenNonces();
  const secret='router-regression-secret';const resolve=(request:Request)=>resolveRequestPrincipal(request,secret);
  const studio=new InMemoryStudioStore();await seedUs2(studio);
  const app=new Hono<{Variables:PrincipalVariables}>();app.use('*',requirePrincipal(resolve));
  app.route('/studio',createStudioRouter(studio,resolve));
  app.route('/runs',createRunsRouter(new RunExecutor(new InMemoryRunStore()),createMemoryAccessResolver([],resolve),studio,resolve).app);
  const list=jest.fn(async()=>[]);
  app.route('/memories',createMemoriesRouter({list} as unknown as MemoryService,createMemoryAccessResolver([],resolve)));
  for(const path of ['/studio/projects','/runs','/memories?scope=user&namespaceId=owner']) {
    const assertion=createInternalPrincipalAssertion({userId:'owner',tenantId:'org-a'},secret);
    const headers={[INTERNAL_PRINCIPAL_HEADER]:assertion};
    expect((await app.request(path,{headers})).status).toBe(200);
    expect((await app.request(path,{headers})).status).toBe(401);
    const bad=createInternalPrincipalAssertion({userId:'owner',tenantId:'org-a'},'wrong');
    expect((await app.request(path,{headers:{[INTERNAL_PRINCIPAL_HEADER]:bad}})).status).toBe(401);
    const expired=createInternalPrincipalAssertion({userId:'owner',tenantId:'org-a'},secret,Date.now()-120000);
    expect((await app.request(path,{headers:{[INTERNAL_PRINCIPAL_HEADER]:expired}})).status).toBe(401);
  }
  expect(list).toHaveBeenCalledTimes(1);
  const request=new Request('http://local/runs',{headers:{[INTERNAL_PRINCIPAL_HEADER]:createInternalPrincipalAssertion({userId:'owner',tenantId:'org-a'},secret)}});
  expect(resolve(request)).not.toBeNull();request.headers.set(INTERNAL_PRINCIPAL_HEADER,createInternalPrincipalAssertion({userId:'member',tenantId:'org-a'},'wrong'));
  expect(resolve(request)).toBeNull();
});
