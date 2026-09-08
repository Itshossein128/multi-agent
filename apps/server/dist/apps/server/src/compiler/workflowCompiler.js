"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedPhase4NodeError = void 0;
exports.compileWorkflow = compileWorkflow;
var langgraph_1 = require("@langchain/langgraph");
var validation_1 = require("./validation");
var runtime_1 = require("../../../../src/agents/runtime");
var UnsupportedPhase4NodeError = /** @class */ (function (_super) {
    __extends(UnsupportedPhase4NodeError, _super);
    function UnsupportedPhase4NodeError(nodeId, node) {
        var _this = _super.call(this, "Node \"".concat(nodeId, "\" type \"").concat(node.type, "\" is not supported in Phase 4")) || this;
        _this.nodeId = nodeId;
        _this.name = "UnsupportedPhase4NodeError";
        return _this;
    }
    return UnsupportedPhase4NodeError;
}(Error));
exports.UnsupportedPhase4NodeError = UnsupportedPhase4NodeError;
var State = langgraph_1.Annotation.Root({
    input: (0, langgraph_1.Annotation)({ reducer: function (_, next) { return next; }, default: function () { return ({}); } }),
    output: (0, langgraph_1.Annotation)({ reducer: function (_, next) { return next; }, default: function () { return ({}); } }),
    memory: (0, langgraph_1.Annotation)({
        reducer: function (current, next) { return (__assign(__assign({}, current), next)); },
        default: function () { return ({}); },
    }),
    branch: (0, langgraph_1.Annotation)({ reducer: function (_, next) { return next; }, default: function () { return undefined; } }),
    lastValue: (0, langgraph_1.Annotation)({ reducer: function (_, next) { return next; }, default: function () { return undefined; } }),
});
function compileWorkflow(definition, agents, options) {
    var _this = this;
    var _a, _b;
    if (options === void 0) { options = {}; }
    var issues = (0, validation_1.validateWorkflow)(definition, agents);
    if (issues.some(function (issue) { return issue.severity === "error"; })) {
        throw new Error(issues.filter(function (issue) { return issue.severity === "error"; }).map(function (issue) { return issue.message; }).join("; "));
    }
    var graph = new langgraph_1.StateGraph(State);
    var nodesById = new Map(definition.nodes.map(function (node) { return [node.id, node]; }));
    var agentById = new Map(agents.map(function (agent) { return [agent.id, agent]; }));
    var runtime = (_a = options.agentRuntime) !== null && _a !== void 0 ? _a : new runtime_1.AgentRuntime();
    var runId = (_b = options.runId) !== null && _b !== void 0 ? _b : "run-local";
    var _loop_1 = function (node) {
        graph.addNode(node.id, function (state) { return __awaiter(_this, void 0, void 0, function () {
            var config_1, value_1, config_2, requested_1, branch, config, agent, value, _a;
            var _b;
            var _c, _d, _e, _f, _g;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        if (node.type === "tool" || node.type === "approval")
                            throw new UnsupportedPhase4NodeError(node.id, node);
                        if (node.type === "input")
                            return [2 /*return*/, { input: state.input, lastValue: state.input }];
                        if (node.type === "output") {
                            return [2 /*return*/, {
                                    output: state.lastValue && typeof state.lastValue === "object"
                                        ? state.lastValue
                                        : state.input,
                                }];
                        }
                        if (node.type === "memory") {
                            config_1 = node.config;
                            if (config_1.mode === "read")
                                return [2 /*return*/, { lastValue: state.memory[config_1.key] }];
                            value_1 = (_c = state.lastValue) !== null && _c !== void 0 ? _c : state.input;
                            return [2 /*return*/, { memory: (_b = {}, _b[config_1.key] = value_1, _b), lastValue: value_1 }];
                        }
                        if (node.type === "condition") {
                            config_2 = node.config;
                            requested_1 = (_e = (_d = state.input.branch) !== null && _d !== void 0 ? _d : state.input.condition) !== null && _e !== void 0 ? _e : state.input["branchKey"];
                            branch = typeof requested_1 === "string" && config_2.branches.some(function (item) { return item.key === requested_1; })
                                ? requested_1
                                : (_f = config_2.branches[0]) === null || _f === void 0 ? void 0 : _f.key;
                            return [2 /*return*/, { branch: branch, lastValue: state.lastValue }];
                        }
                        config = node.config;
                        agent = config.agentId ? agentById.get(config.agentId) : undefined;
                        if (!agent)
                            throw new Error("Agent node \"".concat(node.id, "\" has no linked agent"));
                        if (!options.agentRunner) return [3 /*break*/, 2];
                        return [4 /*yield*/, options.agentRunner(agent, state, { runId: runId, nodeId: node.id })];
                    case 1:
                        _a = _h.sent();
                        return [3 /*break*/, 4];
                    case 2: return [4 /*yield*/, runAgentThroughRuntime(runtime, agent, state, {
                            runId: runId,
                            nodeId: node.id,
                            workflowId: (_g = options.workflowId) !== null && _g !== void 0 ? _g : definition.id,
                            onAgentEvent: options.onAgentEvent,
                        })];
                    case 3:
                        _a = _h.sent();
                        _h.label = 4;
                    case 4:
                        value = _a;
                        return [2 /*return*/, { lastValue: value }];
                }
            });
        }); });
    };
    for (var _i = 0, _c = definition.nodes; _i < _c.length; _i++) {
        var node = _c[_i];
        _loop_1(node);
    }
    for (var _d = 0, _e = definition.edges; _d < _e.length; _d++) {
        var edge = _e[_d];
        var source = nodesById.get(edge.source);
        if ((source === null || source === void 0 ? void 0 : source.type) === "condition" || edge.kind === "conditional")
            continue;
        graph.addEdge(edge.source, edge.target);
    }
    var _loop_2 = function (node) {
        var outgoing = definition.edges.filter(function (edge) { return edge.source === node.id && edge.kind === "conditional"; });
        var destinations = {};
        for (var _h = 0, outgoing_1 = outgoing; _h < outgoing_1.length; _h++) {
            var edge = outgoing_1[_h];
            destinations[edge.branchKey] = edge.target;
        }
        graph.addConditionalEdges(node.id, function (state) { var _a; return (_a = state.branch) !== null && _a !== void 0 ? _a : "__end__"; }, __assign(__assign({}, destinations), { __end__: langgraph_1.END }));
    };
    for (var _f = 0, _g = definition.nodes.filter(function (candidate) { return candidate.type === "condition"; }); _f < _g.length; _f++) {
        var node = _g[_f];
        _loop_2(node);
    }
    var input = definition.nodes.find(function (node) { return node.type === "input"; });
    var output = definition.nodes.find(function (node) { return node.type === "output"; });
    if (input)
        graph.addEdge(langgraph_1.START, input.id);
    if (output)
        graph.addEdge(output.id, langgraph_1.END);
    return {
        graph: graph.compile(),
        agentByNode: new Map(definition.nodes
            .filter(function (node) { return node.type === "agent"; })
            .map(function (node) { var _a; return [node.id, agentById.get((_a = node.config.agentId) !== null && _a !== void 0 ? _a : "")]; })),
        issues: issues,
    };
}
function runAgentThroughRuntime(runtime, agent, state, meta) {
    return __awaiter(this, void 0, void 0, function () {
        var lastContent, _a, _b, _c, event_1, payload, payload, e_1_1, error_1;
        var _d, e_1, _e, _f;
        var _g, _h, _j;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    _k.trys.push([0, 13, , 14]);
                    _k.label = 1;
                case 1:
                    _k.trys.push([1, 6, 7, 12]);
                    _a = true, _b = __asyncValues(runtime.execute({
                        agent: agent,
                        input: (_g = state.lastValue) !== null && _g !== void 0 ? _g : state.input,
                        runId: meta.runId,
                        nodeId: meta.nodeId,
                        workflowId: meta.workflowId,
                        context: { memory: state.memory, branch: state.branch },
                    }));
                    _k.label = 2;
                case 2: return [4 /*yield*/, _b.next()];
                case 3:
                    if (!(_c = _k.sent(), _d = _c.done, !_d)) return [3 /*break*/, 5];
                    _f = _c.value;
                    _a = false;
                    event_1 = _f;
                    (_h = meta.onAgentEvent) === null || _h === void 0 ? void 0 : _h.call(meta, event_1);
                    if (event_1.type === "agent.completed" || event_1.type === "agent.output") {
                        payload = event_1.payload;
                        if (payload && "content" in payload)
                            lastContent = payload.content;
                        else
                            lastContent = event_1.payload;
                    }
                    if (event_1.type === "agent.failed") {
                        payload = event_1.payload;
                        throw new runtime_1.AgentExecutionFailedError((_j = payload === null || payload === void 0 ? void 0 : payload.error) !== null && _j !== void 0 ? _j : "Agent execution failed");
                    }
                    _k.label = 4;
                case 4:
                    _a = true;
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 12];
                case 6:
                    e_1_1 = _k.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 12];
                case 7:
                    _k.trys.push([7, , 10, 11]);
                    if (!(!_a && !_d && (_e = _b.return))) return [3 /*break*/, 9];
                    return [4 /*yield*/, _e.call(_b)];
                case 8:
                    _k.sent();
                    _k.label = 9;
                case 9: return [3 /*break*/, 11];
                case 10:
                    if (e_1) throw e_1.error;
                    return [7 /*endfinally*/];
                case 11: return [7 /*endfinally*/];
                case 12: return [3 /*break*/, 14];
                case 13:
                    error_1 = _k.sent();
                    if (error_1 instanceof runtime_1.UnsupportedBackendError || error_1 instanceof runtime_1.AgentExecutionFailedError) {
                        throw error_1;
                    }
                    throw error_1;
                case 14: return [2 /*return*/, lastContent];
            }
        });
    });
}
//# sourceMappingURL=workflowCompiler.js.map