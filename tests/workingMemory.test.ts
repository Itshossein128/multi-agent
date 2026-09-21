/**
 * Phase 3 - Structured Run-Scoped Working Memory (unit + ContextAssembler)
 *
 * Proves the working memory domain model is a real, separate abstraction:
 * - versioned entry model, kinds, scopes, statuses and provenance
 * - explicit CRUD/lifecycle through the WorkingMemory service abstraction
 * - untrusted model updates are validated and rejected, never thrown
 * - agent-private vs workflow-shared scope, run isolation
 * - deterministic reducers, ordering and budget selection
 * - ContextAssembler integration as a dedicated, untrusted context source
 * - separation from handoff and long-term memory
 */
import { createAgentRecord, type AgentRecord } from "@multi-agent/types";
import {
  AGENT_PRIVATE_WORKING_MEMORY,
  DEFAULT_WORKING_MEMORY_CONTEXT_BUDGET_TOKENS,
  ScopedWorkingMemory,
  WORKING_MEMORY_CONTEXT_FOOTER,
  WORKING_MEMORY_CONTEXT_HEADER,
  WORKING_MEMORY_LIMITS,
  WorkingMemoryValidationError,
  applyWorkingMemoryUpdates,
  compareWorkingMemoryEntries,
  isWorkingMemoryVisible,
  mergeWorkingMemory,
  selectWorkingMemoryForContext,
  serializeWorkingMemoryEntryForContext,
  serializeWorkingMemoryForContext,
  splitWorkingMemoryUpdates,
  extractWorkingMemoryUpdates,
  visibleWorkingMemoryEntries,
  workingMemoryDiagnostics,
  workingMemoryReference,
  type WorkingMemoryEntries,
  type WorkingMemoryEntry,
  type WorkingMemoryKind,
  type WorkingMemoryWriteContext,
} from "../src/agents/runtime/workingMemory";
import {
  DefaultContextAssembler,
  PRIORITY,
  type ContextAssemblyRequest,
} from "../src/agents/runtime/contextAssembler";
import { buildHandoff, serializeHandoffForContext } from "../src/agents/runtime/handoff";
import { DefaultMemoryService } from "../src/memory/application";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import type { MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";

// Helpers

const T0 = "2026-09-21T00:00:00.000Z";
const T1 = "2026-09-21T00:05:00.000Z";
const T2 = "2026-09-21T00:10:00.000Z";

function writeContext(overrides: Partial<WorkingMemoryWriteContext> = {}): WorkingMemoryWriteContext {
  return { runId: "run-1", workflowId: "wf-1", nodeId: "node-1", agentId: "agent-a", ...overrides };
}

/** Apply updates and merge the accepted delta, mirroring the graph reducer. */
function applyTo(current: WorkingMemoryEntries, updates: unknown, context: WorkingMemoryWriteContext = writeContext()): WorkingMemoryEntries {
  return mergeWorkingMemory(current, applyWorkingMemoryUpdates(current, updates, context).entries);
}

const idOf = (entries: WorkingMemoryEntries, kind: WorkingMemoryKind): string => {
  const entry = Object.values(entries).find(candidate => candidate.kind === kind);
  if (!entry) throw new Error(`No ${kind} entry`);
  return entry.id;
};

const estimate = (value: unknown) => String(value).length;

function makeEntry(overrides: Partial<WorkingMemoryEntry> = {}): WorkingMemoryEntry {
  return {
    version: 1,
    id: "wm-x-1",
    runId: "run-1",
    workflowId: "wf-1",
    scope: "agent",
    agentId: "agent-a",
    kind: "finding",
    content: "placeholder content",
    status: "active",
    source: { nodeId: "node-1", agentId: "agent-a" },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function makeAgent(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return { ...createAgentRecord(), id, name: id, ...overrides };
}

function makeRequest(overrides: Partial<ContextAssemblyRequest> = {}): ContextAssemblyRequest {
  return {
    runId: "run-1",
    workflowId: "wf-1",
    nodeId: "node-2",
    agentId: "agent-a",
    agent: makeAgent("agent-a"),
    task: "Continue the run",
    ...overrides,
  };
}

const assembler = new DefaultContextAssembler();
// Domain Model / Provenance

describe("working memory domain model", () => {
  test("adds a finding with versioned provenance and timestamps", () => {
    const result = applyWorkingMemoryUpdates(
      {},
      [{ kind: "finding", content: "Authentication uses signed internal principals.", scope: "workflow" }],
      writeContext({ now: () => T0, handoffId: "ho-1" }),
    );

    expect(result.rejected).toEqual([]);
    expect(result.added).toEqual(["wm-node-1-1"]);
    expect(result.entries["wm-node-1-1"]).toEqual({
      version: 1,
      id: "wm-node-1-1",
      runId: "run-1",
      workflowId: "wf-1",
      scope: "workflow",
      agentId: "agent-a",
      kind: "finding",
      content: "Authentication uses signed internal principals.",
      status: "active",
      source: { nodeId: "node-1", agentId: "agent-a", handoffId: "ho-1" },
      createdAt: T0,
      updatedAt: T0,
    });
    expect(result.diagnostics).toMatchObject({ received: 1, applied: 1, rejected: 0 });
  });

  test("omitted scope defaults to agent-private and never widens implicitly", () => {
    const result = applyWorkingMemoryUpdates({}, [{ kind: "note", content: "Local scratch value for this agent only." }], writeContext());
    expect(result.entries[result.added[0]].scope).toBe("agent");
  });

  test("generated ids are deterministic per node and never collide across branches", () => {
    const parallel = mergeWorkingMemory(
      applyWorkingMemoryUpdates({}, [{ kind: "finding", content: "Branch A found the API shape." }], writeContext({ nodeId: "node-a", agentId: "agent-a" })).entries,
      applyWorkingMemoryUpdates({}, [{ kind: "finding", content: "Branch B found the API shape." }], writeContext({ nodeId: "node-b", agentId: "agent-b" })).entries,
    );
    expect(Object.keys(parallel).sort()).toEqual(["wm-node-a-1", "wm-node-b-1"]);
    const replay = applyTo({}, [{ kind: "finding", content: "Branch A found the API shape." }], writeContext({ nodeId: "node-a" }));
    expect(Object.keys(replay)).toEqual(["wm-node-a-1"]);
  });
});

// CRUD / Lifecycle

describe("working memory lifecycle", () => {
  test("update keeps identity, advances updatedAt and preserves createdAt", () => {
    let clock = T0;
    const first = applyWorkingMemoryUpdates({}, [{ kind: "finding", content: "First statement about the API response format." }], writeContext({ now: () => clock }));
    const id = first.added[0];
    clock = T1;
    const second = applyWorkingMemoryUpdates(first.entries, [{ op: "update", id, content: "Revised statement about the API response format." }], writeContext({ now: () => clock }));

    expect(second.updated).toEqual([id]);
    expect(second.added).toEqual([]);
    expect(second.entries[id]).toMatchObject({
      id,
      content: "Revised statement about the API response format.",
      createdAt: T0,
      updatedAt: T1,
      status: "active",
    });
  });

  test("resolve question, supersede assumption and discard an invalid note", () => {
    const seeded = applyTo({}, [
      { kind: "question", content: "Does approval state survive restart?", status: "active" },
      { kind: "assumption", content: "Authentication probably uses JWT." },
      { kind: "note", content: "Raw scratch note that later proved incorrect." },
    ]);
    const questionId = idOf(seeded, "question");
    const assumptionId = idOf(seeded, "assumption");
    const noteId = idOf(seeded, "note");

    // Every step starts from merged checkpointed state, exactly like the graph reducer.
    const resolved = applyWorkingMemoryUpdates(seeded, [{ op: "update", id: questionId, status: "resolved" }], writeContext({ now: () => T1 }));
    const afterResolve = mergeWorkingMemory(seeded, resolved.entries);
    expect(afterResolve[questionId].status).toBe("resolved");

    const superseded = applyWorkingMemoryUpdates(afterResolve, [
      { kind: "finding", content: "Authentication actually uses signed HMAC principals.", supersedes: assumptionId },
    ], writeContext({ now: () => T2 }));
    const afterSupersede = mergeWorkingMemory(afterResolve, superseded.entries);
    const findingId = superseded.added[0];
    expect(afterSupersede[assumptionId]).toMatchObject({ status: "superseded", supersededBy: findingId, updatedAt: T2 });
    expect(afterSupersede[findingId]).toMatchObject({ status: "active", supersedes: assumptionId, kind: "finding" });
    expect(superseded.updated).toContain(assumptionId);
    // The write result is a delta of created/modified entries, not the whole state.
    expect(Object.keys(superseded.entries).sort()).toEqual([assumptionId, findingId].sort());
    expect(Object.keys(afterSupersede).sort()).toEqual([assumptionId, noteId, questionId, findingId].sort());

    const discarded = applyWorkingMemoryUpdates(afterSupersede, [{ op: "update", id: noteId, status: "discarded" }], writeContext({ now: () => T2 }));
    const afterDiscard = mergeWorkingMemory(afterSupersede, discarded.entries);
    expect(afterDiscard[noteId].status).toBe("discarded");

    // Lifecycle is auditable: nothing was physically deleted.
    expect(Object.keys(afterDiscard)).toHaveLength(4);
    expect(afterDiscard[questionId].status).toBe("resolved");
  });

  test("the WorkingMemory service is the single mutation surface", () => {
    const wm = new ScopedWorkingMemory({}, writeContext({ now: () => T0 }));
    const finding = wm.add({ kind: "finding", content: "The repository uses pnpm workspaces." });
    expect(finding.id).toBe("wm-node-1-1");
    expect(wm.get(finding.id)).toEqual(finding);
    expect(wm.update(finding.id, { importance: 0.9 }).importance).toBe(0.9);

    const question = wm.add({ kind: "question", content: "Does approval state survive restart?" });
    expect(wm.resolve(question.id).status).toBe("resolved");

    expect(wm.list({ kind: "question", status: "resolved" }).map(entry => entry.id)).toEqual([question.id]);
    expect(wm.list({ status: "active" }).map(entry => entry.id)).toEqual([finding.id]);
    expect(wm.list({ scope: "workflow" })).toEqual([]);
    expect(() => wm.add({ kind: "unsupported" as WorkingMemoryKind, content: "nope" })).toThrow(WorkingMemoryValidationError);
    expect(() => wm.update("missing-id", { content: "valid content here" })).toThrow(WorkingMemoryValidationError);
    expect(wm.entriesSnapshot()[finding.id].importance).toBe(0.9);
  });
});
// Untrusted Update Validation

describe("untrusted working memory updates", () => {
  const rejectedFor = (updates: unknown, context: WorkingMemoryWriteContext = writeContext()) =>
    applyWorkingMemoryUpdates({}, updates, context).rejected.map(rejection => rejection.reason);

  const invalidCases: [string, unknown, string][] = [
    ["unsupported kind", [{ kind: "feelings", content: "Something happened during the run." }], "unsupported_kind"],
    ["unsupported version", [{ version: 2, kind: "finding", content: "Something happened during the run." }], "unsupported_version"],
    ["oversized content", [{ kind: "finding", content: "x".repeat(WORKING_MEMORY_LIMITS.maxContentLength + 1) }], "content_too_large"],
    ["invalid scope", [{ kind: "finding", content: "Something happened during the run.", scope: "organization" }], "invalid_scope"],
    ["invalid status", [{ kind: "finding", content: "Something happened during the run.", status: "pending" }], "invalid_status"],
    ["invalid importance", [{ kind: "finding", content: "Something happened during the run.", importance: 5 }], "invalid_importance"],
    ["oversized metadata", [{ kind: "finding", content: "Something happened during the run.", metadata: { blob: "y".repeat(WORKING_MEMORY_LIMITS.maxMetadataBytes + 1) } }], "metadata_too_large"],
    ["malformed id", [{ kind: "finding", content: "Something happened during the run.", id: "bad id!" }], "invalid_id"],
    ["oversized id", [{ kind: "finding", content: "Something happened during the run.", id: "z".repeat(WORKING_MEMORY_LIMITS.maxIdLength + 1) }], "invalid_id"],
    ["trivial content", [{ kind: "note", content: "hello" }], "trivial_content"],
    ["missing content", [{ kind: "finding" }], "missing_content"],
    ["malformed update", [42], "malformed_update"],
    ["unsupported op", [{ op: "delete", kind: "finding", content: "Something happened during the run." }], "unsupported_op"],
    ["unknown update target", [{ op: "update", id: "missing-id", content: "Something happened during the run." }], "unknown_entry"],
    ["unknown supersede target", [{ kind: "finding", content: "Something happened during the run.", supersedes: "missing-id" }], "unknown_supersede_target"],
    ["writing as another agent", [{ kind: "finding", content: "Something happened during the run.", agentId: "agent-b" }], "agent_scope_mismatch"],
    ["secret assignment", [{ kind: "finding", content: "The api_key is sk-abcdefghijklmnopqrst" }], "sensitive_content"],
    ["bearer token", [{ kind: "finding", content: "Send Authorization: Bearer abcdef1234567890 to the service." }], "sensitive_content"],
  ];

  test.each(invalidCases)("rejects %s", (label, updates, reason) => {
    expect([label, rejectedFor(updates)]).toEqual([label, [reason]]);
  });

  test("a non-array payload is rejected without throwing", () => {
    const result = applyWorkingMemoryUpdates({}, "not-an-array", writeContext());
    expect(result.rejected).toEqual([{ index: -1, reason: "invalid_updates_payload" }]);
    expect(result.entries).toEqual({});
  });

  test("duplicate explicit ids are rejected rather than overwriting state", () => {
    const result = applyWorkingMemoryUpdates({}, [
      { kind: "finding", content: "First claim about the runtime.", id: "custom-1" },
      { kind: "finding", content: "Second claim about the runtime.", id: "custom-1" },
    ], writeContext());
    expect(result.added).toEqual(["custom-1"]);
    expect(result.rejected).toEqual([{ index: 1, reason: "duplicate_id" }]);
    expect(result.entries["custom-1"].content).toBe("First claim about the runtime.");
  });

  test("an agent cannot update or supersede another agent's private entry", () => {
    const privateA = applyTo({}, [{ kind: "finding", content: "Agent A private uncertainty about the API." }], writeContext({ agentId: "agent-a" }));
    const privateId = Object.keys(privateA)[0];

    const asB = applyWorkingMemoryUpdates(privateA, [
      { op: "update", id: privateId, content: "Agent B rewriting A private entry." },
      { kind: "finding", content: "Agent B replacing A private entry.", supersedes: privateId },
    ], writeContext({ agentId: "agent-b", nodeId: "node-b" }));
    expect(asB.rejected.map(rejection => rejection.reason)).toEqual(["unknown_entry", "unknown_supersede_target"]);
    expect(asB.entries[privateId]).toBeUndefined();
  });

  test("a non-owner cannot rewrite a shared entry it can see", () => {
    const shared = applyTo({}, [{ kind: "finding", content: "Shared finding about the API.", scope: "workflow" }], writeContext({ agentId: "agent-a" }));
    const sharedId = Object.keys(shared)[0];
    const asB = applyWorkingMemoryUpdates(shared, [{ op: "update", id: sharedId, content: "Agent B rewriting the shared finding." }], writeContext({ agentId: "agent-b", nodeId: "node-b" }));
    expect(asB.rejected).toEqual([{ index: 0, reason: "not_owner" }]);
    expect(asB.entries[sharedId]).toBeUndefined();
  });

  test("scope escalation is denied by server policy, not by model output", () => {
    const escalation = [{ kind: "finding", content: "Shared fact the agent is not allowed to publish.", scope: "workflow" }];
    const denied = applyWorkingMemoryUpdates({}, escalation, writeContext({ scopePolicy: AGENT_PRIVATE_WORKING_MEMORY }));
    expect(denied.rejected).toEqual([{ index: 0, reason: "scope_not_permitted" }]);
    expect(denied.entries).toEqual({});

    const permitted = applyWorkingMemoryUpdates({}, escalation, writeContext());
    expect(permitted.entries[permitted.added[0]].scope).toBe("workflow");

    const privateFallback = applyWorkingMemoryUpdates({}, [{ kind: "finding", content: "Private scratch fact about the run." }], writeContext({ scopePolicy: AGENT_PRIVATE_WORKING_MEMORY }));
    expect(privateFallback.added).toHaveLength(1);
  });

  test("invocation and run limits reject deterministically instead of corrupting state", () => {
    const overLimit = Array.from({ length: WORKING_MEMORY_LIMITS.maxEntriesPerInvocation + 2 }, (_, index) => ({
      kind: "note",
      content: `Overflow note number ${index} produced by a single invocation.`,
    }));
    const result = applyWorkingMemoryUpdates({}, overLimit, writeContext());
    expect(result.diagnostics.truncated).toBe(true);
    expect(result.added).toHaveLength(WORKING_MEMORY_LIMITS.maxEntriesPerInvocation);
    expect(result.rejected).toEqual([
      { index: WORKING_MEMORY_LIMITS.maxEntriesPerInvocation, reason: "invocation_limit" },
      { index: WORKING_MEMORY_LIMITS.maxEntriesPerInvocation + 1, reason: "invocation_limit" },
    ]);

    const full: WorkingMemoryEntries = {};
    for (let index = 0; index < WORKING_MEMORY_LIMITS.maxEntriesPerRun; index += 1) full[`filler-${index}`] = makeEntry({ id: `filler-${index}` });
    const atLimit = applyWorkingMemoryUpdates(full, [{ kind: "finding", content: "One finding too many for this run." }], writeContext());
    expect(atLimit.rejected).toEqual([{ index: 0, reason: "run_limit" }]);
    expect(atLimit.entries).toEqual({});
  });

  test("rejection diagnostics never echo rejected content", () => {
    const secret = "password is hunter2-and-more";
    const result = applyWorkingMemoryUpdates({}, [{ kind: "finding", content: secret }], writeContext());
    expect(result.rejected).toEqual([{ index: 0, reason: "sensitive_content" }]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });
});
// Scope / Run Isolation

describe("scope and run isolation", () => {
  test("agent-private entries are visible only to their owner", () => {
    const entries = applyTo({}, [{ kind: "finding", content: "AGENT_A_PRIVATE: response format is still uncertain." }], writeContext({ agentId: "agent-a" }));
    const id = Object.keys(entries)[0];
    expect(isWorkingMemoryVisible(entries[id], { agentId: "agent-a" })).toBe(true);
    expect(isWorkingMemoryVisible(entries[id], { agentId: "agent-b" })).toBe(false);
    expect(visibleWorkingMemoryEntries(entries, { agentId: "agent-b" })).toEqual([]);
  });

  test("agent A sees its private entries plus workflow-shared entries, never B private ones", () => {
    // Accumulate exactly like checkpointed graph state: each node writes on top of
    // the previous state, so ids never collide across independent writes.
    let entries: WorkingMemoryEntries = {};
    entries = applyTo(entries, [{ kind: "finding", content: "AGENT_A_PRIVATE: response format is still uncertain." }], writeContext({ agentId: "agent-a", nodeId: "node-a" }));
    entries = applyTo(entries, [{ kind: "finding", scope: "workflow", content: "WORKFLOW_SHARED: the repository uses pnpm." }], writeContext({ agentId: "agent-a", nodeId: "node-a" }));
    entries = applyTo(entries, [{ kind: "finding", content: "AGENT_B_PRIVATE: batching semantics are unclear." }], writeContext({ agentId: "agent-b", nodeId: "node-b" }));
    expect(Object.keys(entries)).toHaveLength(3);

    const forA = visibleWorkingMemoryEntries(entries, { agentId: "agent-a" }).map(entry => entry.content);
    const forB = visibleWorkingMemoryEntries(entries, { agentId: "agent-b" }).map(entry => entry.content);
    expect(forA.sort()).toEqual(["AGENT_A_PRIVATE: response format is still uncertain.", "WORKFLOW_SHARED: the repository uses pnpm."]);
    expect(forB.sort()).toEqual(["AGENT_B_PRIVATE: batching semantics are unclear.", "WORKFLOW_SHARED: the repository uses pnpm."]);

    const selectionA = selectWorkingMemoryForContext(entries, { agentId: "agent-a", runId: "run-1", budgetTokens: 10_000, estimate }).selected.map(entry => entry.content);
    expect(selectionA).not.toContain("AGENT_B_PRIVATE: batching semantics are unclear.");
  });

  test("run isolation: run A entries never reach run B even with identical ids", () => {
    const shared = mergeWorkingMemory(
      applyTo({}, [{ kind: "finding", content: "UNIQUE_RUN_A marker.", scope: "workflow" }], writeContext({ runId: "run-a" })),
      applyTo({}, [{ kind: "finding", content: "UNIQUE_RUN_B marker.", scope: "workflow" }], writeContext({ runId: "run-b", nodeId: "node-b" })),
    );
    const forB = visibleWorkingMemoryEntries(shared, { agentId: "agent-a", runId: "run-b" });
    expect(forB.map(entry => entry.content)).toEqual(["UNIQUE_RUN_B marker."]);
    expect(workingMemoryDiagnostics(shared, { agentId: "agent-a", runId: "run-b" })).toMatchObject({ visibleCount: 1, activeCount: 1, workflowScopedCount: 1 });
    expect(selectWorkingMemoryForContext(shared, { agentId: "agent-a", runId: "run-b", budgetTokens: 10_000, estimate }).selected.map(entry => entry.content))
      .not.toContain("UNIQUE_RUN_A marker.");
  });

  test("resolved and discarded entries stay checkpointed but leave active selection", () => {
    const entries = applyTo({}, [
      { kind: "question", content: "Does approval state survive restart?", status: "resolved" },
      { kind: "note", content: "Superseded scratch note kept for audit.", status: "discarded" },
      { kind: "constraint", content: "Do not modify public API behavior." },
    ]);
    expect(Object.keys(entries)).toHaveLength(3);
    expect(visibleWorkingMemoryEntries(entries, { agentId: "agent-a", statuses: ["active"] }).map(entry => entry.kind)).toEqual(["constraint"]);
    expect(workingMemoryDiagnostics(entries, { agentId: "agent-a" })).toMatchObject({ activeCount: 1, resolvedCount: 1, discardedCount: 1, visibleCount: 3 });
  });
});

// Determinism / Budgets

describe("determinism and budgets", () => {
  test("identical runtime state and updates produce identical entries and ordering", () => {
    const updates = [
      { kind: "constraint", content: "Do not modify public API behavior." },
      { kind: "decision", content: "Extend the existing principal middleware rather than add JWT." },
      { kind: "todo", content: "Add tenant isolation regression test." },
    ];
    const a = applyWorkingMemoryUpdates({}, updates, writeContext({ now: () => T0 }));
    const b = applyWorkingMemoryUpdates({}, updates, writeContext({ now: () => T0 }));
    expect(a.entries).toEqual(b.entries);
    expect(Object.keys(a.entries)).toEqual(Object.keys(b.entries));
    expect(serializeWorkingMemoryForContext(visibleWorkingMemoryEntries(a.entries, { agentId: "agent-a" })))
      .toBe(serializeWorkingMemoryForContext(visibleWorkingMemoryEntries(b.entries, { agentId: "agent-a" })));
  });

  test("ordering is kind priority, then importance, then recency, then stable id", () => {
    const list = [
      makeEntry({ id: "n1", kind: "note", createdAt: T2 }),
      makeEntry({ id: "f1", kind: "finding", createdAt: T0 }),
      makeEntry({ id: "f2", kind: "finding", createdAt: T1, importance: 0.2 }),
      makeEntry({ id: "f3", kind: "finding", createdAt: T1, importance: 0.8 }),
      makeEntry({ id: "q1", kind: "question", createdAt: T0 }),
      makeEntry({ id: "c1", kind: "constraint", createdAt: T0 }),
      makeEntry({ id: "a1", kind: "assumption", createdAt: T0 }),
      makeEntry({ id: "d1", kind: "decision", createdAt: T0 }),
      makeEntry({ id: "t1", kind: "todo", createdAt: T0 }),
    ].sort(compareWorkingMemoryEntries);
    expect(list.map(entry => entry.id)).toEqual(["c1", "d1", "f3", "f2", "f1", "q1", "a1", "t1", "n1"]);
  });

  test("mergeWorkingMemory keeps every parallel entry and never overwrites a stale view", () => {
    const a = applyWorkingMemoryUpdates({}, [{ kind: "finding", content: "Parallel branch A finding." }], writeContext({ nodeId: "node-a" })).entries;
    const b = applyWorkingMemoryUpdates({}, [{ kind: "finding", content: "Parallel branch B finding." }], writeContext({ nodeId: "node-b" })).entries;
    const merged = mergeWorkingMemory(a, b);
    expect(Object.keys(merged).sort()).toEqual(["wm-node-a-1", "wm-node-b-1"]);
    expect(merged["wm-node-a-1"].content).toBe("Parallel branch A finding.");
    expect(merged["wm-node-b-1"].content).toBe("Parallel branch B finding.");
  });

  test("context selection honours the budget deterministically by kind priority", () => {
    const entries = applyTo({}, [
      { kind: "note", content: "NOTE_FILLER ".repeat(30) },
      { kind: "constraint", content: "CONSTRAINT: do not modify public API behavior." },
      { kind: "decision", content: "DECISION: extend the principal middleware." },
      { kind: "finding", content: "FINDING: authentication uses signed principals." },
    ]);
    const all = visibleWorkingMemoryEntries(entries, { agentId: "agent-a" });
    const constraint = all.find(entry => entry.kind === "constraint")!;
    const decision = all.find(entry => entry.kind === "decision")!;
    const budget = WORKING_MEMORY_CONTEXT_HEADER.length
      + WORKING_MEMORY_CONTEXT_FOOTER.length
      + serializeWorkingMemoryEntryForContext(constraint).length
      + serializeWorkingMemoryEntryForContext(decision).length;

    const request = { agentId: "agent-a", runId: "run-1", budgetTokens: budget, estimate };
    const selection = selectWorkingMemoryForContext(entries, request);
    expect(selection.selected.map(entry => entry.id)).toEqual([constraint.id, decision.id]);
    expect(selection.dropped.map(entry => entry.kind).sort()).toEqual(["finding", "note"]);
    expect(selection.tokens).toBeLessThanOrEqual(budget);
    expect(selectWorkingMemoryForContext(entries, request).selected.map(entry => entry.id)).toEqual(selection.selected.map(entry => entry.id));
    expect(selectWorkingMemoryForContext(entries, { ...request, budgetTokens: 0 }).selected).toEqual([]);
  });

  test("the default working memory context budget stays small and bounded", () => {
    expect(DEFAULT_WORKING_MEMORY_CONTEXT_BUDGET_TOKENS).toBeLessThanOrEqual(4000);
  });
});
// Untrusted Extraction

describe("structured agent result extraction", () => {
  test("strips the workingMemoryUpdates channel from an object result exactly once", () => {
    const { remainder, updates } = splitWorkingMemoryUpdates({
      output: "Implementation complete.",
      workingMemoryUpdates: [{ kind: "decision", content: "Extend the principal middleware." }],
    });
    expect(remainder).toBe("Implementation complete.");
    expect(updates).toHaveLength(1);
  });

  test("strips the channel from a JSON object string result", () => {
    const raw = JSON.stringify({ output: "Done", workingMemoryUpdates: [{ kind: "todo", content: "Add isolation test." }] });
    const { remainder, updates } = splitWorkingMemoryUpdates(raw);
    expect(remainder).toBe("Done");
    expect(updates).toHaveLength(1);
    expect(extractWorkingMemoryUpdates(raw)).toHaveLength(1);
  });

  test("strips malformed channels too, so they can be rejected without leaking into output", () => {
    const { remainder, updates } = splitWorkingMemoryUpdates({
      output: "The normal agent answer.",
      workingMemoryUpdates: "not-an-array",
    });
    expect(remainder).toBe("The normal agent answer.");
    expect(updates).toEqual(["not-an-array"]);
    expect(JSON.stringify(remainder)).not.toContain("workingMemoryUpdates");
  });

  test("keeps other result keys and leaves non-structured output untouched", () => {
    const { remainder } = splitWorkingMemoryUpdates({ summary: "Wrapped up.", workingMemoryUpdates: [] });
    expect(remainder).toEqual({ summary: "Wrapped up." });
    expect(splitWorkingMemoryUpdates("plain text output")).toEqual({ remainder: "plain text output", updates: [] });
    expect(splitWorkingMemoryUpdates(undefined)).toEqual({ remainder: undefined, updates: [] });
    expect(extractWorkingMemoryUpdates({ unrelated: true })).toEqual([]);
  });
});

// Handoff / Long-Term Separation

describe("separation from handoff and long-term memory", () => {
  test("a handoff references working memory without copying its content", () => {
    const entries = applyTo({}, [{ kind: "finding", content: "CONFIDENTIAL_FINDING_BODY uses signed principals." }]);
    const id = Object.keys(entries)[0];
    const handoff = buildHandoff({
      runId: "run-1",
      workflowId: "wf-1",
      sourceNodeId: "node-1",
      sourceAgentId: "agent-a",
      succeeded: true,
      rawOutput: { summary: "Auth verified.", findings: [{ content: "Auth verified with signed principals.", evidenceRefs: [workingMemoryReference(id)] }] },
    });

    expect(workingMemoryReference(id)).toBe(`working-memory:${id}`);
    expect(handoff.findings[0].evidenceRefs).toEqual([`working-memory:${id}`]);
    expect(handoff.findings[0].content).toBe("Auth verified with signed principals.");
    expect(serializeHandoffForContext(handoff)).not.toContain("CONFIDENTIAL_FINDING_BODY");
  });

  test("working memory never enters long-term memory automatically", async () => {
    const namespace: MemoryNamespace = { scope: "agent", id: "agent-a" };
    const access: MemoryAccessContext = {
      principalId: "owner",
      tenantId: "tenant",
      agentId: "agent-a",
      workflowId: "wf-1",
      readableNamespaces: [namespace],
      writableNamespaces: [namespace],
    };
    const store = new InMemoryMemoryStore();
    const service = new DefaultMemoryService(store);

    const entries = applyTo({}, [{ kind: "finding", content: "TEMPORARY_WORKING_MEMORY_MARKER during this run." }], writeContext());
    expect(Object.keys(entries)).toHaveLength(1);

    expect(await service.list({ namespaces: [namespace] }, access)).toEqual([]);
    const recalled = await service.recall({ text: "TEMPORARY_WORKING_MEMORY_MARKER", namespaces: [namespace] }, access);
    expect(recalled.results).toEqual([]);
    const scanned = await store.search({ tenantId: "tenant", namespaces: [namespace], limit: 50 });
    expect(JSON.stringify(scanned)).not.toContain("TEMPORARY_WORKING_MEMORY_MARKER");
  });
});
// ContextAssembler Integration

describe("ContextAssembler working memory source", () => {
  const entries = () => {
    let state: WorkingMemoryEntries = {};
    state = applyTo(state, [{ kind: "finding", content: "AGENT_A_PRIVATE: response format is still uncertain." }], writeContext({ agentId: "agent-a", nodeId: "node-a" }));
    state = applyTo(state, [
      { kind: "constraint", content: "CONSTRAINT: do not modify public API behavior.", scope: "workflow" },
      { kind: "finding", content: "AGENT_B_PRIVATE: batching semantics are unclear." },
    ], writeContext({ agentId: "agent-b", nodeId: "node-b" }));
    return state;
  };

  test("working memory is a dedicated, untrusted context source below handoff", async () => {
    const handoff = buildHandoff({ runId: "run-1", workflowId: "wf-1", sourceNodeId: "node-1", sourceAgentId: "agent-b", rawOutput: "Previous node done.", succeeded: true });
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "SYSTEM",
      task: "TASK",
      handoffs: { "node-1": handoff },
      workingMemory: entries(),
      longTermMemoryContext: "Untrusted memory data: the project uses pnpm.",
      history: [{ id: "1", input: "hi", output: "hello" }],
    }));

    const order = ctx.items.map(item => item.source);
    expect(order.indexOf("system")).toBeLessThan(order.indexOf("task"));
    expect(order.indexOf("task")).toBeLessThan(order.indexOf("handoff"));
    expect(order.indexOf("handoff")).toBeLessThan(order.indexOf("working_memory"));
    expect(order.indexOf("working_memory")).toBeLessThan(order.indexOf("long_term_memory"));
    expect(order.indexOf("long_term_memory")).toBeLessThan(order.indexOf("history"));
    expect(PRIORITY.WORKING_MEMORY).toBeLessThan(PRIORITY.HANDOFF);
    expect(PRIORITY.WORKING_MEMORY).toBeGreaterThan(PRIORITY.LONG_TERM_MEMORY);

    const workingMemoryItem = ctx.items.find(item => item.source === "working_memory")!;
    expect(workingMemoryItem.required).toBeUndefined();
    expect(workingMemoryItem.priority).toBe(PRIORITY.WORKING_MEMORY);
    const text = (workingMemoryItem.content as { type: string; text: string }).text;
    expect((workingMemoryItem.content as { type: string }).type).toBe("working_memory");
    expect(text.startsWith(WORKING_MEMORY_CONTEXT_HEADER)).toBe(true);
    expect(text.endsWith(WORKING_MEMORY_CONTEXT_FOOTER)).toBe(true);
    expect(ctx.diagnostics.sources.working_memory.count).toBe(1);
    expect(ctx.diagnostics.workingMemory).toMatchObject({ activeCount: 2, agentScopedCount: 1, workflowScopedCount: 1, includedInContext: 2, droppedByBudget: 0 });
  });

  test("the assembler never serializes another agent private entries", async () => {
    const cases: [string, string, string][] = [
      ["agent-a", "AGENT_A_PRIVATE: response format is still uncertain.", "AGENT_B_PRIVATE: batching semantics are unclear."],
      ["agent-b", "AGENT_B_PRIVATE: batching semantics are unclear.", "AGENT_A_PRIVATE: response format is still uncertain."],
    ];
    for (const [agentId, visible, hidden] of cases) {
      const ctx = await assembler.assemble(makeRequest({ agentId, agent: makeAgent(agentId), workingMemory: entries() }));
      const text = (ctx.items.find(item => item.source === "working_memory")!.content as { text: string }).text;
      expect(text).toContain(visible);
      expect(text).toContain("CONSTRAINT: do not modify public API behavior.");
      expect(text).not.toContain(hidden);
    }
  });

  test("run isolation holds through the assembler", async () => {
    const crossRun = mergeWorkingMemory(
      applyTo({}, [{ kind: "finding", content: "UNIQUE_RUN_A marker.", scope: "workflow" }], writeContext({ runId: "run-a" })),
      applyTo({}, [{ kind: "finding", content: "UNIQUE_RUN_B marker.", scope: "workflow" }], writeContext({ runId: "run-b", nodeId: "node-b" })),
    );
    const ctx = await assembler.assemble(makeRequest({ runId: "run-b", workingMemory: crossRun }));
    const text = (ctx.items.find(item => item.source === "working_memory")!.content as { text: string }).text;
    expect(text).toContain("UNIQUE_RUN_B marker.");
    expect(text).not.toContain("UNIQUE_RUN_A marker.");
  });

  test("no working memory item is produced when nothing is visible or active", async () => {
    const empty = await assembler.assemble(makeRequest({ workingMemory: {} }));
    expect(empty.items.some(item => item.source === "working_memory")).toBe(false);
    expect(empty.diagnostics.workingMemory).toMatchObject({ activeCount: 0, visibleCount: 0 });

    const privateOnly = applyTo({}, [{ kind: "finding", content: "AGENT_A_PRIVATE: hidden from B." }], writeContext({ agentId: "agent-a" }));
    const forB = await assembler.assemble(makeRequest({ agentId: "agent-b", agent: makeAgent("agent-b"), workingMemory: privateOnly }));
    expect(forB.items.some(item => item.source === "working_memory")).toBe(false);
  });

  test("required system/task content survives a tight budget that drops working memory", async () => {
    const large = applyTo({}, [
      { kind: "constraint", content: "DROPPABLE_CONSTRAINT ".repeat(80), scope: "workflow" },
      { kind: "decision", content: "DROPPABLE_DECISION ".repeat(80), scope: "workflow" },
      { kind: "finding", content: "DROPPABLE_FINDING ".repeat(80), scope: "workflow" },
      { kind: "question", content: "DROPPABLE_QUESTION ".repeat(80), scope: "workflow" },
      { kind: "assumption", content: "DROPPABLE_ASSUMPTION ".repeat(80), scope: "workflow" },
      { kind: "todo", content: "DROPPABLE_TODO ".repeat(80), scope: "workflow" },
      { kind: "note", content: "DROPPABLE_NOTE ".repeat(80), scope: "workflow" },
    ]);
    // Every entry is within the per-entry limits; the block is what is oversized.
    expect(Object.keys(large)).toHaveLength(7);
    const ctx = await assembler.assemble(makeRequest({
      systemPrompt: "SYSTEM",
      task: "TASK",
      workingMemory: large,
      workingMemoryBudgetTokens: 10_000,
      model: { contextWindowTokens: 8_200 },
    }));
    expect(ctx.items.map(item => item.source)).toEqual(expect.arrayContaining(["system", "task"]));
    expect(ctx.items.some(item => item.source === "working_memory")).toBe(false);
    expect(ctx.droppedItems.some(item => item.source === "working_memory")).toBe(true);
    // The whole working memory block was built, then dropped by the outer window:
    // the sub-budget is not what removed it.
    expect(ctx.diagnostics.workingMemory.droppedByBudget).toBe(0);
    expect(ctx.budget.usedTokens).toBeGreaterThan(0);
  });

  test("the working memory sub-budget bounds the injected block independently", async () => {
    const large = applyTo({}, [
      { kind: "note", content: "SUB_BUDGET_NOTE ".repeat(80), scope: "workflow" },
      { kind: "constraint", content: "CONSTRAINT: never widen the public API.", scope: "workflow" },
    ]);
    const ctx = await assembler.assemble(makeRequest({ workingMemory: large, workingMemoryBudgetTokens: 120 }));
    const item = ctx.items.find(candidate => candidate.source === "working_memory")!;
    // The sub-budget, not the outer window, is what bounds this block.
    expect(item.estimatedTokens).toBeLessThanOrEqual(120);
    const text = (item.content as { text: string }).text;
    expect(text).toContain("CONSTRAINT: never widen the public API.");
    expect(text).not.toContain("SUB_BUDGET_NOTE");
    // The oversized note is dropped and the high-priority constraint kept.
    expect(ctx.diagnostics.workingMemory).toMatchObject({ droppedByBudget: 1, includedInContext: 1 });
  });
});

// Diagnostics

describe("working memory diagnostics", () => {
  test("report counts only, never entry contents", () => {
    const entries = applyTo({}, [
      { kind: "finding", content: "DIAGNOSTIC_SECRET_BODY value one.", scope: "workflow" },
      { kind: "question", content: "DIAGNOSTIC_SECRET_BODY value two?" },
      { kind: "assumption", content: "DIAGNOSTIC_SECRET_BODY value three." },
      { kind: "constraint", content: "DIAGNOSTIC_SECRET_BODY value four." },
    ]);
    const selection = selectWorkingMemoryForContext(entries, { agentId: "agent-a", runId: "run-1", budgetTokens: 40, estimate });
    const diagnostics = workingMemoryDiagnostics(entries, { agentId: "agent-a", runId: "run-1" }, selection);
    expect(diagnostics).toMatchObject({ activeCount: 4, agentScopedCount: 3, workflowScopedCount: 1, visibleCount: 4 });
    expect(diagnostics.byKind.finding).toBe(1);
    expect(diagnostics.byKind.question).toBe(1);
    expect(diagnostics.includedInContext + diagnostics.droppedByBudget).toBe(4);
    expect(JSON.stringify(diagnostics)).not.toContain("DIAGNOSTIC_SECRET_BODY");
  });
});
