"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkflow = validateWorkflow;
exports.nodeLabel = nodeLabel;
const types_1 = require("@multi-agent/types");
function validateWorkflow(definition, agents, limits = {}) {
    const issues = [];
    const add = (level, code, message, nodeId, edgeId) => issues.push({ id: `${level}-${code}-${issues.length}`, code, level, severity: level, message, nodeId, edgeId });
    if (!definition || typeof definition !== "object")
        return [{ id: "error-invalid-definition", code: "INVALID_WORKFLOW", level: "error", severity: "error", message: "Workflow definition must be an object." }];
    const maxNodes = limits.maxNodes ?? 100;
    const maxEdges = limits.maxEdges ?? 250;
    const maxBranches = limits.maxBranches ?? 25;
    if (definition.nodes.length > maxNodes)
        add("error", "NODE_LIMIT_EXCEEDED", `Workflow exceeds the ${maxNodes}-node limit.`);
    if (definition.edges.length > maxEdges)
        add("error", "EDGE_LIMIT_EXCEEDED", `Workflow exceeds the ${maxEdges}-edge limit.`);
    const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
    const ids = new Set(), edgeIds = new Set();
    for (const node of definition.nodes) {
        if (!node.id?.trim())
            add("error", "INVALID_NODE_ID", "Node id is required.", node.id);
        if (ids.has(node.id))
            add("error", "DUPLICATE_NODE_ID", `Duplicate node id "${node.id}"`, node.id);
        ids.add(node.id);
        if (!node.config || typeof node.config !== "object" || Array.isArray(node.config))
            add("error", "INVALID_NODE_CONFIG", "Node configuration must be an object.", node.id);
    }
    for (const edge of definition.edges) {
        if (!edge.id?.trim())
            add("error", "INVALID_EDGE_ID", "Edge id is required.", undefined, edge.id);
        if (edgeIds.has(edge.id))
            add("error", "DUPLICATE_EDGE_ID", `Duplicate edge id "${edge.id}"`, undefined, edge.id);
        edgeIds.add(edge.id);
        if (!nodes.has(edge.source))
            add("error", "INVALID_EDGE_REFERENCE", `Edge references missing source node "${edge.source}"`, undefined, edge.id);
        if (!nodes.has(edge.target))
            add("error", "INVALID_EDGE_REFERENCE", `Edge references missing target node "${edge.target}"`, undefined, edge.id);
        if (edge.source === edge.target)
            add("error", "UNSAFE_CYCLE", "Self-referential edges are not supported.", edge.source, edge.id);
        if (edge.kind === "conditional" && !edge.branchKey.trim())
            add("error", "MISSING_BRANCH_KEY", "Conditional edge is missing a branch key", undefined, edge.id);
        if (edge.kind !== "conditional" && edge.branchKey.trim())
            add("warning", "UNUSED_BRANCH_KEY", "Normal edges ignore branch keys.", undefined, edge.id);
        const source = nodes.get(edge.source), target = nodes.get(edge.target);
        if (target?.type === "input")
            add("error", "INVALID_CONNECTION", "Input nodes cannot have incoming edges.", target.id, edge.id);
        if (source?.type === "output")
            add("error", "INVALID_CONNECTION", "Output nodes cannot have outgoing edges.", source.id, edge.id);
        if (source?.type === "condition" && edge.kind !== "conditional")
            add("error", "AMBIGUOUS_BRANCHING", "Condition nodes require conditional outgoing edges.", source.id, edge.id);
        if (edge.kind === "conditional" && source?.type !== "condition" && source?.type !== "approval")
            add("error", "INVALID_CONDITIONAL_SOURCE", "Conditional edges may only leave condition or approval nodes.", source?.id, edge.id);
    }
    const inputs = definition.nodes.filter((node) => node.type === "input");
    const outputs = definition.nodes.filter((node) => node.type === "output");
    if (inputs.length !== 1)
        add("error", "INVALID_INPUT_COUNT", `Workflow must have exactly one Input node (found ${inputs.length})`);
    if (outputs.length !== 1)
        add("error", "INVALID_OUTPUT_COUNT", `Workflow must have exactly one Output node (found ${outputs.length})`);
    for (const node of definition.nodes) {
        if (node.type === "agent") {
            const agentId = node.config.agentId;
            const agent = agents.find((candidate) => candidate.id === agentId);
            if (!agent)
                add("error", "MISSING_AGENT_CONFIG", "Agent node is not linked to an agent", node.id);
            else if (!(0, types_1.agentHasConfiguredModel)(agent)) {
                const detail = agent.backend.type === "cli"
                    ? "has no CLI provider configured"
                    : "has no model configured";
                add("error", "MISSING_AGENT_MODEL", `Agent "${agent.name}" ${detail}`, node.id);
            }
            if (agent?.enabled === false)
                add("error", "AGENT_DISABLED", `Agent "${agent.name}" is disabled`, node.id);
            if (agent)
                for (const message of (0, types_1.validateAgent)(agent))
                    add("error", "INVALID_AGENT_CONFIG", message, node.id);
        }
        if (node.type === "tool" && !node.config.toolId?.trim())
            add("error", "MISSING_TOOL_CONFIG", "Tool node is not linked to a tool.", node.id);
        if (node.type === "memory") {
            const config = node.config;
            if (!config.key?.trim())
                add("error", "MISSING_MEMORY_KEY", "Memory node has no memory key", node.id);
            if (!['read', 'write', 'read_write'].includes(config.mode ?? ""))
                add("error", "INVALID_MEMORY_MODE", "Memory node has an invalid mode.", node.id);
            if (!['short_term', 'long_term', 'shared'].includes(config.memoryType ?? ""))
                add("error", "INVALID_MEMORY_TYPE", "Memory node has an invalid type.", node.id);
        }
        if (node.type === "approval") {
            const config = node.config;
            if (!config.message?.trim())
                add("error", "MISSING_APPROVAL_MESSAGE", "Approval node requires a message.", node.id);
            if (!['manual', 'timeout'].includes(config.approvalType ?? ""))
                add("error", "INVALID_APPROVAL_TYPE", "Approval node has an invalid type.", node.id);
            if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds < 0 || config.timeoutSeconds > 86_400)
                add("error", "INVALID_APPROVAL_TIMEOUT", "Approval timeout must be between 0 and 86400 seconds.", node.id);
        }
        if (node.type === "condition") {
            const branches = node.config.branches ?? [];
            const keys = new Set(branches.map((branch) => branch.key));
            if (!branches.length)
                add("error", "MISSING_CONDITION_BRANCHES", "Condition node requires at least one branch.", node.id);
            if (branches.length > maxBranches)
                add("error", "BRANCH_LIMIT_EXCEEDED", `Condition node exceeds the ${maxBranches}-branch limit.`, node.id);
            if (branches.some(branch => !branch.key?.trim()))
                add("error", "INVALID_BRANCH_KEY", "Condition node has an empty branch key.", node.id);
            if (keys.size !== branches.length)
                add("error", "DUPLICATE_BRANCH_KEY", "Condition node has duplicate branch keys", node.id);
            for (const edge of definition.edges.filter((candidate) => candidate.source === node.id && candidate.kind === "conditional")) {
                if (!keys.has(edge.branchKey))
                    add("error", "INVALID_CONDITIONAL_BRANCH", `Edge branch "${edge.branchKey}" is not defined on the Condition node`, node.id, edge.id);
            }
            for (const branch of branches)
                if (!definition.edges.some(edge => edge.source === node.id && edge.kind === "conditional" && edge.branchKey === branch.key))
                    add("warning", "UNCONNECTED_BRANCH", `Condition branch "${branch.key}" has no outgoing edge.`, node.id);
        }
    }
    detectCycles(definition, nodes, add);
    return issues;
}
function detectCycles(definition, nodes, add) {
    const visiting = new Set(), visited = new Set();
    const walk = (id) => {
        if (visiting.has(id)) {
            add("error", "UNSAFE_CYCLE", "Cycles are not supported until explicit loop semantics are implemented.", id);
            return;
        }
        if (visited.has(id))
            return;
        visiting.add(id);
        for (const edge of definition.edges.filter(candidate => candidate.source === id && nodes.has(candidate.target)))
            walk(edge.target);
        visiting.delete(id);
        visited.add(id);
    };
    for (const node of definition.nodes)
        walk(node.id);
}
function nodeLabel(node, agents) {
    if (node.type === "agent") {
        const agentId = node.config.agentId;
        return agents.find((agent) => agent.id === agentId)?.name ?? node.id;
    }
    return node.type;
}
//# sourceMappingURL=validation.js.map