import type { ApprovalRequest } from "@multi-agent/types";
import { ApprovalNotActionableError, createLiveApprovalActions } from "../apps/web/src/components/workflow/live/liveApprovalActions";
import { runService } from "../apps/web/src/services/runService";
jest.mock("../apps/web/src/services/runService", () => ({ runService: { resolveApproval: jest.fn(async () => ({ ok: true })), getRunClarification: jest.fn(), submitRunClarification: jest.fn() } }));
const approval: ApprovalRequest = { id: "a", runId: "r", nodeId: "n", status: "requested", message: "Review", requestedAt: "2026-11-04T00:00:00Z", metadata: {} };
beforeEach(() => jest.clearAllMocks());
test.each(["approved", "rejected", "needs_clarification"] as const)("%s delegates to the existing authenticated API", async decision => {
  const actions = createLiveApprovalActions("r", () => [approval]);
  await actions.resolve("a", decision, " notes ");
  expect(runService.resolveApproval).toHaveBeenCalledWith("r", "a", decision, "notes");
  await expect(actions.resolve("a", decision)).rejects.toBeInstanceOf(ApprovalNotActionableError);
  expect(runService.resolveApproval).toHaveBeenCalledTimes(1);
});
test("resolved, foreign-run and disallowed requests never submit", async () => {
  for (const request of [{ ...approval, status: "approved" as const }, { ...approval, runId: "other" }, { ...approval, metadata: { allowedDecisions: ["rejected"] } }]) {
    await expect(createLiveApprovalActions("r", () => [request]).resolve("a", "approved")).rejects.toThrow(/already resolved|not actionable/i);
  }
  expect(runService.resolveApproval).not.toHaveBeenCalled();
});
test("inflight duplicate decisions are blocked but rejected requests can retry", async () => {
  let release!: () => void;
  (runService.resolveApproval as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const actions = createLiveApprovalActions("r", () => [approval]);
  const first = actions.resolve("a", "approved");
  await expect(actions.resolve("a", "rejected")).rejects.toBeInstanceOf(ApprovalNotActionableError);
  release(); await first;
  const retry = createLiveApprovalActions("r", () => [approval]);
  (runService.resolveApproval as jest.Mock).mockRejectedValueOnce(new Error("Forbidden"));
  await expect(retry.resolve("a", "approved")).rejects.toThrow("Forbidden");
  await retry.resolve("a", "approved");
  expect(runService.resolveApproval).toHaveBeenCalledTimes(3);
});

test("a clarification request can later be approved while the original request remains pending", async () => {
  const actions = createLiveApprovalActions("r", () => [approval]);
  await actions.resolve("a", "needs_clarification");
  await expect(actions.resolve("a", "needs_clarification")).rejects.toBeInstanceOf(ApprovalNotActionableError);
  await actions.resolve("a", "approved");
  expect(runService.resolveApproval).toHaveBeenCalledTimes(2);
});
