/** @jest-environment jsdom */
import { act } from "react";
import { FlowCanvas } from "../apps/web/src/components/workflow/FlowCanvas";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { createEmptyDefinition, createNode } from "@multi-agent/types";
import { renderUi } from "./renderUi";
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

let mockProps: any;
let mockRenders = 0;
jest.mock("@xyflow/react", () => ({
  ReactFlow: (props: any) => { mockRenders++; mockProps = props; return <div>Flow</div>; },
  Background: () => null, BackgroundVariant: { Dots: "dots" }, Controls: () => null, MiniMap: () => null,
  MarkerType: { ArrowClosed: "arrow" }, useReactFlow: () => ({ screenToFlowPosition: () => ({ x: 0, y: 0 }) }),
}));
jest.mock("../apps/web/src/components/workflow/nodes/WorkflowNodes", () => ({ workflowNodeTypes: {} }));
jest.mock("../apps/web/src/components/workflow/edges/WorkflowEdge", () => ({ workflowEdgeTypes: {} }));
test("Live without a snapshot never renders the draft topology", async () => {
  const draft = { ...createEmptyDefinition("Draft"), nodes: [createNode("input", { x: 0, y: 0 })] };
  useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), definition: draft });
  const view = await renderUi(<FlowCanvas live liveDefinition={null} />);
  expect(mockProps.nodes).toEqual([]);
  expect(view.container.textContent).toContain("Loading run graph");
  expect(view.container.textContent).not.toContain("Empty canvas");
  await view.unmount();
});

test("Live displays snapshot, blocks canvas mutation callbacks and restores draft", async () => {
  const draft = { ...createEmptyDefinition("Draft"), nodes: [createNode("input", { x: 0, y: 0 })] };
  const snapshot = { ...createEmptyDefinition("Snapshot"), nodes: [createNode("output", { x: 1, y: 1 })] };
  useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), definition: draft });
  const before = useWorkflowStore.getState();
  const view = await renderUi(<FlowCanvas live liveDefinition={snapshot}/>);
  expect(mockProps.nodes[0].id).toBe(snapshot.nodes[0].id);
  expect(mockProps.nodesDraggable).toBe(false);
  expect(mockProps.nodesConnectable).toBe(false);
  expect(mockProps.deleteKeyCode).toBeNull();
  act(() => {
    mockProps.onNodesChange([{ type: "remove", id: draft.nodes[0].id }]);
    mockProps.onEdgesChange([{ type: "remove", id: "e" }]);
    mockProps.onConnect({ source: "a", target: "b" });
    mockProps.onNodeDragStart();
    mockProps.onSelectionChange({ nodes: [{ id: "other" }], edges: [] });
  });
  expect(useWorkflowStore.getState().definition).toBe(before.definition);
  expect(useWorkflowStore.getState().isDirty).toBe(false);
  expect(useWorkflowStore.getState().selectedNodeIds).toEqual([]);
  await view.rerender(<FlowCanvas live={false}/>);
  expect(mockProps.nodes[0].id).toBe(draft.nodes[0].id);
  expect(mockProps.nodesDraggable).toBe(true);
  await view.unmount();
});

import { useRunStore } from "../apps/web/src/store/useRunStore";
import type { RunEvent } from "@multi-agent/types";
test("lifecycle updates project to the graph while stream-only events keep node and edge identities", async () => {
  const node = createNode("input", { x: 0, y: 0 });
  const definition = { ...createEmptyDefinition("Live"), nodes: [node], edges: [{ id: "e", source: node.id, target: "b", kind: "normal" as const, label: "", branchKey: "" }] };
  useRunStore.setState({ ...useRunStore.getInitialState() });
  useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), definition });
  const inspect = jest.fn();
  const view = await renderUi(<FlowCanvas live liveDefinition={definition} onInspectNode={inspect} />);
  act(() => mockProps.onNodeClick({}, { id: node.id }));
  expect(inspect).toHaveBeenCalledWith(node.id);
  const event = (type: RunEvent["type"], sequence: number, payload = {}): RunEvent => ({ id: String(sequence), runId: "r", nodeId: node.id, type, sequence, timestamp: "2026-11-04T00:00:00Z", payload });
  act(() => useRunStore.setState({ events: [event("node.started", 1), event("edge.traversed", 2, { edgeId: "e" })] }));
  act(() => jest.advanceTimersByTime(32));
  expect(mockProps.nodes[0].data.liveStatus).toBe("running"); expect(mockProps.edges[0].data.traversed).toBe(true);
  const nodes = mockProps.nodes, edges = mockProps.edges;
  act(() => useRunStore.setState(s => ({ events: [...s.events, event("log", 3, { content: "chunk" })] })));
  expect(mockProps.nodes).toBe(nodes); expect(mockProps.edges).toBe(edges);
  await view.unmount();
});


test("bursty tool lifecycle events commit once per bounded 32ms window without extending its deadline", async () => {
  jest.useFakeTimers();
  const node = createNode("tool", { x: 0, y: 0 });
  const definition = { ...createEmptyDefinition("Burst"), nodes: [node] };
  useRunStore.setState({ ...useRunStore.getInitialState(), runId: "r" });
  useWorkflowStore.setState({ ...useWorkflowStore.getInitialState(), definition });
  const view = await renderUi(<FlowCanvas live liveDefinition={definition} />);
  try {
    const initialNodes = mockProps.nodes;
    const initialRenders = mockRenders;
    const append = (type: RunEvent["type"], sequence: number) => useRunStore.setState(state => ({ events: [...state.events, { id: String(sequence), runId: "r", nodeId: node.id, type, sequence, timestamp: "2026-11-04T00:00:00Z", payload: {} }] }));
    act(() => append("tool.started", 1));
    act(() => jest.advanceTimersByTime(10));
    act(() => append("tool.completed", 2));
    act(() => jest.advanceTimersByTime(10));
    act(() => append("tool.started", 3));
    act(() => append("tool.completed", 4));
    expect(mockProps.nodes).toBe(initialNodes);
    expect(mockRenders).toBe(initialRenders);
    act(() => jest.advanceTimersByTime(12));
    expect(mockRenders).toBe(initialRenders + 1);
    expect(mockProps.nodes[0].data.liveStatus).toBe("completed");
    const scheduled = jest.spyOn(globalThis, "setTimeout");
    const cleared = jest.spyOn(globalThis, "clearTimeout");
    act(() => append("tool.started", 5));
    const handle = scheduled.mock.results[scheduled.mock.calls.findIndex(call => call[1] === 32)].value;
    await view.unmount();
    expect(cleared).toHaveBeenCalledWith(handle);
    scheduled.mockRestore(); cleared.mockRestore();
  } finally { jest.useRealTimers(); }
});
