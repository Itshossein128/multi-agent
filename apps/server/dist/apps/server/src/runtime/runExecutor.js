"use strict";
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
exports.RunExecutor = void 0;
var types_1 = require("@multi-agent/types");
var langGraphEventAdapter_1 = require("../adapters/langGraphEventAdapter");
var workflowCompiler_1 = require("../compiler/workflowCompiler");
var runtime_1 = require("../../../../src/agents/runtime");
var runStore_1 = require("./runStore");
var RunExecutor = /** @class */ (function () {
    function RunExecutor(store) {
        if (store === void 0) { store = new runStore_1.RunStore(); }
        this.store = store;
    }
    RunExecutor.prototype.getStore = function () { return this.store; };
    RunExecutor.prototype.start = function (request) {
        var _a;
        var id = (0, types_1.uid)("run");
        var stamp = (0, types_1.nowIso)();
        var run = { id: id, workflowId: request.workflow.id, taskId: request.taskId, status: "queued", startedAt: stamp, input: (_a = request.input) !== null && _a !== void 0 ? _a : {}, metadata: {} };
        this.store.create(run);
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, type: "run.started", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
        void this.execute(id, request);
        return id;
    };
    RunExecutor.prototype.cancel = function (runId) { return this.store.cancel(runId); };
    RunExecutor.prototype.execute = function (runId, request) {
        return __awaiter(this, void 0, void 0, function () {
            var adapter, compiled, stream, output, _a, _b, _c, raw, rawRecord, values, _i, _d, event_1, e_1_1, error_1, message, unsupported;
            var _this = this;
            var _e, e_1, _f, _g;
            var _h, _j, _k;
            return __generator(this, function (_l) {
                switch (_l.label) {
                    case 0:
                        this.store.update(runId, { status: "running" });
                        adapter = new langGraphEventAdapter_1.LangGraphEventAdapter();
                        _l.label = 1;
                    case 1:
                        _l.trys.push([1, 15, , 16]);
                        compiled = (0, workflowCompiler_1.compileWorkflow)(request.workflow, request.agents, {
                            runId: runId,
                            workflowId: request.workflow.id,
                            onAgentEvent: function (event) {
                                for (var _i = 0, _a = (0, runtime_1.mapAgentExecutionEvent)(event, runId); _i < _a.length; _i++) {
                                    var runEvent = _a[_i];
                                    _this.store.append(runId, runEvent);
                                }
                            },
                        });
                        return [4 /*yield*/, compiled.graph.streamEvents({ input: (_h = request.input) !== null && _h !== void 0 ? _h : {}, output: {}, memory: {} }, { version: "v3", streamMode: ["tasks", "updates", "values", "messages"], signal: this.store.signal(runId), configurable: { thread_id: runId } })];
                    case 2:
                        stream = _l.sent();
                        output = void 0;
                        _l.label = 3;
                    case 3:
                        _l.trys.push([3, 8, 9, 14]);
                        _a = true, _b = __asyncValues(stream);
                        _l.label = 4;
                    case 4: return [4 /*yield*/, _b.next()];
                    case 5:
                        if (!(_c = _l.sent(), _e = _c.done, !_e)) return [3 /*break*/, 7];
                        _g = _c.value;
                        _a = false;
                        raw = _g;
                        rawRecord = raw;
                        if (rawRecord.method === "values" && ((_j = rawRecord.params) === null || _j === void 0 ? void 0 : _j.data) && typeof rawRecord.params.data === "object") {
                            values = rawRecord.params.data;
                            if (values.output)
                                output = values.output;
                        }
                        for (_i = 0, _d = adapter.adapt(raw, runId, request.workflow, request.agents); _i < _d.length; _i++) {
                            event_1 = _d[_i];
                            this.store.append(runId, event_1);
                        }
                        _l.label = 6;
                    case 6:
                        _a = true;
                        return [3 /*break*/, 4];
                    case 7: return [3 /*break*/, 14];
                    case 8:
                        e_1_1 = _l.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 14];
                    case 9:
                        _l.trys.push([9, , 12, 13]);
                        if (!(!_a && !_e && (_f = _b.return))) return [3 /*break*/, 11];
                        return [4 /*yield*/, _f.call(_b)];
                    case 10:
                        _l.sent();
                        _l.label = 11;
                    case 11: return [3 /*break*/, 13];
                    case 12:
                        if (e_1) throw e_1.error;
                        return [7 /*endfinally*/];
                    case 13: return [7 /*endfinally*/];
                    case 14:
                        this.store.update(runId, { status: "completed", completedAt: (0, types_1.nowIso)(), output: output });
                        this.store.append(runId, { id: (0, types_1.uid)("event"), runId: runId, type: "run.completed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { output: output } });
                        return [3 /*break*/, 16];
                    case 15:
                        error_1 = _l.sent();
                        message = error_1 instanceof Error ? error_1.message : String(error_1);
                        unsupported = error_1 instanceof workflowCompiler_1.UnsupportedPhase4NodeError;
                        if (unsupported)
                            this.store.append(runId, { id: (0, types_1.uid)("event"), runId: runId, type: "node.failed", timestamp: (0, types_1.nowIso)(), nodeId: error_1.nodeId, sequence: 0, payload: { error: message } });
                        this.store.update(runId, { status: ((_k = this.store.signal(runId)) === null || _k === void 0 ? void 0 : _k.aborted) ? "cancelled" : "failed", completedAt: (0, types_1.nowIso)(), error: message });
                        this.store.append(runId, { id: (0, types_1.uid)("event"), runId: runId, type: "run.failed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { error: message } });
                        return [3 /*break*/, 16];
                    case 16: return [2 /*return*/];
                }
            });
        });
    };
    return RunExecutor;
}());
exports.RunExecutor = RunExecutor;
//# sourceMappingURL=runExecutor.js.map