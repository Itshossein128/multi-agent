import { nowIso, uid, type Run, type RunCreateRequest, type RunEvent } from "@multi-agent/types";
import { LangGraphEventAdapter } from "../adapters/langGraphEventAdapter";
import { compileWorkflow, UnsupportedPhase4NodeError, type AgentExecutionEvent } from "../compiler/workflowCompiler";
import { RunStore } from "./runStore";

function mapAgentEvents(event: AgentExecutionEvent, runId: string): RunEvent[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mapAgentExecutionEvent } = require("../../../../src/agents/runtime") as {
    mapAgentExecutionEvent: (event: AgentExecutionEvent, runId: string) => RunEvent[];
  };
  return mapAgentExecutionEvent(event, runId);
}

export class RunExecutor {
  constructor(private readonly store = new RunStore()) { }
  getStore() { return this.store; }
  start(request: RunCreateRequest) {
    const id = uid("run"); const stamp = nowIso();
    const run: Run = { id, workflowId: request.workflow.id, taskId: request.taskId, status: "queued", startedAt: stamp, input: request.input ?? {}, metadata: {} };
    this.store.create(run); this.store.append(id, { id: uid("event"), runId: id, type: "run.started", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
    void this.execute(id, request);
    return id;
  }
  cancel(runId: string) { return this.store.cancel(runId); }
  private async execute(runId: string, request: RunCreateRequest) {
    this.store.update(runId, { status: "running" });
    const adapter = new LangGraphEventAdapter();
    try {
      const compiled = compileWorkflow(request.workflow, request.agents, {
        runId,
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
        for (const event of adapter.adapt(raw, runId, request.workflow, request.agents)) this.store.append(runId, event);
      }
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

