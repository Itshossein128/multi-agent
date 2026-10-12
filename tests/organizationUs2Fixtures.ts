import { nowIso } from '@multi-agent/types';
import type { StudioStore, OrganizationMembershipRole } from '../src/studio/contracts';
export async function seedUs2(store: StudioStore, org = 'org-a') {
  const stamp = nowIso();
  await store.createOrganizationProfile({ id: org, name: org, description: '', config: {}, ownerId: 'owner', status: 'active', slug: org, createdAt: stamp, updatedAt: stamp }, { userId: 'owner', tenantId: org });
  for (const role of ['admin', 'member', 'viewer'] as OrganizationMembershipRole[]) {
    await store.saveMembership({ organizationId: org, userId: role, role, status: 'active', version: 1, createdAt: stamp, updatedAt: stamp });
  }
}
export function jsonRequest(method: string, body: unknown) { return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }; }
