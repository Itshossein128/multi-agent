/** @jest-environment jsdom */
import React, { act } from "react";
import { renderUi } from "./renderUi";
import { createEmptyDefinition } from "@multi-agent/types";
import { useLiveCanvasSession, modeFromQuery, buildStudioQuery } from "../apps/web/src/components/workflow/live/useLiveCanvasSession";
import { isDesignMutationAllowed, type LiveCanvasController } from "../apps/web/src/components/workflow/live/liveCanvas.types";
const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter, usePathname: () => "/o/pga/org", useSearchParams: () => new URLSearchParams("workflowId=w") }));
const mockClose = jest.fn();
const mockLoad = jest.fn(async () => { });
const mockAttach = jest.fn(() => mockClose);
const mockClear = jest.fn();
jest.mock("../apps/web/src/store/useRunStore", () => ({ useRunStore: { getState: () => ({ load: mockLoad, attach: mockAttach, clear: mockClear, error: null }) } }));
const definition = createEmptyDefinition("Snapshot");
jest.mock("../apps/web/src/services/runService", () => ({ runService: { getRunDefinition: jest.fn(async () => ({ workflow: definition })) } }));
test("URL mode and mutation guard", () => {
  expect(modeFromQuery({ runId: "r" })).toBe("live");
  expect(modeFromQuery({})).toBe("design");
  expect(isDesignMutationAllowed("live")).toBe(false);
  expect(isDesignMutationAllowed("design")).toBe(true);
  expect(buildStudioQuery({ workflowId: "w", focusNode: "n" }).has("runId")).toBe(false);
  expect(buildStudioQuery({ runId: "a/b" }).get("runId")).toBe("a/b");
});
test("enter, retry retarget, exit and unmount dispose streams", async () => {
  let session!: LiveCanvasController;
  function Host() { session = useLiveCanvasSession(); return null; }
  const view = await renderUi(React.createElement(Host));
  await act(async () => { await session.enterLive("r1", definition); });
  expect(session.mode).toBe("live");
  expect(session.attachedRunId).toBe("r1");
  expect(mockAttach).toHaveBeenCalledWith("r1");
  await act(async () => { await session.enterLive("r2"); });
  expect(session.attachedRunId).toBe("r2");
  expect(mockClose).toHaveBeenCalled();
  act(() => session.exitLive());
  expect(session.mode).toBe("design");
  expect(session.attachedRunId).toBeNull();
  expect(mockReplace.mock.calls.at(-1)[0]).not.toContain("runId=");
  expect(mockClear).toHaveBeenCalled();
  await view.unmount();
});
import { runService } from "../apps/web/src/services/runService";
test("snapshot fallback survives API failure and repeated attach is idempotent", async () => {
  let session!: LiveCanvasController;
  function Host() { session = useLiveCanvasSession(); return null; }
  sessionStorage.setItem("run-definition:fallback", JSON.stringify(definition));
  (runService.getRunDefinition as jest.Mock).mockRejectedValueOnce(new Error("snapshot unavailable"));
  const view = await renderUi(React.createElement(Host));
  const calls = mockAttach.mock.calls.length;
  await act(async () => { await session.attachExistingRun("fallback"); });
  expect(session.liveDefinition).toEqual(definition);
  await act(async () => { await session.attachExistingRun("fallback"); });
  expect(mockAttach.mock.calls.length).toBe(calls + 1);
  await view.unmount();
});
test("late snapshot from a previous run cannot replace the new target", async () => {
  let session!: LiveCanvasController;
  let resolveOld!: (value: any) => void;
  function Host() { session = useLiveCanvasSession(); return null; }
  (runService.getRunDefinition as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const view = await renderUi(React.createElement(Host));
  let old!: Promise<void>;
  await act(async () => { old = session.enterLive("old"); });
  await act(async () => { await session.enterLive("new", definition); });
  await act(async () => { resolveOld({ workflow: createEmptyDefinition("Old") }); await old; });
  expect(session.attachedRunId).toBe("new");
  expect(session.liveDefinition).toEqual(definition);
  await view.unmount();
});
