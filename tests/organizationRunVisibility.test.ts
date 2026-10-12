import { createRunsRouter } from '../apps/server/src/api/runs';
import { RunExecutor } from '../apps/server/src/runtime/runExecutor';
import { InMemoryRunStore } from '../apps/server/src/runtime/runStore';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2 } from './organizationUs2Fixtures';

describe('US2 teammates run visibility', () => {
  const old = process.env.ORG_MEMBERSHIP_ENFORCEMENT;
  beforeAll(() => { process.env.ORG_MEMBERSHIP_ENFORCEMENT = 'enforce'; });
  afterAll(() => { if (old === undefined) delete process.env.ORG_MEMBERSHIP_ENFORCEMENT; else process.env.ORG_MEMBERSHIP_ENFORCEMENT = old; });
  test.each(['owner', 'admin', 'member', 'viewer'])('%s reads own runs; only admin and owner read teammates; foreign runs and mutations remain denied', async userId => {
    const studio = new InMemoryStudioStore(); await seedUs2(studio);
    const store = new InMemoryRunStore(); const executor = new RunExecutor(store);
    for (const [id, owner, tenant] of [['own', userId, 'org-a'], ['team', 'teammate', 'org-a'], ['foreign', userId, 'org-b']]) {
      store.create({ id, workflowId: 'wf', workflowName: 'Workflow', status: 'completed', input: {}, metadata: {}, startedAt: new Date().toISOString() } as Parameters<typeof store.create>[0], undefined, undefined, { userId: owner, tenantId: tenant });
    }
    const { app } = createRunsRouter(executor, async () => null, studio, () => ({ userId, tenantId: 'org-a' }));
    const res = await app.request('/'); expect(res.status).toBe(200);
    expect((await res.json() as { id: string }[]).map(r => r.id).sort()).toEqual(userId === 'admin' || userId === 'owner' ? ['own', 'team'] : ['own']);
    expect((await app.request('/own')).status).toBe(200);
    expect((await app.request('/team')).status).toBe(userId === 'admin' || userId === 'owner' ? 200 : 404);
    expect((await app.request('/team/cancel', { method: 'POST' })).status).toBe(userId === 'viewer' ? 403 : 404);
    expect((await app.request('/foreign')).status).toBe(404);
    const membership = (await studio.getMembership('org-a', userId))!;
    await studio.saveMembership({ ...membership, status: 'removed', version: membership.version + 1 });
    expect((await app.request('/own')).status).toBe(404);
  });
});
