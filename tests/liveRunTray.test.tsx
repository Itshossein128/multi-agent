/** @jest-environment jsdom */
import { act } from "react";
import type { Run, RunEvent } from "@multi-agent/types";
import { LiveRunTray } from "../apps/web/src/components/workflow/live/LiveRunTray";
import { useRunStore } from "../apps/web/src/store/useRunStore";
import { runService } from "../apps/web/src/services/runService";
import { renderUi } from "./renderUi";
jest.mock("../apps/web/src/services/runService", () => ({ runService: { cancelRun: jest.fn(async () => ({ status: "cancelled" })), retryRun: jest.fn(async () => ({ runId: "next" })) } }));
function reset(status: Run["status"]) { useRunStore.setState({ ...useRunStore.getInitialState(), runId: "r", run: { id: "r", workflowId: "w", status, startedAt: "2026-11-04T00:00:00Z", metadata: {} }, streamStatus: "live", events: [{ id: "e", runId: "r", type: "tool.started", sequence: 1, timestamp: "2026-11-04T00:00:01Z", payload: {} } as RunEvent] }); }
beforeEach(() => jest.clearAllMocks());
test("collapses feed, filters events, and cancels once without inventing terminal state", async () => {
 reset("running"); const view = await renderUi(<LiveRunTray runId="r" onRetarget={jest.fn()} />);
 expect(view.container.textContent).toContain("running"); expect(view.container.textContent).toContain("Stream: live"); expect(view.container.textContent).toContain("tool.started");
 const filter = [...view.container.querySelectorAll("button")].find(b => b.textContent === "Error")!;
 await act(async () => filter.click()); expect(view.container.textContent).not.toContain("tool.started");
 const toggle = view.container.querySelector<HTMLButtonElement>('[aria-label="Collapse run timeline"]')!;
 await act(async () => toggle.click()); expect(view.container.querySelector('[aria-label="Run events"]')).toBeNull();
 await act(async () => [...view.container.querySelectorAll("button")].find(b => b.textContent === "Cancel")!.click());
 expect(runService.cancelRun).toHaveBeenCalledTimes(1); expect(runService.cancelRun).toHaveBeenCalledWith("r"); expect(useRunStore.getState().run?.status).toBe("running");
 await view.unmount();
});
test("Retry retargets to the server-created run", async () => {
 reset("failed"); const retarget = jest.fn(async () => {}); const view = await renderUi(<LiveRunTray runId="r" onRetarget={retarget} />);
 await act(async () => [...view.container.querySelectorAll("button")].find(b => b.textContent === "Retry")!.click());
 expect(runService.retryRun).toHaveBeenCalledWith("r"); expect(retarget).toHaveBeenCalledWith("next"); await view.unmount();
});
test("duplicate clicks are blocked while a request is pending; errors stay visible", async () => {
 reset("running"); let reject!: (reason: Error) => void;
 (runService.cancelRun as jest.Mock).mockImplementationOnce(() => new Promise((_resolve, deny) => { reject = deny; }));
 const view = await renderUi(<LiveRunTray runId="r" onRetarget={jest.fn()} />);
 const cancel = [...view.container.querySelectorAll("button")].find(b => b.textContent === "Cancel")!;
 act(() => { cancel.click(); cancel.click(); }); expect(runService.cancelRun).toHaveBeenCalledTimes(1);
 await act(async () => reject(new Error("Not authorized"))); expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Not authorized");
 expect(useRunStore.getState().run?.status).toBe("running"); await view.unmount();
});

test("reattaches the same created run if attachment fails, without creating duplicate retries", async () => {
 reset("failed"); const retarget = jest.fn(async () => {}).mockRejectedValueOnce(new Error("Cannot attach yet"));
 const view = await renderUi(<LiveRunTray runId="r" onRetarget={retarget} />);
 const retry = () => [...view.container.querySelectorAll("button")].find(b => b.textContent === "Retry")!;
 await act(async () => retry().click()); expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Cannot attach yet");
 await act(async () => retry().click()); expect(runService.retryRun).toHaveBeenCalledTimes(1); expect(retarget).toHaveBeenCalledTimes(2);
 expect(retarget).toHaveBeenLastCalledWith("next"); await view.unmount();
});
test("elapsed timer advances for an active run and freezes at authoritative completion", async () => {
 jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-04T00:00:05Z")); reset("running");
 const view = await renderUi(<LiveRunTray runId="r" onRetarget={jest.fn()} />);
 try {
  expect(view.container.textContent).toContain("Elapsed 0:05");
  act(() => jest.advanceTimersByTime(2000)); expect(view.container.textContent).toContain("Elapsed 0:07");
  act(() => useRunStore.setState(s => ({ run: { ...s.run!, status: "completed", completedAt: "2026-11-04T00:00:06Z" } })));
  act(() => jest.advanceTimersByTime(10000)); expect(view.container.textContent).toContain("Elapsed 0:06");
 } finally { await view.unmount(); jest.useRealTimers(); }
});

test("streamStatus error shows recoverable reconnect copy without inventing terminal outcomes", async () => {
  reset("running");
  useRunStore.setState({ streamStatus: "error" });
  const view = await renderUi(<LiveRunTray runId="r" onRetarget={jest.fn()} />);
  expect(view.container.textContent).toContain("Stream: error");
  expect(view.container.textContent).toMatch(/Connection interrupted.*reconnect/i);
  expect(useRunStore.getState().run?.status).toBe("running");
  expect(view.container.textContent).toContain("running");
  expect(view.container.textContent).not.toMatch(/\bcompleted\b|\bfailed\b|\bcancelled\b/);
  await view.unmount();
});
