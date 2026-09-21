/**
 * Phase 3 - Structured Run-Scoped Working Memory: runtime integration.
 *
 * Proves the working memory lifecycle inside the real LangGraph runtime and the
 * real RunExecutor, not just in the domain model:
 * - agent output -> validation -> RuntimeState -> checkpoint -> next agent
 * - checkpoint restore into a brand new runtime instance (no in-process maps)
 * - approval pause / resume keeps working memory intact
 * - parallel branches merge instead of overwriting
 * - fan-in exposes workflow entries but never another agent private entries
 * - failed and malformed executions never corrupt checkpointed state
 * - working memory stays separate from workflow state, history, handoff,
 *   run events and long-term memory
 * - run/tenant isolation of the run-scoped checkpoint surface
 *
 * Every executor here is a deterministic fake. No external model API is used.
 */
import { MemorySaver } from "@langchain/langgraph";
import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  type AgentRecord,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@multi-agent/types";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import type { AgentExecutorFactory } from "../src/agents/runtime/agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "../src/agents/runtime/types";
import { AGENT_PRIVATE_WORKING_MEMORY, type WorkingMemoryEntries } from "../src/agents/runtime/workingMemory";
import { compileWorkflow, type AgentExecutionEvent as WorkflowEvent } from "../apps/server/src/compiler/workflowCompiler";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { createInternalPrincipalAssertion, verifyInternalPrincipalAssertion, type AuthenticatedPrincipal } from "../src/auth/internalPrincipal";
import type { MemoryAccessContext } from "../src/memory/contracts";

const access: MemoryAccessContext = { principalId: "owner", tenantId: "tenant", readableNamespaces: [], writableNamespaces: [] };

const agent = (id: string): AgentRecord => ({ ...createAgentRecord(), id, name: id });

/** What one node does: raw output, untrusted working memory candidates, or failure. */
interface NodeBehaviour {
  output?: unknown;
  wm?: unknown[];
  fail?: string;
}

function entriesOf(entries: WorkingMemoryEntries | undefined): unknown[] {
  return Object.values(entries ?? {}).map((entry) => entry.content);
}

function workingMemoryText(input: AgentExecutionInput): string | undefined {
  const item = input.assembledContext?.items.find((candidate) => candidate.source === "working_memory");
  return item ? (item.content as { text?: string }).text : undefined;
}

function contentTexts(input: AgentExecutionInput): unknown[] {
  return entriesOf(input.workingMemory).sort() as unknown[];
}

/**
 * Stand-in for AgentRuntime. It delivers candidates through the same
 * `onWorkingMemoryUpdate` channel the real runtime uses, and it deliberately
 * delivers them even when the node then fails so failure semantics are tested.
 */
function fakeRuntime(behaviour: Record<string, NodeBehaviour>, seen: AgentExecutionInput[] = []): Pick<AgentRuntime, "execute"> {
  return {
    async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
      const base = { timestamp: new Date().toISOString(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId };
      const node = behaviour[input.nodeId] ?? {};
      if (node.wm?.length) input.onWorkingMemoryUpdate?.(node.wm);
      seen.push(input);
      if (node.fail) {
        yield { ...base, type: "agent.failed", payload: { error: node.fail } };
        return;
      }
      yield { ...base, type: "agent.completed", payload: { content: node.output ?? `output:${input.nodeId}` } };
    },
  };
}

/**
 * Real AgentRuntime over a fake executor: the executor returns the raw
 * structured result (working memory channel included) exactly like a model or
 * CLI would, so the runtime's own stripping and ContextAssembler path run.
 */
function realRuntime(behaviour: Record<string, NodeBehaviour>, seen: AgentExecutionInput[] = []): AgentRuntime {
  const factory: Pick<AgentExecutorFactory, "create"> = {
    create: () => ({
      async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
        seen.push(input);
        const node = behaviour[input.nodeId] ?? {};
        const raw = node.wm?.length
          ? { output: node.output ?? `output:${input.nodeId}`, workingMemoryUpdates: node.wm }
          : (node.output ?? `output:${input.nodeId}`);
        yield { type: "agent.completed", timestamp: new Date().toISOString(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: raw } };
      },
    }),
  };
  return new AgentRuntime(factory);
}
// Workflow builders

interface Built {
  workflow: WorkflowDefinition;
  agentNodes: WorkflowNode[];
  input: WorkflowNode;
  output: WorkflowNode;
  approval?: WorkflowNode;
  reviewer?: WorkflowNode;
  memory?: WorkflowNode;
}

/** input -> agent[0] -> ... -> agent[n] -> output, optionally gated by an approval node. */
function linearWorkflow(agentIds: string[], approvalAfter?: number): Built {
  const input = createNode("input", { x: 0, y: 0 });
  const agentNodes = agentIds.map((agentId, index) => createNode("agent", { x: index + 1, y: 0 }, { agentId }));
  const output = createNode("output", { x: agentIds.length + 2, y: 0 });
  const approval = approvalAfter === undefined ? undefined : createNode("approval", { x: approvalAfter + 1, y: -1 });
  if (approval) approval.config = { message: "Approve to continue?", approvalType: "manual", timeoutSeconds: 300 };
  const chain: WorkflowNode[] = [];
  agentNodes.forEach((node, index) => {
    chain.push(node);
    if (approval && approvalAfter === index) chain.push(approval);
  });
  const edges = [createEdge({ source: input.id, target: chain[0].id })];
  for (let index = 0; index < chain.length; index += 1) {
    edges.push(createEdge({ source: chain[index].id, target: (chain[index + 1] ?? output).id }));
  }
  return { workflow: { ...createEmptyDefinition(), nodes: [input, ...agentNodes, ...(approval ? [approval] : []), output], edges }, agentNodes, input, output, approval };
}

/** input -> every agent -> output, so all agents run in the same superstep. */
function parallelWorkflow(agentIds: string[]): Built {
  const input = createNode("input", { x: 0, y: 0 });
  const agentNodes = agentIds.map((agentId, index) => createNode("agent", { x: 1, y: index }, { agentId }));
  const output = createNode("output", { x: 2, y: 0 });
  const edges = [
    ...agentNodes.map((node) => createEdge({ source: input.id, target: node.id })),
    ...agentNodes.map((node) => createEdge({ source: node.id, target: output.id })),
  ];
  return { workflow: { ...createEmptyDefinition(), nodes: [input, ...agentNodes, output], edges }, agentNodes, input, output };
}

/** input -> each predecessor -> reviewer -> output. */
function fanInWorkflow(predecessors: string[], reviewer: string): Built {
  const input = createNode("input", { x: 0, y: 0 });
  const agentNodes = predecessors.map((agentId, index) => createNode("agent", { x: 1, y: index }, { agentId }));
  const reviewerNode = createNode("agent", { x: 2, y: 0 }, { agentId: reviewer });
  const output = createNode("output", { x: 3, y: 0 });
  const edges = [
    ...agentNodes.map((node) => createEdge({ source: input.id, target: node.id })),
    ...agentNodes.map((node) => createEdge({ source: node.id, target: reviewerNode.id })),
    createEdge({ source: reviewerNode.id, target: output.id }),
  ];
  return { workflow: { ...createEmptyDefinition(), nodes: [input, ...agentNodes, reviewerNode, output], edges }, agentNodes, reviewer: reviewerNode, input, output };
}

/** input -> memory(write marker) -> agent[0] -> ... -> output: workflow state next to working memory. */
function stateAndAgentWorkflow(agentIds: string[]): Built {
  const input = createNode("input", { x: 0, y: 0 });
  const memoryNode = createNode("memory", { x: 1, y: 0 });
  memoryNode.config = { memoryType: "short_term", mode: "write", key: "marker" };
  const agentNodes = agentIds.map((agentId, index) => createNode("agent", { x: index + 2, y: 0 }, { agentId }));
  const output = createNode("output", { x: agentIds.length + 2, y: 0 });
  const chain = [input, memoryNode, ...agentNodes, output];
  const edges = chain.slice(0, -1).map((node, index) => createEdge({ source: node.id, target: chain[index + 1].id }));
  return { workflow: { ...createEmptyDefinition(), nodes: chain, edges }, agentNodes, input, output, memory: memoryNode };
}

// Checkpoint readback helpers

interface RunState {
  memory: Record<string, unknown>;
  workingMemory?: WorkingMemoryEntries;
  shortTermHistories?: Record<string, { entries: { id: string; input: unknown; output: unknown }[] }>;
  handoffs?: Record<string, { id: string; findings: { content: string; evidenceRefs?: string[] }[]; decisions: unknown[] }>;
  nodeResults?: Record<string, unknown>;
}

async function runStateOf(compiled: ReturnType<typeof compileWorkflow>, threadId: string): Promise<RunState> {
  const snapshot = await compiled.graph.getState({ configurable: { thread_id: threadId } });
  return snapshot.values as unknown as RunState;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
// Graph runtime

describe("working memory in the compiled graph", () => {
  test("a write is checkpointed, survives runtime destruction, and reaches the downstream agent", async () => {
    const built = linearWorkflow(["agent-a", "agent-b"]);
    const marker = "FINDING_A: authentication uses signed internal principals.";
    const behaviour = { [built.agentNodes[0].id]: { wm: [{ kind: "finding", scope: "workflow", content: marker }] } };
    const checkpointer = new MemorySaver();
    const firstSeen: AgentExecutionInput[] = [];
    const first = compileWorkflow(built.workflow, [agent("agent-a"), agent("agent-b")], { runId: "run-restart", runtime: realRuntime(behaviour, firstSeen), checkpointer });
    await first.graph.invoke({ input: { question: "start" } });

    const stored = Object.values((await runStateOf(first, "run-restart")).workingMemory ?? {});
    expect(stored).toHaveLength(1);
    const [entry] = stored;
    expect(entry).toMatchObject({
      version: 1,
      runId: "run-restart",
      workflowId: built.workflow.id,
      scope: "workflow",
      agentId: "agent-a",
      kind: "finding",
      status: "active",
      content: marker,
      source: { nodeId: built.agentNodes[0].id, agentId: "agent-a" },
    });
    expect(entry.createdAt).toBe(entry.updatedAt);
    expect(entry.id).toBe(`wm-${built.agentNodes[0].id}-1`);

    // Node to node within the same run.
    const sameRunDownstream = firstSeen.find((input) => input.nodeId === built.agentNodes[1].id)!;
    expect(entriesOf(sameRunDownstream.workingMemory)).toEqual([marker]);

    // The producing runtime is discarded; only the checkpoint survives. A brand
    // new graph, runtime and executor set at the downstream node must see it.
    const downstream = linearWorkflow(["agent-b"]);
    const secondSeen: AgentExecutionInput[] = [];
    const restored = compileWorkflow(downstream.workflow, [agent("agent-b")], { runId: "run-restart", runtime: realRuntime(behaviour, secondSeen), checkpointer });
    await restored.graph.invoke({ input: {} });

    const restoredState = await runStateOf(restored, "run-restart");
    expect(restoredState.workingMemory?.[entry.id]).toMatchObject({ content: marker, status: "active" });
    expect(Object.keys(restoredState.workingMemory ?? {})).toHaveLength(1);
    const restoredInput = secondSeen.find((input) => input.nodeId === downstream.agentNodes[0].id)!;
    expect(entriesOf(restoredInput.workingMemory)).toEqual([marker]);
    expect(workingMemoryText(restoredInput)).toContain(marker);

    // A different run shares nothing even with an identical workflow.
    const otherSeen: AgentExecutionInput[] = [];
    const other = compileWorkflow(built.workflow, [agent("agent-a"), agent("agent-b")], { runId: "run-restart-other", runtime: realRuntime(behaviour, otherSeen), checkpointer });
    await other.graph.invoke({ input: {} });
    const otherState = await runStateOf(other, "run-restart-other");
    expect(Object.values(otherState.workingMemory ?? {}).map((item) => item.content)).toEqual([marker]);
    expect(otherSeen[0].workingMemory).toEqual({});
  });

  test("parallel branches merge instead of overwriting each other", async () => {
    const built = parallelWorkflow(["agent-a", "agent-b"]);
    const behaviour = {
      [built.agentNodes[0].id]: { wm: [{ kind: "finding", scope: "workflow", content: "PARALLEL_A finding." }] },
      [built.agentNodes[1].id]: { wm: [{ kind: "finding", scope: "workflow", content: "PARALLEL_B finding." }] },
    };
    const compiled = compileWorkflow(built.workflow, [agent("agent-a"), agent("agent-b")], { runId: "run-parallel", runtime: fakeRuntime(behaviour), checkpointer: new MemorySaver() });
    await compiled.graph.invoke({ input: {} });

    const entries = Object.values((await runStateOf(compiled, "run-parallel")).workingMemory ?? {});
    expect(entries.map((entry) => entry.content).sort()).toEqual(["PARALLEL_A finding.", "PARALLEL_B finding."]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    expect(entries.map((entry) => entry.source.nodeId).sort()).toEqual([...built.agentNodes.map((node) => node.id)].sort());
  });

  test("fan-in gives the reviewer workflow entries and never predecessor-private entries", async () => {
    const predecessors = ["agent-a", "agent-b", "agent-c"];
    const built = fanInWorkflow(predecessors, "agent-reviewer");
    const behaviour: Record<string, NodeBehaviour> = {};
    built.agentNodes.forEach((node, index) => {
      const label = predecessors[index].toUpperCase();
      behaviour[node.id] = { wm: [
        { kind: "finding", scope: "workflow", content: `WORKFLOW_${label} shared finding.` },
        { kind: "finding", content: `PRIVATE_${label} agent-only uncertainty.` },
      ] };
    });
    const seen: AgentExecutionInput[] = [];
    const compiled = compileWorkflow(built.workflow, [...predecessors.map(agent), agent("agent-reviewer")], { runId: "run-fanin", runtime: realRuntime(behaviour, seen), checkpointer: new MemorySaver() });
    await compiled.graph.invoke({ input: {} });

    expect(Object.keys((await runStateOf(compiled, "run-fanin")).workingMemory ?? {})).toHaveLength(6);

    const reviewerNode = built.reviewer!;
    const reviewerInput = seen.find((input) => input.nodeId === reviewerNode.id)!;
    expect(entriesOf(reviewerInput.workingMemory).sort()).toEqual([
      "WORKFLOW_AGENT-A shared finding.",
      "WORKFLOW_AGENT-B shared finding.",
      "WORKFLOW_AGENT-C shared finding.",
    ]);
    const text = workingMemoryText(reviewerInput)!;
    for (const label of ["AGENT-A", "AGENT-B", "AGENT-C"]) {
      expect(text).toContain(`WORKFLOW_${label}`);
      expect(text).not.toContain(`PRIVATE_${label}`);
    }
    expect(reviewerInput.assembledContext!.diagnostics.workingMemory).toMatchObject({ activeCount: 3, workflowScopedCount: 3, agentScopedCount: 0, includedInContext: 3 });
  });

  test("a failed agent execution never persists model working memory", async () => {
    const built = linearWorkflow(["agent-a"]);
    const compiled = compileWorkflow(built.workflow, [agent("agent-a")], {
      runId: "run-failed",
      runtime: fakeRuntime({ [built.agentNodes[0].id]: { wm: [{ kind: "finding", content: "SHOULD_NOT_PERSIST" }], fail: "agent exploded" } }),
      checkpointer: new MemorySaver(),
    });
    await expect(compiled.graph.invoke({ input: {} })).rejects.toThrow(/agent exploded/);
    const values = await runStateOf(compiled, "run-failed");
    expect(values.workingMemory ?? {}).toEqual({});
    expect(JSON.stringify(values)).not.toContain("SHOULD_NOT_PERSIST");
  });
  test("malformed updates are rejected, reported, and never break a successful node", async () => {
    const built = linearWorkflow(["agent-a"]);
    const events: WorkflowEvent[] = [];
    const compiled = compileWorkflow(built.workflow, [agent("agent-a")], {
      runId: "run-malformed",
      runtime: fakeRuntime({ [built.agentNodes[0].id]: { output: "answer", wm: [
        "not-an-object",
        { kind: "made_up_kind", content: "unsupported kind" },
        { version: 99, kind: "note", content: "unsupported version" },
        { kind: "note", content: "ok note" },
      ] } }),
      checkpointer: new MemorySaver(),
      onAgentEvent: (event) => { events.push(event); },
    });
    await compiled.graph.invoke({ input: {} });
    const entries = Object.values((await runStateOf(compiled, "run-malformed")).workingMemory ?? {});
    expect(entries.map((entry) => entry.content)).toEqual(["ok note"]);

    const diagnostic = events.find((event) => (event.payload as { kind?: string } | undefined)?.kind === "working_memory.updated")!;
    expect(diagnostic.payload).toMatchObject({ received: 4, applied: 1, rejected: 3 });
    expect(diagnostic.payload).toMatchObject({ reasons: { malformed_update: 1, unsupported_kind: 1, unsupported_version: 1 } });
    // Only counts and reasons are logged; rejected content never reaches events.
    expect(JSON.stringify(events)).not.toContain("not-an-object");
    expect(JSON.stringify(events)).not.toContain("unsupported kind");
  });

  test("the runtime, not the model, decides whether workflow scope is allowed", async () => {
    const built = linearWorkflow(["agent-a"]);
    const events: WorkflowEvent[] = [];
    const compiled = compileWorkflow(built.workflow, [agent("agent-a")], {
      runId: "run-private-scope",
      runtime: fakeRuntime({ [built.agentNodes[0].id]: { wm: [
        { kind: "finding", scope: "workflow", content: "ESCALATION_ATTEMPT to widen scope." },
        { kind: "finding", content: "AGENT_PRIVATE finding stays private." },
      ] } }),
      checkpointer: new MemorySaver(),
      workingMemoryScopePolicy: AGENT_PRIVATE_WORKING_MEMORY,
      onAgentEvent: (event) => { events.push(event); },
    });
    await compiled.graph.invoke({ input: {} });

    const values = await runStateOf(compiled, "run-private-scope");
    const entries = Object.values(values.workingMemory ?? {});
    expect(entries.map((entry) => entry.content)).toEqual(["AGENT_PRIVATE finding stays private."]);
    expect(entries[0]).toMatchObject({ scope: "agent", agentId: "agent-a" });
    expect(JSON.stringify(values)).not.toContain("ESCALATION_ATTEMPT");
    expect(events.find((event) => (event.payload as { kind?: string } | undefined)?.kind === "working_memory.updated")!.payload)
      .toMatchObject({ reasons: { scope_not_permitted: 1 } });
  });

  test("working memory and generic workflow state stay independent", async () => {
    const built = stateAndAgentWorkflow(["agent-a", "agent-b"]);
    const seen: AgentExecutionInput[] = [];
    const compiled = compileWorkflow(built.workflow, [agent("agent-a"), agent("agent-b")], {
      runId: "run-state",
      runtime: realRuntime({ [built.agentNodes[0].id]: { wm: [{ kind: "decision", scope: "workflow", content: "WM_DECISION: extend the existing middleware." }] } }, seen),
      checkpointer: new MemorySaver(),
    });
    await compiled.graph.invoke({ input: { question: "go" } });
    const values = await runStateOf(compiled, "run-state");

    expect(values.memory).toMatchObject({ marker: { question: "go" } });
    expect(Object.values(values.workingMemory ?? {}).map((entry) => entry.content)).toEqual(["WM_DECISION: extend the existing middleware."]);
    // Neither channel absorbs the other.
    expect(JSON.stringify(values.memory)).not.toContain("WM_DECISION");
    expect(Object.keys(values.workingMemory ?? {})).not.toContain("marker");

    // Both reach the downstream agent as separately labelled context sources.
    const input = seen.find((candidate) => candidate.nodeId === built.agentNodes[1].id)!;
    expect(input.context?.memory).toMatchObject({ marker: { question: "go" } });
    const sources = input.assembledContext!.items.map((item) => item.source);
    expect(sources).toEqual(expect.arrayContaining(["runtime_state", "working_memory"]));
    expect(workingMemoryText(input)).toContain("WM_DECISION");
  });

  test("the working memory channel never enters short-term conversation history", async () => {
    const built = linearWorkflow(["agent-a"]);
    const marker = "HISTORY_MARKER is run knowledge, not a conversation turn.";
    const shortTerm: AgentRecord = { ...agent("agent-a"), memory: { enabled: true, type: "run", scope: "agent", mode: "read_write", maxEntries: 5, shortTerm: { enabled: true, maxTokens: 512 } } };
    const compiled = compileWorkflow(built.workflow, [shortTerm], {
      runId: "run-history",
      runtime: realRuntime({ [built.agentNodes[0].id]: { output: "ANSWER", wm: [{ kind: "finding", content: marker }] } }),
      checkpointer: new MemorySaver(),
    });
    await compiled.graph.invoke({ input: { question: "what?" } });
    const values = await runStateOf(compiled, "run-history");

    const histories = Object.values(values.shortTermHistories ?? {});
    expect(histories).toHaveLength(1);
    expect(histories[0].entries).toHaveLength(1);
    expect(histories[0].entries[0].output).toBe("ANSWER");
    expect(JSON.stringify(values.shortTermHistories)).not.toContain("HISTORY_MARKER");
    expect(JSON.stringify(values.shortTermHistories)).not.toContain("workingMemoryUpdates");
    // And working memory did not absorb the conversation turn.
    expect(Object.values(values.workingMemory ?? {}).map((entry) => entry.content)).toEqual([marker]);
  });

  test("a handoff references working memory without becoming a copy of it", async () => {
    const built = linearWorkflow(["agent-a"]);
    const nodeId = built.agentNodes[0].id;
    const entryId = `wm-${nodeId}-1`;
    const compiled = compileWorkflow(built.workflow, [agent("agent-a")], {
      runId: "run-handoff",
      runtime: realRuntime({ [nodeId]: {
        output: { summary: "Auth verified.", findings: [{ content: "Authentication verified.", evidenceRefs: [`working-memory:${entryId}`] }] },
        wm: [
          { kind: "finding", scope: "workflow", content: "WM_ONE hidden detail." },
          { kind: "finding", scope: "workflow", content: "WM_TWO hidden detail." },
          { kind: "finding", scope: "workflow", content: "WM_THREE hidden detail." },
        ],
      } }),
      checkpointer: new MemorySaver(),
    });
    await compiled.graph.invoke({ input: {} });
    const values = await runStateOf(compiled, "run-handoff");

    expect(Object.keys(values.workingMemory ?? {})).toHaveLength(3);
    const handoff = values.handoffs![nodeId];
    expect(handoff).toBeDefined();
    expect(handoff.findings[0].evidenceRefs).toEqual([`working-memory:${entryId}`]);
    expect(values.workingMemory?.[entryId]).toMatchObject({ content: "WM_ONE hidden detail." });
    // The handoff summarizes: it never carries every working memory entry.
    const serialized = JSON.stringify(handoff);
    for (const marker of ["WM_ONE", "WM_TWO", "WM_THREE"]) expect(serialized).not.toContain(marker);
  });
});
// Run executor: approval pause/resume and tenant isolation

const TEST_SECRET = "working-memory-tenant-test-secret";
const alice: AuthenticatedPrincipal = { userId: "alice", tenantId: "tenant-alpha" };
const eve: AuthenticatedPrincipal = { userId: "eve", tenantId: "tenant-beta" };

function principalFor(request: Request): AuthenticatedPrincipal | null {
  const token = request.headers.get("X-Multi-Agent-Principal");
  if (!token) return null;
  try {
    return verifyInternalPrincipalAssertion(token, TEST_SECRET);
  } catch {
    return null;
  }
}

function requestFor(path: string, method = "GET", principal?: AuthenticatedPrincipal, body?: unknown): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (principal) headers["X-Multi-Agent-Principal"] = createInternalPrincipalAssertion(principal, TEST_SECRET);
  return new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("working memory through the run executor", () => {
  test("working memory survives an approval pause, restart and resume", async () => {
    const built = linearWorkflow(["agent-a", "agent-b"], 0);
    const marker = "APPROVAL_SURVIVES: approval state survives restart.";
    const checkpointer = new MemorySaver();
    const seen: AgentExecutionInput[] = [];
    const store = new RunStore();
    const executor = new RunExecutor(store, fakeRuntime({ [built.agentNodes[0].id]: { wm: [{ kind: "question", scope: "workflow", content: marker }] } }, seen), checkpointer);

    const runId = executor.start({ workflow: built.workflow, agents: [agent("agent-a"), agent("agent-b")], input: {} }, access);
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    // The restarted read comes from the durable checkpoint, not process memory.
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: runId } });
    const checkpoint = (tuple?.checkpoint.channel_values ?? {}) as unknown as RunState;
    expect(Object.values(checkpoint.workingMemory ?? {}).map((entry) => entry.content)).toEqual([marker]);
    expect(seen.some((input) => input.nodeId === built.agentNodes[1].id)).toBe(false);

    const [approval] = store.listApprovals(runId);
    expect(approval.status).toBe("requested");
    executor.resolveApproval(runId, approval.id, { decision: "approved" });
    await waitFor(() => store.get(runId)?.run.status === "completed");

    const downstream = seen.find((input) => input.nodeId === built.agentNodes[1].id)!;
    expect(entriesOf(downstream.workingMemory)).toEqual([marker]);
    // Observability never carries working memory contents.
    expect(JSON.stringify(store.events(runId))).not.toContain(marker);
  });

  test("another tenant cannot reach a run's working memory through any run endpoint", async () => {
    const marker = "TENANT_A_ONLY: signed internal principals.";
    const built = linearWorkflow(["agent-a"], 0);
    const store = new RunStore();
    const checkpointer = new MemorySaver();
    const executor = new RunExecutor(store, fakeRuntime({ [built.agentNodes[0].id]: { wm: [{ kind: "finding", scope: "workflow", content: marker }] } }), checkpointer);
    const { app } = createRunsRouter(executor, undefined, undefined, async (request) => principalFor(request));

    const startResponse = await app.fetch(requestFor("/", "POST", alice, { workflow: built.workflow, agents: [agent("agent-a")], input: {} }));
    expect(startResponse.status).toBe(202);
    const { runId } = (await startResponse.json()) as { runId: string };
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    const tuple = await checkpointer.getTuple({ configurable: { thread_id: runId } });
    expect(JSON.stringify(tuple?.checkpoint.channel_values)).toContain(marker);

    for (const path of [`/${runId}`, `/${runId}/history`, `/${runId}/events`, `/${runId}/definition`, `/${runId}/approvals`]) {
      expect((await app.fetch(requestFor(path, "GET", eve))).status).toBe(404);
    }
    const [approval] = store.listApprovals(runId);
    expect((await app.fetch(requestFor(`/${runId}/approvals/${approval.id}/resolve`, "POST", eve, { decision: "approved" }))).status).toBe(404);

    // The owning tenant can read its run, and no run response echoes working memory.
    for (const path of [`/${runId}`, `/${runId}/history`, `/${runId}/definition`, `/${runId}/approvals`]) {
      const response = await app.fetch(requestFor(path, "GET", alice));
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(marker);
    }
    expect((await app.fetch(requestFor(`/${runId}/events`, "GET", alice))).status).toBe(200);

    expect((await app.fetch(requestFor(`/${runId}/approvals/${approval.id}/resolve`, "POST", alice, { decision: "approved" }))).status).toBe(202);
    await waitFor(() => store.get(runId)?.run.status === "completed");
  });
});
