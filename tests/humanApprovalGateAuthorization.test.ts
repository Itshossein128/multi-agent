import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { ApiError } from "../apps/server/src/api/shared/http";
import {
  assertApprovalDecisionAuthorized,
  extractGateAuthorization,
  mapOrganizationRoleToApprovalRoles,
} from "../apps/server/src/api/runs/approvalAuthorization";
import { SEED_TENANT_ID } from "../src/studio/seeds/buildingGapOrgSeed";

describe("T052 Human Approval Gate role and decision authorization", () => {
  test("maps trusted organization roles onto approval roles", () => {
    expect(mapOrganizationRoleToApprovalRoles("owner")).toEqual(["admin"]);
    expect(mapOrganizationRoleToApprovalRoles("admin")).toEqual(["admin"]);
    expect(mapOrganizationRoleToApprovalRoles("member")).toEqual(["project_manager"]);
    expect(mapOrganizationRoleToApprovalRoles("viewer")).toEqual([]);
    expect(mapOrganizationRoleToApprovalRoles("member", {
      metadata: { approvalRoles: ["lead_architect"] },
    })).toEqual(["lead_architect"]);
  });

  test("extracts requiredRoles and allowedDecisions from approval metadata", () => {
    const gate = extractGateAuthorization({
      metadata: {
        requiredRoles: ["admin", "lead_architect"],
        allowedDecisions: ["approved", "rejected"],
      },
    });
    expect(gate.requiredRoles).toEqual(["admin", "lead_architect"]);
    expect(gate.allowedDecisions).toEqual(["approved", "rejected"]);
  });

  test("enforces membership roles and allowed decisions fail-closed", async () => {
    const store = new InMemoryStudioStore();
    const now = new Date().toISOString();

    await store.saveMembership({
      organizationId: SEED_TENANT_ID,
      userId: "admin-user",
      role: "admin",
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await store.saveMembership({
      organizationId: SEED_TENANT_ID,
      userId: "viewer-user",
      role: "viewer",
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const approval = {
      metadata: {
        requiredRoles: ["admin", "lead_architect"],
        allowedDecisions: ["approved", "rejected"],
      },
    };

    await expect(
      assertApprovalDecisionAuthorized({
        studioStore: store,
        principal: { userId: "viewer-user", tenantId: SEED_TENANT_ID },
        tenantId: SEED_TENANT_ID,
        approval,
        decision: "approved",
      }),
    ).rejects.toBeInstanceOf(ApiError);

    await expect(
      assertApprovalDecisionAuthorized({
        studioStore: store,
        principal: { userId: "admin-user", tenantId: SEED_TENANT_ID },
        tenantId: SEED_TENANT_ID,
        approval,
        decision: "needs_clarification",
      }),
    ).rejects.toMatchObject({ status: 400 });

    const legacy = await assertApprovalDecisionAuthorized({
      studioStore: undefined,
      principal: { userId: "admin-user", tenantId: SEED_TENANT_ID },
      tenantId: SEED_TENANT_ID,
      approval,
      decision: "approved",
    });
    expect(legacy).toEqual({ reviewerId: "admin-user", reviewerRole: "admin" });

    const authorized = await assertApprovalDecisionAuthorized({
      studioStore: store,
      principal: { userId: "admin-user", tenantId: SEED_TENANT_ID },
      tenantId: SEED_TENANT_ID,
      approval,
      decision: "approved",
    });
    expect(authorized).toEqual({ reviewerId: "admin-user", reviewerRole: "admin" });
  });
});
