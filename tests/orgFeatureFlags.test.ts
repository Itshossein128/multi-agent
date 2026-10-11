import { orgFeatureFlagsFromEnvironment } from "../apps/server/src/organization/orgFeatureFlags";

describe("orgFeatureFlagsFromEnvironment", () => {
  it("defaults keep later phases off", () => {
    expect(orgFeatureFlagsFromEnvironment({})).toEqual({
      membershipEnforcement: "shadow",
      memoryScope: false,
      deletionEnabled: false,
      rls: "off",
    });
  });

  it("parses explicit values", () => {
    expect(
      orgFeatureFlagsFromEnvironment({
        ORG_MEMBERSHIP_ENFORCEMENT: "enforce",
        ORG_MEMORY_SCOPE: "true",
        ORG_DELETION_ENABLED: "1",
        ORG_RLS: "enforce",
      }),
    ).toEqual({
      membershipEnforcement: "enforce",
      memoryScope: true,
      deletionEnabled: true,
      rls: "enforce",
    });
  });
});
