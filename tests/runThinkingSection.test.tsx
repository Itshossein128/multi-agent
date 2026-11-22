/** @jest-environment jsdom */
import React from "react";
import type { Run, RunEvent } from "@multi-agent/types";
import { renderUi } from "./renderUi";
import { RunThinkingSection } from "../apps/web/src/components/runs/RunThinkingSection";

const baseRun: Run = {
  id: "run-1",
  workflowId: "wf-1",
  status: "running",
  startedAt: "2026-11-21T16:00:00.000Z",
  metadata: {},
};

test("shows a clean Current Step banner instead of 'Thinking has not arrived yet' while a CLI agent runs", async () => {
  const events: RunEvent[] = [
    {
      id: "e1",
      runId: "run-1",
      nodeId: "node-stage8-knowledge-sync",
      type: "node.started",
      sequence: 1,
      timestamp: "2026-11-21T16:00:01.000Z",
      payload: { attempt: 1 },
    },
    {
      id: "e2",
      runId: "run-1",
      nodeId: "node-stage8-knowledge-sync",
      type: "agent.started",
      sequence: 2,
      timestamp: "2026-11-21T16:00:02.000Z",
      payload: { provider: "codex", args: ["exec", "--model", "gpt-6.2-sol"] },
    },
  ];
  const view = await renderUi(<RunThinkingSection events={events} run={baseRun} />);
  expect(view.container.textContent).toContain("Current step");
  expect(view.container.textContent).toContain("Stage 8 Knowledge Sync");
  expect(view.container.textContent).toContain("codex");
  expect(view.container.textContent).toContain("gpt-6.2-sol");
  expect(view.container.textContent).not.toContain("Thinking has not arrived yet");
  await view.unmount();
});

test("renders nothing for completed runs when no agent shared thinking", async () => {
  const events: RunEvent[] = [
    { id: "e1", runId: "run-1", nodeId: "node-stage8-knowledge-sync", type: "agent.started", sequence: 1, timestamp: "2026-11-21T16:00:00Z", payload: {} },
    { id: "e2", runId: "run-1", nodeId: "node-stage8-knowledge-sync", type: "log", sequence: 2, timestamp: "2026-11-21T16:01:00Z", payload: { channel: "thinking", thoughts: "", thinkingStatus: "none", final: true, part: 0 } },
    { id: "e3", runId: "run-1", nodeId: "node-stage8-knowledge-sync", type: "node.completed", sequence: 3, timestamp: "2026-11-21T16:01:01Z", payload: {} },
  ];
  const view = await renderUi(<RunThinkingSection events={events} run={{ ...baseRun, status: "completed" }} />);
  expect(view.container.textContent).toBe("");
  await view.unmount();
});

test("renders Agent reasoning section when a step actually shared thinking", async () => {
  const events: RunEvent[] = [
    { id: "e1", runId: "run-1", nodeId: "node-speckit-specify", type: "agent.started", sequence: 1, timestamp: "2026-11-21T16:00:00Z", payload: {} },
    { id: "e2", runId: "run-1", nodeId: "node-speckit-specify", type: "log", sequence: 2, timestamp: "2026-11-21T16:00:10Z", payload: { channel: "thinking", thoughts: "Checking B04 dependencies.", thinkingStatus: "shared", final: true, part: 0 } },
    { id: "e3", runId: "run-1", nodeId: "node-speckit-specify", type: "node.completed", sequence: 3, timestamp: "2026-11-21T16:01:00Z", payload: {} },
  ];
  const view = await renderUi(<RunThinkingSection events={events} run={{ ...baseRun, status: "completed" }} />);
  expect(view.container.textContent).toContain("Agent reasoning");
  expect(view.container.textContent).toContain("Checking B04 dependencies.");
  await view.unmount();
});
