"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkflow = validateWorkflow;
exports.nodeLabel = nodeLabel;
var types_1 = require("@multi-agent/types");
function validateWorkflow(definition, agents) {
    var _a, _b;
    var issues = [];
    var add = function (severity, message, nodeId, edgeId) {
        return issues.push({ id: "".concat(severity, "-").concat(issues.length), severity: severity, message: message, nodeId: nodeId, edgeId: edgeId });
    };
    var nodes = new Map(definition.nodes.map(function (node) { return [node.id, node]; }));
    var ids = new Set();
    for (var _i = 0, _c = definition.nodes; _i < _c.length; _i++) {
        var node = _c[_i];
        if (ids.has(node.id))
            add("error", "Duplicate node id \"".concat(node.id, "\""), node.id);
        ids.add(node.id);
    }
    for (var _d = 0, _e = definition.edges; _d < _e.length; _d++) {
        var edge = _e[_d];
        if (!nodes.has(edge.source))
            add("error", "Edge references missing source node \"".concat(edge.source, "\""), undefined, edge.id);
        if (!nodes.has(edge.target))
            add("error", "Edge references missing target node \"".concat(edge.target, "\""), undefined, edge.id);
        if (edge.kind === "conditional" && !edge.branchKey.trim())
            add("error", "Conditional edge is missing a branch key", undefined, edge.id);
    }
    var inputs = definition.nodes.filter(function (node) { return node.type === "input"; });
    var outputs = definition.nodes.filter(function (node) { return node.type === "output"; });
    if (inputs.length !== 1)
        add("error", "Workflow must have exactly one Input node (found ".concat(inputs.length, ")"));
    if (outputs.length !== 1)
        add("error", "Workflow must have exactly one Output node (found ".concat(outputs.length, ")"));
    var _loop_1 = function (node) {
        if (node.type === "agent") {
            var agentId_1 = node.config.agentId;
            var agent = agents.find(function (candidate) { return candidate.id === agentId_1; });
            if (!agent)
                add("error", "Agent node is not linked to an agent", node.id);
            else if (!(0, types_1.agentHasConfiguredModel)(agent)) {
                var detail = agent.backend.type === "cli"
                    ? "has no CLI provider configured"
                    : "has no model configured";
                add("error", "Agent \"".concat(agent.name, "\" ").concat(detail), node.id);
            }
        }
        if (node.type === "memory" && !((_a = node.config.key) === null || _a === void 0 ? void 0 : _a.trim()))
            add("error", "Memory node has no memory key", node.id);
        if (node.type === "condition") {
            var branches = (_b = node.config.branches) !== null && _b !== void 0 ? _b : [];
            var keys = new Set(branches.map(function (branch) { return branch.key; }));
            if (keys.size !== branches.length)
                add("error", "Condition node has duplicate branch keys", node.id);
            for (var _h = 0, _j = definition.edges.filter(function (candidate) { return candidate.source === node.id && candidate.kind === "conditional"; }); _h < _j.length; _h++) {
                var edge = _j[_h];
                if (!keys.has(edge.branchKey))
                    add("warning", "Edge branch \"".concat(edge.branchKey, "\" is not defined on the Condition node"), node.id, edge.id);
            }
        }
    };
    for (var _f = 0, _g = definition.nodes; _f < _g.length; _f++) {
        var node = _g[_f];
        _loop_1(node);
    }
    return issues;
}
function nodeLabel(node, agents) {
    var _a, _b;
    if (node.type === "agent") {
        var agentId_2 = node.config.agentId;
        return (_b = (_a = agents.find(function (agent) { return agent.id === agentId_2; })) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : node.id;
    }
    return node.type;
}
//# sourceMappingURL=validation.js.map