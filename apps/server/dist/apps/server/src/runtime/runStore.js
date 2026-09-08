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
exports.RunStore = void 0;
var RunStore = /** @class */ (function () {
    function RunStore() {
        this.entries = new Map();
    }
    RunStore.prototype.create = function (run) { this.entries.set(run.id, { run: run, events: [], listeners: new Set(), abort: new AbortController() }); return run; };
    RunStore.prototype.get = function (runId) { return this.entries.get(runId); };
    RunStore.prototype.append = function (runId, event) {
        var entry = this.entries.get(runId);
        if (!entry)
            return;
        var next = __assign(__assign({}, event), { sequence: entry.events.length + 1 });
        entry.events.push(next);
        entry.listeners.forEach(function (listener) { return listener(next); });
        return next;
    };
    RunStore.prototype.update = function (runId, patch) { var entry = this.entries.get(runId); if (entry)
        entry.run = __assign(__assign({}, entry.run), patch); return entry === null || entry === void 0 ? void 0 : entry.run; };
    RunStore.prototype.events = function (runId, after) {
        var _a, _b;
        if (after === void 0) { after = 0; }
        return (_b = (_a = this.entries.get(runId)) === null || _a === void 0 ? void 0 : _a.events.filter(function (event) { return event.sequence > after; })) !== null && _b !== void 0 ? _b : [];
    };
    RunStore.prototype.subscribe = function (runId, listener) { var entry = this.entries.get(runId); if (!entry)
        return function () { return undefined; }; entry.listeners.add(listener); return function () { return entry.listeners.delete(listener); }; };
    RunStore.prototype.cancel = function (runId) { var entry = this.entries.get(runId); if (!entry)
        return false; entry.abort.abort(); return true; };
    RunStore.prototype.signal = function (runId) { var _a; return (_a = this.entries.get(runId)) === null || _a === void 0 ? void 0 : _a.abort.signal; };
    return RunStore;
}());
exports.RunStore = RunStore;
//# sourceMappingURL=runStore.js.map