"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapAgentExecutionEvent = mapAgentExecutionEvent;
const types_1 = require("@multi-agent/types");
const TYPE_MAP = {
    "agent.started": "agent.started",
    "agent.output": "log",
    "agent.completed": "agent.completed",
    "agent.failed": "agent.failed",
    "llm.started": "llm.started",
    "llm.completed": "llm.completed",
    "llm.failed": "llm.failed",
    "tool.started": "tool.started",
    "tool.completed": "tool.completed",
    "tool.failed": "tool.failed",
    "memory.read": "memory.read",
    "memory.write": "memory.write",
    log: "log",
};
/** Map executor-boundary events into the Phase 4 RunEvent stream. */
function mapAgentExecutionEvent(event, runId) {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload
        : { value: event.payload };
    return [
        {
            id: (0, types_1.uid)("event"),
            runId: event.runId ?? runId,
            // Compiler/runtime lifecycle events already use the shared vocabulary;
            // executor-specific events are translated by the table above.
            // Keep the public stream closed over the shared vocabulary. A future or
            // provider-specific executor event is still useful as a diagnostic log,
            // but must not silently create an invalid RunEvent type.
            type: TYPE_MAP[event.type] ?? "log",
            timestamp: event.timestamp || (0, types_1.nowIso)(),
            nodeId: event.nodeId,
            agentId: event.agentId,
            toolId: typeof payload.toolId === "string" ? payload.toolId : undefined,
            sequence: 0,
            payload,
        },
    ];
}
//# sourceMappingURL=mapAgentExecutionEvent.js.map