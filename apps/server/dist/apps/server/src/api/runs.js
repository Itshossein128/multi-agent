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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRunsRouter = createRunsRouter;
var hono_1 = require("hono");
var streaming_1 = require("hono/streaming");
var types_1 = require("@multi-agent/types");
var runExecutor_1 = require("../runtime/runExecutor");
function createRunsRouter(executor) {
    var _this = this;
    if (executor === void 0) { executor = new runExecutor_1.RunExecutor(); }
    var app = new hono_1.Hono();
    app.post("/", function (c) { return __awaiter(_this, void 0, void 0, function () {
        var body, agents;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, c.req.json()];
                case 1:
                    body = _a.sent();
                    if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges) || !Array.isArray(body.agents)) {
                        return [2 /*return*/, c.json({ error: "workflow, agents, nodes, and edges are required" }, 400)];
                    }
                    try {
                        agents = body.agents.map(function (agent) { return (0, types_1.migrateAgentRecord)(agent); });
                        return [2 /*return*/, c.json({ runId: executor.start(__assign(__assign({}, body), { agents: agents })) }, 202)];
                    }
                    catch (error) {
                        return [2 /*return*/, c.json({ error: error instanceof Error ? error.message : String(error) }, 400)];
                    }
                    return [2 /*return*/];
            }
        });
    }); });
    app.get("/:runId", function (c) {
        var entry = executor.getStore().get(c.req.param("runId"));
        return entry ? c.json(entry.run) : c.json({ error: "Run not found" }, 404);
    });
    app.post("/:runId/cancel", function (c) {
        var runId = c.req.param("runId");
        var entry = executor.getStore().get(runId);
        if (!entry)
            return c.json({ error: "Run not found" }, 404);
        executor.cancel(runId);
        return c.json({ runId: runId, status: "cancelling" }, 202);
    });
    app.get("/:runId/events", function (c) {
        var _a, _b;
        var runId = c.req.param("runId");
        if (!executor.getStore().get(runId))
            return c.json({ error: "Run not found" }, 404);
        var after = Number((_b = (_a = c.req.query("sequence")) !== null && _a !== void 0 ? _a : c.req.header("Last-Event-ID")) !== null && _b !== void 0 ? _b : 0) || 0;
        return (0, streaming_1.streamSSE)(c, function (stream) { return __awaiter(_this, void 0, void 0, function () {
            var send, _i, _a, event_1, resolve, wake, unsubscribe, status_1;
            var _this = this;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        send = function (event) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, stream.writeSSE({ id: String(event.sequence), event: "run-event", data: JSON.stringify(event) })];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); };
                        _i = 0, _a = executor.getStore().events(runId, after);
                        _c.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        event_1 = _a[_i];
                        return [4 /*yield*/, send(event_1)];
                    case 2:
                        _c.sent();
                        _c.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4:
                        wake = function () { return resolve === null || resolve === void 0 ? void 0 : resolve(); };
                        unsubscribe = executor.getStore().subscribe(runId, function (event) { void send(event).then(wake); });
                        _c.label = 5;
                    case 5:
                        _c.trys.push([5, , 9, 10]);
                        _c.label = 6;
                    case 6:
                        if (!!stream.aborted) return [3 /*break*/, 8];
                        return [4 /*yield*/, new Promise(function (done) { resolve = done; })];
                    case 7:
                        _c.sent();
                        resolve = undefined;
                        status_1 = (_b = executor.getStore().get(runId)) === null || _b === void 0 ? void 0 : _b.run.status;
                        if (status_1 === "completed" || status_1 === "failed" || status_1 === "cancelled")
                            return [3 /*break*/, 8];
                        return [3 /*break*/, 6];
                    case 8: return [3 /*break*/, 10];
                    case 9:
                        unsubscribe();
                        return [7 /*endfinally*/];
                    case 10: return [2 /*return*/];
                }
            });
        }); });
    });
    return { app: app, executor: executor };
}
//# sourceMappingURL=runs.js.map