"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunStore = void 0;
const langGraphEventAdapter_1 = require("../adapters/langGraphEventAdapter");
class RunStore {
    entries = new Map();
    create(run, memoryOwner) { this.entries.set(run.id, { run, events: [], listeners: new Set(), abort: new AbortController(), memoryOwner: memoryOwner ? { principalId: memoryOwner.principalId, tenantId: memoryOwner.tenantId } : undefined }); return run; }
    getMemoryOwner(runId) { const owner = this.entries.get(runId)?.memoryOwner; return owner ? { ...owner } : undefined; }
    get(runId) { return this.entries.get(runId); }
    list(agentId) {
        return [...this.entries.values()]
            .filter((entry) => !agentId || entry.events.some((event) => event.agentId === agentId))
            .map((entry) => entry.run)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }
    append(runId, event) {
        const entry = this.entries.get(runId);
        if (!entry)
            return;
        const next = { ...event, payload: (0, langGraphEventAdapter_1.redact)(event.payload), sequence: entry.events.length + 1 };
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