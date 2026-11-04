/** @jest-environment jsdom */
import type { ComponentType } from "react";
import { workflowEdgeTypes } from "../apps/web/src/components/workflow/edges/WorkflowEdge";
import { renderUi } from "./renderUi";
jest.mock("@xyflow/react", () => ({ BaseEdge: (props: any) => <svg><path data-testid="path" className={props.className} style={props.style} /></svg>, EdgeLabelRenderer: ({ children }: any) => children, getSmoothStepPath: () => ["M0 0", 0, 0] }));
test("traversed edges glow and animate, retaining distinct branch colors", async () => {
  const Edge = workflowEdgeTypes.workflow as ComponentType<any>;
  const props = { id: "e", selected: false, data: { edge: { kind: "normal" }, traversed: true, liveAnimated: true } };
  const view = await renderUi(<Edge {...props} />);
  const path = view.container.querySelector("path")!;
  expect(path.style.filter).toContain("drop-shadow");
  expect(path.className.baseVal).toContain("workflow-live-edge");
  const normalColor = path.style.stroke;
  await view.rerender(<Edge {...props} data={{ ...props.data, edge: { kind: "conditional" } }} />);
  expect(view.container.querySelector("path")!.style.stroke).not.toBe(normalColor);
  expect(view.container.querySelector("path")!.style.strokeDasharray).toBe("7 5");
  await view.rerender(<Edge {...props} data={{ edge: { kind: "normal" }, traversed: false, liveAnimated: false }} />);
  expect(view.container.querySelector("path")!.style.filter).toBe("");
  await view.unmount();
});
