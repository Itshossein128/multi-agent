import type { RunEvent } from "@multi-agent/types";
import {
  buildNodeOutcomeLookup,
  explainRunError,
  extractLatestAgentBlockerContext,
  formatAgentTextForReading,
  formatAnyValueForReading,
  humanizeEventLabel,
  hydrateTruncatedPayload,
  summarizeEventPreview,
} from "../apps/web/src/lib/readableAgentText";
import { redact } from "../apps/server/src/adapters/langGraphEventAdapter";
import { projectThinkingAttempts } from "../apps/web/src/lib/thinkingProjection";

describe("readableAgentText formatting for logs and agent reports", () => {
  test("converts fenced JSON agent blocker receipt into human-readable Markdown sections", () => {
    const raw = [
      "```json",
      JSON.stringify({
        status: "blocked",
        workPackage: "B03",
        verification: {
          stage5QA: "Passed: all eight B03 historical defects were verified resolved.",
          semanticIndex: "Not completed. Failed with connection_error to 127.0.0.1:1234.",
        },
        blockers: [
          "The configured local embedding endpoint at 127.0.0.1:1234 could not be reached, so the semantic index could not be refreshed.",
        ],
        acceptance: "B03 technical QA is recorded as passed.",
      }),
      "```",
    ].join("\n");

    const { markdown, formattedFromJson } = formatAgentTextForReading(raw);
    expect(formattedFromJson).toBe(true);
    expect(markdown).toContain("**Status:** `blocked`");
    expect(markdown).toContain("**Work Package:** `B03`");
    expect(markdown).toContain("### Blockers");
    expect(markdown).toContain("127.0.0.1:1234 could not be reached");
    expect(markdown).toContain("### Verification");
    expect(markdown).toContain("**Stage 5 QA:** Passed");
    expect(markdown).not.toContain("```json");
  });

  test("formats plain structured QA objects cleanly via formatAnyValueForReading", () => {
    const formatted = formatAnyValueForReading({
      qaStatus: "qa_passed",
      summary: "All 8 B03 defects verified fixed.",
      defects: [],
    });
    expect(formatted).toContain("**QA Status:** `qa_passed`");
    expect(formatted).toContain("All 8 B03 defects verified fixed.");
    expect(formatted).toContain("**Defects:** None");
  });

  test("explains WORK_PACKAGE_COMPLETION_UNVERIFIED cleanly with an actionable hint", () => {
    const explained = explainRunError(
      "WORK_PACKAGE_COMPLETION_UNVERIFIED: Work package B03 did not return its completion receipt. The next package was not started.",
      "WORK_PACKAGE_COMPLETION_UNVERIFIED",
    );
    expect(explained.title).toBe("Work package did not finish cleanly");
    expect(explained.code).toBe("WORK_PACKAGE_COMPLETION_UNVERIFIED");
    expect(explained.explanation).toBe(
      "Work package B03 did not return its completion receipt. The next package was not started.",
    );
    expect(explained.hint).toMatch(/blocker|Retry/i);
  });

  test("extractLatestAgentBlockerContext surfaces the preceding agent's blocker for a failed run", () => {
    const events: RunEvent[] = [
      {
        id: "ev-123",
        runId: "run-1",
        type: "agent.completed",
        nodeId: "node-stage8-knowledge-sync",
        agentId: "agent-velora-knowledge-updater",
        timestamp: "2026-11-21T15:37:00.056Z",
        sequence: 123,
        payload: {
          content:
            '```json\n{"status":"blocked","workPackage":"B03","blockers":["The configured local embedding endpoint at 127.0.0.1:1234 could not be reached."]}\n```',
        },
      },
      {
        id: "ev-129",
        runId: "run-1",
        type: "node.failed",
        nodeId: "node-a1-work-package-sequence",
        timestamp: "2026-11-21T15:37:00.162Z",
        sequence: 129,
        payload: {
          code: "WORK_PACKAGE_COMPLETION_UNVERIFIED",
          error: "WORK_PACKAGE_COMPLETION_UNVERIFIED: Work package B03 did not return its completion receipt.",
        },
      },
    ];

    const ctx = extractLatestAgentBlockerContext(events, 128);
    expect(ctx).not.toBeNull();
    expect(ctx?.nodeId).toBe("node-stage8-knowledge-sync");
    expect(ctx?.workPackage).toBe("B03");
    expect(ctx?.blockers).toEqual([
      "The configured local embedding endpoint at 127.0.0.1:1234 could not be reached.",
    ]);
    expect(summarizeEventPreview(events[0])).toContain("Blocked: The configured local embedding endpoint");
    expect(humanizeEventLabel("run.failed")).toBe("Run Failed");
  });

  test("server redact preserves nested nodeOutcomes and handoffs without [truncated] while redacting secrets", () => {
    const raw = {
      node: "node-stage8-knowledge-sync",
      values: {
        nodeOutcomes: {
          "node-stage8-knowledge-sync": {
            contractVersion: 1,
            status: "success",
            value: {
              status: "completed",
              workPackage: "B03",
              summary: "Semantic index updated cleanly.",
              apiKey: "sk-super-secret-value",
            },
          },
        },
        handoffs: {
          "node-stage8-knowledge-sync": {
            id: "handoff-1",
            status: "completed",
            summary: "B03 synced and verified.",
          },
        },
      },
    };
    const safe = redact(raw) as any;
    expect(safe.values.nodeOutcomes["node-stage8-knowledge-sync"].status).toBe("success");
    expect(safe.values.nodeOutcomes["node-stage8-knowledge-sync"].value.workPackage).toBe("B03");
    expect(safe.values.nodeOutcomes["node-stage8-knowledge-sync"].value.summary).toBe("Semantic index updated cleanly.");
    expect(safe.values.nodeOutcomes["node-stage8-knowledge-sync"].value.apiKey).toBe("[redacted]");
    expect(safe.values.handoffs["node-stage8-knowledge-sync"].summary).toBe("B03 synced and verified.");
  });

  test("hydrateTruncatedPayload replaces legacy [truncated] nodeOutcomes/handoffs using real timeline events", () => {
    const events: RunEvent[] = [
      {
        id: "e1",
        runId: "r1",
        type: "agent.completed",
        nodeId: "node-stage8-knowledge-sync",
        timestamp: "2026-11-21T16:00:00Z",
        sequence: 54,
        payload: {
          content: '```json\n{"status":"completed","workPackage":"B03","summary":"B03 semantic index refreshed."}\n```',
        },
      },
      {
        id: "e2",
        runId: "r1",
        type: "node.completed",
        nodeId: "node-stage8-knowledge-sync",
        timestamp: "2026-11-21T16:00:01Z",
        sequence: 56,
        payload: { step: 45 },
      },
    ];
    const legacySnapshot = {
      data: {
        node: "node-stage8-knowledge-sync",
        values: {
          nodeOutcomes: {
            "node-stage8-knowledge-sync": {
              status: "[truncated]",
              value: "[truncated]",
              contractVersion: "[truncated]",
            },
          },
          handoffs: {
            "node-stage8-knowledge-sync": {
              id: "[truncated]",
              summary: "[truncated]",
              status: "[truncated]",
            },
          },
        },
      },
    };
    const hydrated = hydrateTruncatedPayload(legacySnapshot, buildNodeOutcomeLookup(events)) as any;
    expect(hydrated.data.values.nodeOutcomes["node-stage8-knowledge-sync"]).toMatchObject({
      status: "completed",
      workPackage: "B03",
      summary: "B03 semantic index refreshed.",
    });
    expect(hydrated.data.values.handoffs["node-stage8-knowledge-sync"]).toMatchObject({
      status: "completed",
      summary: "B03 semantic index refreshed.",
    });
    expect(JSON.stringify(hydrated)).not.toContain("[truncated]");
  });

  test("projectThinkingAttempts closes in_progress attempts when a run has failed or completed", () => {
    const events: RunEvent[] = [
      { id: "e1", runId: "r1", nodeId: "n1", type: "node.started", timestamp: "2026-11-21T16:00:00Z", sequence: 1, payload: { attempt: 1 } },
      { id: "e2", runId: "r1", nodeId: "n1", type: "agent.started", timestamp: "2026-11-21T16:00:01Z", sequence: 2, payload: {} },
    ];
    const failed = projectThinkingAttempts(events, "failed", false);
    expect(failed[0].outcome).toBe("failed");
    expect(failed[0].availability).toBe("unavailable");

    const completed = projectThinkingAttempts(events, "completed", false);
    expect(completed[0].outcome).toBe("completed");
    expect(completed[0].availability).toBe("unavailable");
  });
});
