"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkflow = validateWorkflow;
exports.nodeLabel = nodeLabel;
const types_1 = require("@multi-agent/types");
function validateWorkflow(definition, agents) {
    const issues = [];
    const add = (severity, message, nodeId, edgeId) => issues.push({ id: `${severity}-${issues.length}`, severity, message, nodeId, edgeId });
    const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
    const ids = new Set();
    for (const node of definition.nodes) {
        if (ids.has(node.id))
            add("error", `Duplicate node id "${node.id}"`, node.id);
        ids.add(node.id);
    }
    for (const edge of definition.edges) {
        if (!nodes.has(edge.source))
            add("error", `Edge references missing source node "${edge.source}"`, undefined, edge.id);
        if (!nodes.has(edge.target))
            add("error", `Edge references missing target node "${edge.target}"`, undefined, edge.id);
        if (edge.kind === "conditional" && !edge.branchKey.trim())
            add("error", "Conditional edge is missing a branch key", undefined, edge.id);
    }
    const inputs = definition.nodes.filter((node) => node.type === "input");
    const outputs = definition.nodes.filter((node) => node.type === "output");
    if (inputs.length !== 1)
        add("error", `Workflow must have exactly one Input node (found ${inputs.length})`);
    if (outputs.length !== 1)
        add("error", `Workflow must have exactly one Output node (found ${outputs.length})`);
    for (const node of definition.nodes) {
        if (node.type === "agent") {
            const agentId = node.config.agentId;
            const agent = agents.find((candidate) => candidate.id === agentId);
            if (!agent)
                add("error", "Agent node is not linked to an agent", node.id);
            else if (!(0, types_1.agentHasConfiguredModel)(agent)) {
                const detail = agent.backend.type === "cli"
                    ? "has no CLI provider configured"
                    : "has no model configured";
                add("error", `Agent "${agent.name}" ${detail}`, node.id);
            }
        }
        if (node.type === "memory" && !node.config.key?.trim())
            add("error", "Memory node has no memory key", node.id);
        if (node.type === "condition") {
            const branches = node.config.branches ?? [];
            const keys = new Set(branches.map((branch) => branch.key));
            if (keys.size !== branches.length)
                add("error", "Condition node has duplicate branch keys", node.id);
            for (const edge of definition.edges.filter((candidate) => candidate.source === node.id && candidate.kind === "conditional")) {
                if (!keys.has(edge.branchKey))
                    add("warning", `Edge branch "${edge.branchKey}" is not defined on the Condition node`, node.id, edge.id);
            }
        }
    }
    return issues;
}
function nodeLabel(node, agents) {
    if (node.type === "agent") {
        const agentId = node.config.agentId;
        return agents.find((agent) => agent.id === agentId)?.name ?? node.id;
    }
    return node.type;
}
//# sourceMappingURL=validation.js.map