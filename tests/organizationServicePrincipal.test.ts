import { createInternalPrincipalAssertion, verifyInternalPrincipalAssertion } from '../src/auth/internalPrincipal';
import { InMemoryStudioStore } from '../src/studio/infrastructure/in-memory-studio-store';
import { seedUs2 } from './organizationUs2Fixtures';
import type { StudioPrincipal } from '../src/studio/contracts';

test.each(['system-imposter', 'internal:agent:imposter'])('identity name %s cannot read another user workflow', async userId => {
  const store = new InMemoryStudioStore(); await seedUs2(store);
  await store.saveWorkflow({ id: 'private', name: 'Private', nodes: [], edges: [], updatedAt: new Date().toISOString(), ownerId: 'owner', tenantId: 'org-a' } as Parameters<typeof store.saveWorkflow>[0]);
  expect(await store.getWorkflow('private', { userId, tenantId: 'org-a' })).toBeNull();
});
test('service kind is signed, explicit and tenant-bound; an ordinary assertion never infers kind from its name', () => {
  const service = { userId: 'worker', tenantId: 'org-a', principalKind: 'service' as const };
  expect(verifyInternalPrincipalAssertion(createInternalPrincipalAssertion(service, 'secret'), 'secret')).toMatchObject({ principalKind: 'service', tenantId: 'org-a' });
  expect(verifyInternalPrincipalAssertion(createInternalPrincipalAssertion({ userId: 'system-fake', tenantId: 'org-a' }, 'secret'), 'secret')).toMatchObject({ principalKind: 'user' });
});
test('typed service can read a same-org private workflow but not another organization', async () => {
  const store = new InMemoryStudioStore(); await seedUs2(store);
  await store.saveWorkflow({ id: 'private', name: 'Private', nodes: [], edges: [], updatedAt: new Date().toISOString(), ownerId: 'owner', tenantId: 'org-a' } as Parameters<typeof store.saveWorkflow>[0]);
  const service = { userId: 'worker', tenantId: 'org-a', principalKind: 'service' } as StudioPrincipal;
  expect(await store.getWorkflow('private', service)).not.toBeNull();
  expect(await store.getWorkflow('private', { ...service, tenantId: 'org-b' })).toBeNull();
});
