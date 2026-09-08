"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangGraphEventAdapter = void 0;
exports.redact = redact;
const types_1 = require("@multi-agent/types");
class LangGraphEventAdapter {
    adapt(raw, runId, workflow, agents) {
        const event = raw;
        if (event.type !== "event")
            return [];
        const nodeId = event.params?.node ?? event.params?.namespace?.[0];
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
        const payload = redact(event.params?.data);
        const eventType = event.method === "tasks" ? "node.completed" : "log";
        const result = [{ id: (0, types_1.uid)("event"), runId, type: eventType, timestamp: (0, types_1.nowIso)(), nodeId, agentId: node?.type === "agent" ? node.config.agentId ?? undefined : undefined, sequence: 0, payload: { method: event.method ?? "unknown", data: payload } }];
        if (event.method === "tasks" && node?.type === "agent")
            result.unshift({ ...result[0], id: (0, types_1.uid)("event"), type: "agent.completed" });
        return result;
    }
}
exports.LangGraphEventAdapter = LangGraphEventAdapter;
function redact(value, depth = 0) {
    if (depth > 4)
        return "[truncated]";
    if (Array.isArray(value))
        return value.slice(0, 50).map((item) => redact(item, depth + 1));
    if (typeof value === "string")
        return value
            .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
            .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[redacted]")
            .replace(/((?:api[_-]?key|password|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
            .slice(0, 12000);
    if (!value || typeof value !== "object")
        return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        output[key] = /secret|token|password|api[-_]?key|authorization|credential|stack/i.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return output;
}
//# sourceMappingURL=langGraphEventAdapter.js.map