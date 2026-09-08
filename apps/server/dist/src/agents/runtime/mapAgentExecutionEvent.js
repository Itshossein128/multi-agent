"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapAgentExecutionEvent = mapAgentExecutionEvent;
const types_1 = require("@multi-agent/types");
const TYPE_MAP = {
    "agent.started": "agent.started",
    "agent.output": "log",
    "agent.completed": "agent.completed",
    "agent.failed": "agent.failed",
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
            type: TYPE_MAP[event.type],
            timestamp: event.timestamp || (0, types_1.nowIso)(),
            nodeId: event.nodeId,
            agentId: event.agentId,
            sequence: 0,
            payload,
        },
    ];
}
//# sourceMappingURL=mapAgentExecutionEvent.js.map