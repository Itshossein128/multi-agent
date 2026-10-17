import { PostgresStudioStore } from '../src/studio/infrastructure/postgres-studio-store';
import { withOrganization, scopedDbClient } from '../src/studio/infrastructure/withOrganization';
import type { PgPool } from '../src/memory/infrastructure';

test('workspace import inside request scope binds its transaction instead of recursively opening savepoints', async () => {
  let savepoints = 0;
  const client = { release: jest.fn(), query: jest.fn(async (sql: string) => {
    if (sql.startsWith('SAVEPOINT') && ++savepoints > 5) throw new Error('recursive transaction');
    return { rows: [], rowCount: 1 };
  }) };
  const pool = { connect: jest.fn(async () => client), query: jest.fn() } as unknown as PgPool;
  const store = new PostgresStudioStore(pool);
  await withOrganization(pool, 'org', 'user', async () => {
    await store.importWorkspace({ workflows: [], agents: [], tools: [] }, { userId: 'owner', tenantId: 'org' });
  });
  expect(savepoints).toBe(1);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('detached descendants cannot borrow the request client after its transaction ends', async () => {
  const client = { release: jest.fn(), query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
  const pool = { connect: jest.fn(async () => client), query: jest.fn() } as unknown as PgPool;
  let releaseBackground!: () => void;
  const gate = new Promise<void>(resolve => { releaseBackground = resolve; });
  let background!: Promise<unknown>;
  await withOrganization(pool, 'org', 'user', async () => {
    background = (async () => { await gate; return scopedDbClient(pool); })();
  });
  releaseBackground();
  expect(await background).toBeUndefined();
  expect(client.release).toHaveBeenCalledTimes(1);
});
