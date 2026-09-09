import { nowIso, uid, validateAgent, type AgentTestRequest, type Run, type RunCreateRequest, type RunEvent } from "@multi-agent/types";
import { LangGraphEventAdapter } from "../adapters/langGraphEventAdapter";
import { compileWorkflow, UnsupportedPhase4NodeError, type AgentExecutionEvent, type CompileOptions } from "../compiler/workflowCompiler";
import { RunStore } from "./runStore";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { AgentRuntime, mapAgentExecutionEvent } from "../../../../src/agents/runtime";

function mapAgentEvents(event: AgentExecutionEvent, runId: string): RunEvent[] {
  return mapAgentExecutionEvent(event as Parameters<typeof mapAgentExecutionEvent>[0], runId);
}

export class RunExecutor {
  constructor(
    private readonly store = new RunStore(),
    private readonly agentRuntime: Pick<AgentRuntime, "execute"> = new AgentRuntime(),
    private readonly checkpointer?: CompileOptions["checkpointer"],
  ) { }
  getStore() { return this.store; }
  startAgentTest(request: AgentTestRequest, memoryAccess?: MemoryAccessContext) {
    const errors = validateAgent(request.agent);
    if (request.agent.enabled === false) errors.push("Agent is disabled. Enable it before execution.");
    if (errors.length) throw new Error(errors.join(" "));
    const id = uid("run");
    const stamp = nowIso();
    this.store.create({ id, workflowId: `agent-test:${request.agent.id}`, status: "running", startedAt: stamp, input: request.input, metadata: { kind: "agent-test" } }, memoryAccess);
    this.store.append(id, { id: uid("event"), runId: id, agentId: request.agent.id, type: "run.started", timestamp: stamp, sequence: 0, payload: {} });
    void this.executeAgentTest(id, request, memoryAccess);
    return id;
  }
  private async executeAgentTest(runId: string, request: AgentTestRequest, memoryAccess?: MemoryAccessContext) {
    try {
      let output: Record<string, unknown> = {};
      for await (const event of this.agentRuntime.execute({ agent: request.agent, input: request.input, runId, nodeId: `test:${request.agent.id}`, signal: this.store.signal(runId), memoryStore: new Map(), memoryAccess, onBackgroundEvent: event => { for (const mapped of mapAgentEvents(event, runId)) this.store.append(runId, mapped); } })) {
        for (const mapped of mapAgentEvents(event, runId)) this.store.append(runId, mapped);
        if (event.type === "agent.completed") output = { content: (event.payload as { content?: unknown })?.content };
        if (event.type === "agent.failed") throw new Error((event.payload as { error?: string })?.error ?? "Agent failed");
      }
      this.store.signal(runId)?.throwIfAborted();
      this.store.update(runId, { status: "completed", completedAt: nowIso(), output });
      this.store.append(runId, { id: uid("event"), runId, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: { output } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.update(runId, { status: this.store.signal(runId)?.aborted ? "cancelled" : "failed", completedAt: nowIso(), error: message });
      this.store.append(runId, { id: uid("event"), runId, type: "run.failed", timestamp: nowIso(), sequence: 0, payload: { error: message } });
    }
  }
  start(request: RunCreateRequest, memoryAccess?: MemoryAccessContext) {
    const id = uid("run"); const stamp = nowIso();
    const run: Run = { id, workflowId: request.workflow.id, taskId: request.taskId, status: "queued", startedAt: stamp, input: request.input ?? {}, metadata: {} };
    this.store.create(run, memoryAccess); this.store.append(id, { id: uid("event"), runId: id, type: "run.started", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
    void this.execute(id, request, memoryAccess);
    return id;
  }
  cancel(runId: string) { return this.store.cancel(runId); }
  private async execute(runId: string, request: RunCreateRequest, memoryAccess?: MemoryAccessContext) {
    this.store.update(runId, { status: "running" });
    const adapter = new LangGraphEventAdapter();
    try {
      const compiled = compileWorkflow(request.workflow, request.agents, {
        runId,
        runtime: this.agentRuntime,
        checkpointer: this.checkpointer,
        memoryAccess,
        signal: this.store.signal(runId),
        workflowId: request.workflow.id,
        onAgentEvent: (event) => {
          for (const runEvent of mapAgentEvents(event, runId)) {
            this.store.append(runId, runEvent);
          }
        },
      });
      const stream = await compiled.graph.streamEvents({ input: request.input ?? {}, output: {}, memory: {} }, { version: "v3", streamMode: ["tasks", "updates", "values", "messages"], signal: this.store.signal(runId), configurable: { thread_id: runId } } as never);
      let output: Record<string, unknown> | undefined;
      for await (const raw of stream as AsyncIterable<unknown>) {
        const rawRecord = raw as { method?: string; params?: { data?: unknown } };
        if (rawRecord.method === "values" && rawRecord.params?.data && typeof rawRecord.params.data === "object") {
          const values = rawRecord.params.data as { output?: Record<string, unknown> };
          if (values.output) output = values.output;
        }
        // Agent lifecycle comes from AgentRuntime exactly once, not the graph task adapter.
        for (const event of adapter.adapt(raw, runId, request.workflow, request.agents)) {
          if (!event.type.startsWith("agent.")) this.store.append(runId, event);
        }
      }
      this.store.signal(runId)?.throwIfAborted();
      this.store.update(runId, { status: "completed", completedAt: nowIso(), output });
      this.store.append(runId, { id: uid("event"), runId, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: { output } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unsupported = error instanceof UnsupportedPhase4NodeError;
      if (unsupported) this.store.append(runId, { id: uid("event"), runId, type: "node.failed", timestamp: nowIso(), nodeId: error.nodeId, sequence: 0, payload: { error: message } });
      this.store.update(runId, { status: this.store.signal(runId)?.aborted ? "cancelled" : "failed", completedAt: nowIso(), error: message });
      this.store.append(runId, { id: uid("event"), runId, type: "run.failed", timestamp: nowIso(), sequence: 0, payload: { error: message } });
    }
  }
}
