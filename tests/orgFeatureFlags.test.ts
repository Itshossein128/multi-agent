import { orgFeatureFlagsFromEnvironment } from "../apps/server/src/organization/orgFeatureFlags";

describe("orgFeatureFlagsFromEnvironment", () => {
  it("defaults enforce Phase 2 membership and deletion after Polish gate while keeping memoryScope and rls off", () => {
    expect(orgFeatureFlagsFromEnvironment({})).toEqual({
      membershipEnforcement: "enforce",
      memoryScope: false,
      deletionEnabled: true,
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
