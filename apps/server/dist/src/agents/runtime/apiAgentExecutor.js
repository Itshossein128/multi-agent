"use strict";
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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiAgentExecutor = void 0;
var types_1 = require("@multi-agent/types");
var errors_1 = require("./errors");
/**
 * Wraps the existing API/LLM provider stack behind AgentExecutor.
 * Credentials remain an env/runtime concern — never taken from the agent record.
 */
var ApiAgentExecutor = /** @class */ (function () {
    function ApiAgentExecutor(getFactory) {
        if (getFactory === void 0) { getFactory = loadLlmFactory; }
        this.getFactory = getFactory;
    }
    ApiAgentExecutor.prototype.execute = function (input) {
        return __asyncGenerator(this, arguments, function execute_1() {
            var agent, runId, nodeId, model, result, content, error_1, message;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        agent = input.agent, runId = input.runId, nodeId = input.nodeId;
                        if (agent.backend.type !== "api") {
                            throw new errors_1.AgentExecutionFailedError("ApiAgentExecutor cannot run backend type \"".concat(agent.backend.type, "\""));
                        }
                        return [4 /*yield*/, __await(baseEvent("agent.started", input, {
                                provider: agent.backend.provider,
                                model: agent.backend.model,
                            }))];
                    case 1: return [4 /*yield*/, _a.sent()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 9, , 12]);
                        model = this.getFactory().getModel(agent.backend.provider, {
                            model: agent.backend.model,
                        });
                        return [4 /*yield*/, __await(model.invoke([
                                { role: "system", content: systemPromptFor(agent) },
                                { role: "user", content: serializeInput(input.input) },
                            ]))];
                    case 4:
                        result = _a.sent();
                        content = result.content;
                        return [4 /*yield*/, __await(baseEvent("agent.output", input, { content: content }))];
                    case 5: return [4 /*yield*/, _a.sent()];
                    case 6:
                        _a.sent();
                        return [4 /*yield*/, __await(baseEvent("agent.completed", input, { content: content }))];
                    case 7: return [4 /*yield*/, _a.sent()];
                    case 8:
                        _a.sent();
                        return [3 /*break*/, 12];
                    case 9:
                        error_1 = _a.sent();
                        message = error_1 instanceof Error ? error_1.message : String(error_1);
                        return [4 /*yield*/, __await(baseEvent("agent.failed", input, { error: message }))];
                    case 10: return [4 /*yield*/, _a.sent()];
                    case 11:
                        _a.sent();
                        throw new errors_1.AgentExecutionFailedError(message);
                    case 12: return [2 /*return*/];
                }
            });
        });
    };
    return ApiAgentExecutor;
}());
exports.ApiAgentExecutor = ApiAgentExecutor;
function systemPromptFor(agent) {
    return agent.systemPrompt || "You are a helpful workflow agent.";
}
function serializeInput(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value !== null && value !== void 0 ? value : {});
    }
    catch (_a) {
        return String(value);
    }
}
function baseEvent(type, input, payload) {
    return {
        type: type,
        timestamp: (0, types_1.nowIso)(),
        agentId: input.agent.id,
        nodeId: input.nodeId,
        runId: input.runId,
        payload: payload,
    };
}
function loadLlmFactory() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    var mod = require("../core/llmFactory");
    return mod.llmFactory;
}
//# sourceMappingURL=apiAgentExecutor.js.map