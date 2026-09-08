"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunStore = void 0;
class RunStore {
    entries = new Map();
    create(run) { this.entries.set(run.id, { run, events: [], listeners: new Set(), abort: new AbortController() }); return run; }
    get(runId) { return this.entries.get(runId); }
    append(runId, event) {
        const entry = this.entries.get(runId);
        if (!entry)
            return;
        const next = { ...event, sequence: entry.events.length + 1 };
        entry.events.push(next);
        entry.listeners.forEach((listener) => listener(next));
        return next;
    }
    update(runId, patch) { const entry = this.entries.get(runId); if (entry)
        entry.run = { ...entry.run, ...patch }; return entry?.run; }
    events(runId, after = 0) { return this.entries.get(runId)?.events.filter((event) => event.sequence > after) ?? []; }
    subscribe(runId, listener) { const entry = this.entries.get(runId); if (!entry)
        return () => undefined; entry.listeners.add(listener); return () => entry.listeners.delete(listener); }
    cancel(runId) { const entry = this.entries.get(runId); if (!entry)
        return false; entry.abort.abort(); return true; }
    signal(runId) { return this.entries.get(runId)?.abort.signal; }
}
exports.RunStore = RunStore;
//# sourceMappingURL=runStore.js.map