/**
 * Organization-migration feature flags (plan §7 / migration-plan §7).
 * Phase 2 membership enforcement is the default after the shadow gate.
 * Org memory, deletion and RLS remain off until their later gates.
 */

export type OrgMembershipEnforcement = "shadow" | "enforce";
export type OrgRlsMode = "off" | "enforce";

export interface OrgFeatureFlags {
  membershipEnforcement: OrgMembershipEnforcement;
  memoryScope: boolean;
  deletionEnabled: boolean;
  rls: OrgRlsMode;
}

function parseMembership(raw: string | undefined): OrgMembershipEnforcement {
  return raw === "shadow" ? "shadow" : "enforce";
}

function parseRls(raw: string | undefined): OrgRlsMode {
  return raw === "enforce" ? "enforce" : "off";
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function orgFeatureFlagsFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OrgFeatureFlags {
  return {
    membershipEnforcement: parseMembership(env.ORG_MEMBERSHIP_ENFORCEMENT),
    memoryScope: parseBool(env.ORG_MEMORY_SCOPE, false),
    deletionEnabled: parseBool(env.ORG_DELETION_ENABLED, false),
    rls: parseRls(env.ORG_RLS),
  };
}
