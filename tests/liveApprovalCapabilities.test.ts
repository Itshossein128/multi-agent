import type { ApprovalRequest } from "@multi-agent/types";
import type { RequestPrincipal } from "../apps/server/src/auth/principal";
import type { StudioStore } from "../src/studio/contracts";
import type { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunApiService } from "../apps/server/src/api/runs/runApiService";

function fixture(role: "viewer" | "member", approvalRoles: string[], options: { ownerId?: string; permissions?: RequestPrincipal["permissions"] } = {}) {
 const principal = { userId: "reviewer", tenantId: "t", ...(options.permissions !== undefined ? { permissions: options.permissions } : {}) };
 const approval: ApprovalRequest = { id: "a", runId: "r", nodeId: "n", status: "requested", message: "Review", requestedAt: "2026-11-04T00:00:00Z", metadata: { requiredRoles: ["lead_architect"], allowedDecisions: ["approved", "rejected"], canDecide: true, viewerAllowedDecisions: ["approved"] } };
 const directory = { getMembership: jest.fn(async () => ({ role, status: "active", metadata: { approvalRoles } })) } as unknown as StudioStore;
 const resolveApproval = jest.fn();
 const executor = { getStore: () => ({ get: () => ({ run: { id: "r", tenantId: "t", ownerId: options.ownerId ?? "reviewer" } }), listApprovals: () => [approval], getApproval: () => approval }), resolveApproval } as unknown as RunExecutor;
 return { service: new RunApiService(executor, async () => null, directory, async () => principal), principal, approval, resolveApproval };
}
test.each(["viewer", "member"] as const)("legacy service without permission claims reflects trusted %s approval role overrides", async role => {
 const f = fixture(role, ["lead_architect"]);
 const [response] = await f.service.approvals("r", f.principal);
 expect(response.metadata).toMatchObject({ canDecide: true, viewerAllowedDecisions: ["approved", "rejected"] });
 expect(response).not.toBe(f.approval); expect(response.metadata).not.toBe(f.approval.metadata);
 expect(f.approval.metadata.viewerAllowedDecisions).toEqual(["approved"]);
 await f.service.resolveApproval("r", "a", { decision: "approved" }, f.principal);
 expect(f.resolveApproval).toHaveBeenCalledWith("r", "a", expect.objectContaining({ reviewerId: "reviewer", reviewerRole: "lead_architect" }));
});
test("response overwrites forged hints, and denied custom overrides cannot authorize actions", async () => {
 const f = fixture("member", []);
 const [response] = await f.service.approvals("r", f.principal);
 expect(response.metadata).toMatchObject({ canDecide: false, viewerAllowedDecisions: [] });
 expect(f.approval.metadata.canDecide).toBe(true);
 await expect(f.service.resolveApproval("r", "a", { decision: "approved", reviewerRole: "lead_architect" }, f.principal)).rejects.toMatchObject({ status: 403 });
 expect(f.resolveApproval).not.toHaveBeenCalled();
});

import { createRunsRouter } from "../apps/server/src/api/runs";
test("GET approvals route binds capability hints to the authenticated request principal", async () => {
 const principal = { userId: "reviewer", tenantId: "t" };
 const approval: ApprovalRequest = { id: "a", runId: "r", nodeId: "n", status: "requested", message: "Review", requestedAt: "2026-11-04T00:00:00Z", metadata: { canDecide: false, viewerAllowedDecisions: [] } };
 const executor = { getStore: () => ({ get: () => ({ run: { id: "r", tenantId: "t", ownerId: "reviewer" } }), listApprovals: () => [approval], getApproval: () => approval }) } as unknown as RunExecutor;
 const { app } = createRunsRouter(executor, async () => null, undefined, async () => principal);
 const response = await app.request("http://localhost/r/approvals");
 expect(response.status).toBe(200);
 expect((await response.json() as ApprovalRequest[])[0].metadata).toMatchObject({ canDecide: true, viewerAllowedDecisions: ["approved", "rejected", "needs_clarification"] });
 expect(approval.metadata.canDecide).toBe(false);
});

test("read-all non-owners receive no write capabilities despite trusted reviewer roles", async () => {
 const f = fixture("member", ["lead_architect"], { ownerId: "another-user", permissions: ["runs.read_all", "runs.execute"] });
 expect(f.service.canAccess(f.principal, "r", true)).toBe(true);
 expect(f.service.canAccess(f.principal, "r", false)).toBe(false);
 expect((await f.service.approvals("r", f.principal))[0].metadata).toMatchObject({ canDecide: false, viewerAllowedDecisions: [] });
});
test.each(["viewer", "member"] as const)("explicit %s permissions without execute do not advertise approval capabilities", async role => {
 const f = fixture(role, ["lead_architect"], { permissions: ["resources.read"] });
 expect((await f.service.approvals("r", f.principal))[0].metadata).toMatchObject({ canDecide: false, viewerAllowedDecisions: [] });
});
test("run owner with execute permission and trusted custom role receives allowed capabilities", async () => {
 const f = fixture("member", ["lead_architect"], { permissions: ["runs.execute"] });
 expect((await f.service.approvals("r", f.principal))[0].metadata).toMatchObject({ canDecide: true, viewerAllowedDecisions: ["approved", "rejected"] });
});
