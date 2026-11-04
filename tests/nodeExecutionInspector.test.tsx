/** @jest-environment jsdom */
import { useState, act } from "react";
import { NodeExecutionInspector } from "../apps/web/src/components/workflow/live/NodeExecutionInspector";
import { useRunStore } from "../apps/web/src/store/useRunStore";
import type { RunEvent } from "@multi-agent/types";
import { renderUi } from "./renderUi";
let mockReadableRenders = 0;
jest.mock("../apps/web/src/components/runs/ReadableContent", () => ({ ReadableContent: ({ text }: { text: string }) => { mockReadableRenders++; return <div>{text}</div>; } }));
test("inspector shows evidence, updates only for its node, and closes without replacing canvas", async () => {
 const event = (id: string, nodeId: string, content: string): RunEvent => ({ id, runId: "r", nodeId, type: "log", sequence: Number(id), timestamp: "2026-11-04T00:00:00Z", payload: { content } });
 useRunStore.setState({ ...useRunStore.getInitialState(), events: [event("1", "n", "hello")] });
 function Host() { const [open, setOpen] = useState(true); return <><div data-testid="canvas" />{open && <NodeExecutionInspector nodeId="n" onClose={() => setOpen(false)} />}</>; }
 const view = await renderUi(<Host />);
 const canvas = view.container.querySelector('[data-testid="canvas"]');
 expect(view.container.querySelector('[aria-label="Node execution inspector"]')).not.toBeNull();
 for (const label of ["Input", "Timing", "Stream", "Tools", "Result", "Error"]) expect(view.container.textContent).toContain(label);
 expect(view.container.textContent).toContain("hello");
 const renders = mockReadableRenders;
 act(() => useRunStore.setState(s => ({ events: [...s.events, event("2", "other", "unrelated")] })));
 expect(mockReadableRenders).toBe(renders);
 act(() => useRunStore.setState(s => ({ events: [...s.events, event("3", "n", " world")] })));
 expect(view.container.textContent).toContain("hello world");
 await act(async () => view.container.querySelector<HTMLButtonElement>('[aria-label="Close inspector"]')!.click());
 expect(view.container.querySelector('[aria-label="Node execution inspector"]')).toBeNull();
 expect(view.container.querySelector('[data-testid="canvas"]')).toBe(canvas); await view.unmount();
});
