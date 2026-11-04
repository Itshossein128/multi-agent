/** @jest-environment jsdom */
import type { ComponentType } from "react";
import { createNode } from "@multi-agent/types";
import { workflowNodeTypes } from "../apps/web/src/components/workflow/nodes/WorkflowNodes";
import { renderUi } from "./renderUi";
jest.mock("@xyflow/react", () => ({ Handle: () => null, Position: { Top: "top", Bottom: "bottom" } }));
test.each(["idle", "running", "waiting_human", "completed", "failed", "skipped"])("renders %s status with explicit label and treatment on every node type", async status => {
  for (const type of ["input", "output", "agent", "tool", "memory", "approval", "condition"] as const) {
    const Component = workflowNodeTypes[type] as ComponentType<any>;
    const view = await renderUi(<Component selected={false} data={{ node: createNode(type, { x: 0, y: 0 }), issueCount: 0, liveStatus: status, liveErrorCode: status === "failed" ? "TOOL_OUTPUT_INVALID" : undefined }} />);
    const shell = view.container.querySelector(`[data-live-status="${status}"]`)!;
    expect(shell).not.toBeNull();
    expect(view.container.textContent).toContain(status === "waiting_human" ? "Waiting for approval" : status[0].toUpperCase() + status.slice(1));
    if (status === "skipped") expect(shell.className).toContain("opacity-50");
    if (status === "running") expect(view.container.querySelector(".animate-spin")).not.toBeNull();
    if (status === "failed") expect(view.container.textContent).toContain("TOOL_OUTPUT_INVALID");
    await view.unmount();
  }
});
