import type {
  OrganizationMembershipRole,
  OrganizationPermission,
} from "../../../../src/studio/contracts";

const ALL: OrganizationPermission[] = [
  "org.read",
  "org.update",
  "org.delete",
  "org.transfer_ownership",
  "members.manage",
  "budgets.manage",
  "agent_org.manage",
  "goals.create",
  "goals.delegate",
  "strategy.request",
  "projects.manage",
  "resources.write",
  "resources.read",
  "runs.execute",
  "runs.read_all",
  "credentials.manage",
  "memory.org.read",
  "memory.org.write",
  "memory.org.forget",
  "audit.read",
];

const BY_ROLE: Record<OrganizationMembershipRole, OrganizationPermission[]> = {
  owner: ALL,
  admin: ALL.filter(
    (p) => p !== "org.delete" && p !== "org.transfer_ownership",
  ),
  member: [
    "org.read",
    "goals.create",
    "goals.delegate",
    "strategy.request",
    "projects.manage",
    "resources.write",
    "resources.read",
    "runs.execute",
    "memory.org.read",
  ],
  viewer: ["org.read", "resources.read", "memory.org.read"],
};

export function permissionsForRole(role: OrganizationMembershipRole): OrganizationPermission[] {
  return [...BY_ROLE[role]];
}
