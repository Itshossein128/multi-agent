/** @jest-environment jsdom */
import { act } from "react";
import { EditorToolbar } from "../apps/web/src/components/workflow/EditorToolbar";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { renderUi } from "./renderUi";
const mockEnter = jest.fn(async () => { });
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../apps/web/src/components/organization/OrgProvider", () => ({ useOrgPath: () => (path: string) => `/o/pga${path}` }));
jest.mock("@xyflow/react", () => ({ useReactFlow: () => ({ zoomIn: jest.fn(), zoomOut: jest.fn(), fitView: jest.fn() }) }));
jest.mock("../apps/web/src/services/runService", () => ({ runService: { startRun: jest.fn(async () => ({ runId: "r1" })) } }));
import { runService } from "../apps/web/src/services/runService";
test("Run persists snapshot and enters Live on the editor", async () => {
  useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), loadState: "ready", issues: [] });
  const session = { mode: "design" as const, enterLive: mockEnter, exitLive: jest.fn() };
  const view = await renderUi(<EditorToolbar session={session}/>);
  const button = [...view.container.querySelectorAll("button")].find(b => b.textContent === "Run")!;
  await act(async () => button.click());
  expect(runService.startRun).toHaveBeenCalled();
  expect(mockEnter).toHaveBeenCalledWith("r1", useWorkflowStore.getState().definition);
  expect(JSON.parse(sessionStorage.getItem("run-definition:r1")!)).toEqual(useWorkflowStore.getState().definition);
  expect(mockPush).not.toHaveBeenCalled();
  await view.unmount();
});

test("Run is disabled until the requested workflow has finished loading", async () => {
 useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), loadState: "loading", issues: [] });
 const view = await renderUi(<EditorToolbar session={{ mode: "design", enterLive: mockEnter, exitLive: jest.fn() }} />);
 const run = [...view.container.querySelectorAll("button")].find(button => button.textContent === "Run")!;
 expect(run.disabled).toBe(true);
 act(() => useWorkflowStore.setState({ loadState: "ready" })); expect(run.disabled).toBe(false);
 await view.unmount();
});

test("New Run from Live confirms before replacing the attached observation", async () => {
  useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), loadState: "ready", issues: [] });
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  (runService.startRun as jest.Mock).mockResolvedValueOnce({ runId: "r2" });
  const view = await renderUi(<EditorToolbar session={{ mode: "live", enterLive: mockEnter, exitLive: jest.fn() }} />);
  const button = [...view.container.querySelectorAll("button")].find(b => b.textContent === "New Run")!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(confirm).toHaveBeenCalled();
  expect(runService.startRun).toHaveBeenCalled();
  expect(mockEnter).toHaveBeenCalledWith("r2", useWorkflowStore.getState().definition);
  confirm.mockRestore();
  await view.unmount();
});

test("declining the Live new-run confirmation does not start a run", async () => {
  useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), loadState: "ready", issues: [] });
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  mockEnter.mockClear();
  (runService.startRun as jest.Mock).mockClear();
  const view = await renderUi(<EditorToolbar session={{ mode: "live", enterLive: mockEnter, exitLive: jest.fn() }} />);
  await act(async () => [...view.container.querySelectorAll("button")].find(b => b.textContent === "New Run")!.click());
  expect(runService.startRun).not.toHaveBeenCalled();
  expect(mockEnter).not.toHaveBeenCalled();
  confirm.mockRestore();
  await view.unmount();
});
