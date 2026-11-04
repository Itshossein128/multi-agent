/** @jest-environment jsdom */
import { act } from "react";
import type { ApprovalRequest, ClarificationPackage } from "@multi-agent/types";
import { renderUi } from "./renderUi";
import { LiveApprovalBanner } from "../apps/web/src/components/workflow/live/LiveApprovalBanner";
import { useRunStore } from "../apps/web/src/store/useRunStore";
import { runService } from "../apps/web/src/services/runService";
let mockRole = "member";
jest.mock("../apps/web/src/components/organization/OrgProvider", () => ({ useOptionalOrg: () => ({ org: { role: mockRole } }) }));
jest.mock("../apps/web/src/services/runService", () => ({ runService: { resolveApproval: jest.fn(async () => ({ ok: true })), getApprovals: jest.fn(async () => []), getRunClarification: jest.fn(), submitRunClarification: jest.fn() } }));
const approval: ApprovalRequest = { id: "a", runId: "r", nodeId: "n", status: "requested", message: "Review step", requestedAt: "2026-11-04T00:00:00Z", metadata: {} };
beforeEach(() => { mockRole = "member"; jest.clearAllMocks(); useRunStore.setState({ ...useRunStore.getInitialState(), runId: "r", approvals: [approval] }); });
test("pending requests expose a node focus action and disappear after resolution", async () => {
 const inspect = jest.fn(); const view = await renderUi(<LiveApprovalBanner runId="r" onInspectNode={inspect} />);
 expect(view.container.querySelector('[aria-label="Live human approval"]')).not.toBeNull();
 const focus = view.container.querySelector<HTMLButtonElement>('[data-approval-node="n"]')!;
 await act(async () => focus.click()); expect(inspect).toHaveBeenCalledWith("n");
 act(() => useRunStore.setState({ approvals: [{ ...approval, status: "approved" }] }));
 expect(view.container.querySelector('[aria-label="Live human approval"]')).toBeNull(); await view.unmount();
});
test("viewers see the request without decision controls", async () => {
 mockRole = "viewer"; const view = await renderUi(<LiveApprovalBanner runId="r" />);
 expect(view.container.textContent).toContain("Review step");
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Review decisions")!.click());
 expect([...view.container.querySelectorAll("button")].some(button => button.textContent === "Approve")).toBe(false);
 await view.unmount();
});
test("clarification questions load and submit without navigation", async () => {
 const pkg: ClarificationPackage = { status: "pending", runId: "r", nodeId: "n", approvalId: "a", questions: [{ id: "q", prompt: "Which environment?" }], canSubmit: true, continuation: "resume", extraction: "structured" };
 (runService.getRunClarification as jest.Mock).mockResolvedValue(pkg);
 (runService.submitRunClarification as jest.Mock).mockResolvedValue({ ok: true, package: { ...pkg, status: "answered", canSubmit: false } });
 useRunStore.setState({ approvals: [{ ...approval, context: { purpose: "clarification" } }] });
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 expect(runService.getRunClarification).toHaveBeenCalledWith("r");
 const input = view.container.querySelector<HTMLTextAreaElement>('[aria-label="Which environment?"]')!;
 const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
 await act(async () => { setter.call(input, "staging"); input.dispatchEvent(new Event("input", { bubbles: true })); });
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Submit answers")!.click());
 expect(runService.submitRunClarification).toHaveBeenCalledWith("r", [{ questionId: "q", value: "staging" }], expect.any(String));
 expect(view.container.textContent).toContain("Answers submitted"); await view.unmount();
});

test("ordinary decisions reuse ApprovalPanel and refresh pending requests", async () => {
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Review decisions")!.click());
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Approve")!.click());
 expect(runService.resolveApproval).toHaveBeenCalledWith("r", "a", "approved", undefined);
 expect(runService.getApprovals).toHaveBeenCalledWith("r");
 expect(view.container.querySelector('[aria-label="Live human approval"]')).toBeNull(); await view.unmount();
});
test("needs-clarification decision loads the existing run clarification package", async () => {
 (runService.getRunClarification as jest.Mock).mockResolvedValue({ status: "pending", runId: "r", nodeId: "n", approvalId: "a", questions: [{ id: "q", prompt: "Which branch?" }], canSubmit: true, continuation: "resume", extraction: "structured" });
 (runService.getApprovals as jest.Mock).mockResolvedValueOnce([approval]);
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Review decisions")!.click());
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Needs clarification")!.click());
 expect(runService.resolveApproval).toHaveBeenCalledWith("r", "a", "needs_clarification", undefined);
 expect(runService.getRunClarification).toHaveBeenCalledWith("r");
 expect(view.container.querySelector('[aria-label="Which branch?"]')).not.toBeNull(); await view.unmount();
});
test("gate-required roles suppress decision controls for a known non-reviewer", async () => {
 useRunStore.setState({ approvals: [{ ...approval, metadata: { requiredRoles: ["admin"] } }] });
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Review decisions")!.click());
 expect(view.container.textContent).toContain("authorized reviewer");
 expect([...view.container.querySelectorAll("button")].some(button => button.textContent === "Approve")).toBe(false); await view.unmount();
});

test("a stale clarification package cannot submit after its matching approval disappears", async () => {
 const pkg: ClarificationPackage = { status: "pending", runId: "r", nodeId: "n", approvalId: "a", questions: [{ id: "q", prompt: "Which environment?" }], canSubmit: true, continuation: "resume", extraction: "structured" };
 (runService.getRunClarification as jest.Mock).mockResolvedValue(pkg);
 useRunStore.setState({ approvals: [{ ...approval, context: { purpose: "clarification" } }] });
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 act(() => useRunStore.setState({ approvals: [] }));
 expect(view.container.querySelector("form")).toBeNull();
 expect(view.container.querySelector('[aria-label="Live human approval"]')).toBeNull();
 expect(runService.submitRunClarification).not.toHaveBeenCalled(); await view.unmount();
});

test.each(["viewer", "member"])("trusted server capability allows %s with custom role override to decide", async role => {
 mockRole = role;
 useRunStore.setState({ approvals: [{ ...approval, metadata: { requiredRoles: ["lead_architect"], canDecide: true, viewerAllowedDecisions: ["approved"] } }] });
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Review decisions")!.click());
 const buttons = [...view.container.querySelectorAll("button")];
 expect(buttons.some(button => button.textContent === "Reject")).toBe(false);
 await act(async () => buttons.find(button => button.textContent === "Approve")!.click());
 expect(runService.resolveApproval).toHaveBeenCalledWith("r", "a", "approved", undefined); await view.unmount();
});
test("trusted denied capability disables a member despite default coarse role access", async () => {
 useRunStore.setState({ approvals: [{ ...approval, metadata: { canDecide: false, viewerAllowedDecisions: [] } }] });
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Review decisions")!.click());
 expect([...view.container.querySelectorAll("button")].some(button => button.textContent === "Approve")).toBe(false); await view.unmount();
});

test("viewer with trusted approval capability can submit structured clarification", async () => {
 mockRole = "viewer";
 const pkg: ClarificationPackage = { status: "pending", runId: "r", nodeId: "n", approvalId: "a", questions: [{ id: "q", prompt: "Which environment?" }], canSubmit: true, continuation: "resume", extraction: "structured" };
 (runService.getRunClarification as jest.Mock).mockResolvedValue(pkg);
 (runService.submitRunClarification as jest.Mock).mockResolvedValue({ ok: true, package: { ...pkg, status: "answered", canSubmit: false } });
 useRunStore.setState({ approvals: [{ ...approval, context: { purpose: "clarification" }, metadata: { canDecide: true, viewerAllowedDecisions: ["approved"] } }] });
 const view = await renderUi(<LiveApprovalBanner runId="r" />);
 const input = view.container.querySelector<HTMLTextAreaElement>('[aria-label="Which environment?"]')!;
 const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
 await act(async () => { setter.call(input, "staging"); input.dispatchEvent(new Event("input", { bubbles: true })); });
 await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Submit answers")!.click());
 expect(runService.submitRunClarification).toHaveBeenCalledWith("r", [{ questionId: "q", value: "staging" }], expect.any(String)); await view.unmount();
});
