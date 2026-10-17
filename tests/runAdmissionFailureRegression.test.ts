import { PostgresRunStore } from '../apps/server/src/runtime/store/postgresRunStore';
import type { PgPool } from '../src/memory/infrastructure';

test('run admission rejects promptly when acquiring the independent persistence connection fails', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  const pool = { connect: async () => { throw new Error('persistence pool unavailable'); }, query: jest.fn() } as unknown as PgPool;
  const store = new PostgresRunStore(pool, { leaseRenewalIntervalMs: 0 });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    store.create({ id: 'run-admission-failure', workflowId: 'workflow', status: 'queued', startedAt: new Date().toISOString(), ownerId: 'owner', tenantId: 'org', metadata: {} });
    const result = await Promise.race([
      store.waitForPersistence('run-admission-failure').then(() => 'unexpected success', error => (error as Error).message),
      new Promise<string>(resolve => { deadline = setTimeout(() => resolve('admission remained pending'), 250); }),
    ]);
    expect(result).toContain('persistence pool unavailable');
  } finally { clearTimeout(deadline); store.close(); errorLog.mockRestore(); }
});
