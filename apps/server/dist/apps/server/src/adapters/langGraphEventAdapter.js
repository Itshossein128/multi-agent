"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangGraphEventAdapter = void 0;
var types_1 = require("@multi-agent/types");
var LangGraphEventAdapter = /** @class */ (function () {
    function LangGraphEventAdapter() {
    }
    LangGraphEventAdapter.prototype.adapt = function (raw, runId, workflow, agents) {
        var _a, _b, _c, _d, _e, _f, _g;
        var event = raw;
        if (event.type !== "event")
            return [];
        var nodeId = (_b = (_a = event.params) === null || _a === void 0 ? void 0 : _a.node) !== null && _b !== void 0 ? _b : (_d = (_c = event.params) === null || _c === void 0 ? void 0 : _c.namespace) === null || _d === void 0 ? void 0 : _d[0];
        var node = workflow.nodes.find(function (candidate) { return candidate.id === nodeId; });
        var payload = redact((_e = event.params) === null || _e === void 0 ? void 0 : _e.data);
        var eventType = event.method === "tasks" ? "node.completed" : "log";
        var result = [{ id: (0, types_1.uid)("event"), runId: runId, type: eventType, timestamp: (0, types_1.nowIso)(), nodeId: nodeId, agentId: (node === null || node === void 0 ? void 0 : node.type) === "agent" ? (_f = node.config.agentId) !== null && _f !== void 0 ? _f : undefined : undefined, sequence: 0, payload: { method: (_g = event.method) !== null && _g !== void 0 ? _g : "unknown", data: payload } }];
        if (event.method === "tasks" && (node === null || node === void 0 ? void 0 : node.type) === "agent")
            result.unshift(__assign(__assign({}, result[0]), { id: (0, types_1.uid)("event"), type: "agent.completed" }));
        return result;
    };
    return LangGraphEventAdapter;
}());
exports.LangGraphEventAdapter = LangGraphEventAdapter;
function redact(value, depth) {
    if (depth === void 0) { depth = 0; }
    if (depth > 4)
        return "[truncated]";
    if (Array.isArray(value))
        return value.slice(0, 50).map(function (item) { return redact(item, depth + 1); });
    if (!value || typeof value !== "object")
        return value;
    var output = {};
    for (var _i = 0, _a = Object.entries(value); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], item = _b[1];
        output[key] = /secret|token|password|api[-_]?key|authorization/i.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return output;
}
//# sourceMappingURL=langGraphEventAdapter.js.map