import { nowIso } from '@multi-agent/types';
import type { StudioStore, OrganizationMembership, OrganizationMembershipRole } from '../../../../../src/studio/contracts';
import type { RequestPrincipal } from '../../auth/principal';
import { permissionsForRole } from '../../auth/organizationPermissions';
import { requirePermission } from '../../auth/authorization';
import { orgFeatureFlagsFromEnvironment } from '../../organization/orgFeatureFlags';
import { ApiError } from '../shared/http';

const roles = new Set(['owner', 'admin', 'member', 'viewer']);
function role(value: unknown): OrganizationMembershipRole {
  if (typeof value !== 'string' || !roles.has(value)) throw new ApiError(400, 'Invalid membership role');
  return value as OrganizationMembershipRole;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}

export class OrganizationMembershipService {
  constructor(private readonly store: StudioStore) {}
  private enabled() {
    if (orgFeatureFlagsFromEnvironment().membershipEnforcement !== 'enforce') throw new ApiError(503, 'Membership administration requires enforcement');
  }
  private async organization(store: StudioStore, organizationId: string, userId: string) {
    const org = await store.getOrganizationProfile({ userId, tenantId: organizationId });
    if (!org || org.status !== 'active' || !await store.isOrganizationUserActive(userId)) throw new ApiError(404, 'Not found');
  }
  private async manager(store: StudioStore, principal: RequestPrincipal) {
    if (principal.principalKind === 'service') throw new ApiError(403, 'Permission denied');
    await this.organization(store, principal.tenantId, principal.userId);
    const member = await store.getMembership(principal.tenantId, principal.userId);
    if (!member || member.status !== 'active') throw new ApiError(404, 'Not found');
    requirePermission({ permissions: permissionsForRole(member.role) }, 'members.manage');
    return member;
  }
  private authorizeRole(actor: OrganizationMembership, currentRole: OrganizationMembershipRole | undefined, nextRole: OrganizationMembershipRole) {
    if (actor.role !== 'owner' && (currentRole === 'owner' || nextRole === 'owner')) throw new ApiError(403, 'Permission denied');
  }
  async invite(value: unknown, principal: RequestPrincipal) {
    this.enabled(); const body = object(value); const nextRole = role(body.role ?? 'member');
    const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : undefined;
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : undefined;
    if ((!userId && !email) || (userId && email)) throw new ApiError(400, 'Specify a registered user id or email');
    return this.store.organizationTransaction(principal.tenantId, async store => {
      const actor = await this.manager(store, principal);
      const targetUserId = await store.findOrganizationUser({ userId, email });
      if (!targetUserId) throw new ApiError(404, 'Not found');
      const current = await store.getMembership(principal.tenantId, targetUserId);
      this.authorizeRole(actor, current?.role, nextRole);
      if (current && current.status !== 'removed') throw new ApiError(409, 'Membership already exists');
      const stamp = nowIso();
      const next: OrganizationMembership = { organizationId: principal.tenantId, userId: targetUserId, role: nextRole, status: 'invited', invitedBy: principal.userId, version: (current?.version ?? 0) + 1, createdAt: current?.createdAt ?? stamp, updatedAt: stamp, removedAt: null };
      await store.saveMembership(next);
      await this.audit(store, principal.userId, current, next, 'membership.invited');
      return next;
    });
  }
  async accept(organizationId: string, principal: RequestPrincipal) {
    this.enabled();
    if (principal.principalKind === 'service') throw new ApiError(403, 'Permission denied');
    return this.store.organizationTransaction(organizationId, async store => {
      await this.organization(store, organizationId, principal.userId);
      const current = await store.getMembership(organizationId, principal.userId);
      if (!current || current.status !== 'invited') throw new ApiError(404, 'Not found');
      const next = { ...current, status: 'active' as const, version: current.version + 1, updatedAt: nowIso(), removedAt: null };
      await store.saveMembership(next); await this.audit(store, principal.userId, current, next, 'membership.accepted');
      return next;
    });
  }
  async change(userId: string, value: unknown, principal: RequestPrincipal) {
    this.enabled(); const body = object(value);
    if (!Object.keys(body).length || Object.keys(body).some(k => !['role', 'status'].includes(k))) throw new ApiError(400, 'Specify role or status');
    const nextRole = body.role === undefined ? undefined : role(body.role);
    if (body.status !== undefined && !['active', 'suspended', 'removed'].includes(String(body.status))) throw new ApiError(400, 'Invalid membership status');
    return this.store.organizationTransaction(principal.tenantId, async store => {
      const actor = await this.manager(store, principal);
      const current = await store.getMembership(principal.tenantId, userId);
      if (!current) throw new ApiError(404, 'Not found');
      this.authorizeRole(actor, current.role, nextRole ?? current.role);
      // Activation requires invitation acceptance; a removed member must be invited again.
      if ((current.status === 'invited' && body.status && body.status !== 'removed') || (current.status === 'removed' && body.status && body.status !== 'removed')) throw new ApiError(409, 'Invite and accept this membership first');
      const next = { ...current, role: nextRole ?? current.role, status: (body.status ?? current.status) as OrganizationMembership['status'] };
      if (current.role === 'owner' && current.status === 'active' && (next.role !== 'owner' || next.status !== 'active')) {
        const owners = (await store.listMemberships(principal.tenantId)).filter(m => m.role === 'owner' && m.status === 'active');
        if (owners.length <= 1) throw new ApiError(409, 'The last active owner cannot be changed');
      }
      if (next.role === current.role && next.status === current.status) return current;
      next.version++; next.updatedAt = nowIso(); next.removedAt = next.status === 'removed' ? next.updatedAt : null;
      await store.saveMembership(next); await this.audit(store, principal.userId, current, next, 'membership.changed');
      return next;
    });
  }
  private audit(store: StudioStore, actorUserId: string, before: OrganizationMembership | null | undefined, after: OrganizationMembership, action: string) {
    return store.appendOrganizationAudit({ organizationId: after.organizationId, actorUserId, targetUserId: after.userId, action, details: { before: before ? { role: before.role, status: before.status, version: before.version } : null, after: { role: after.role, status: after.status, version: after.version } } });
  }
}
