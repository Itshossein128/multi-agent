"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.historyKey = historyKey;
exports.boundedInteger = boundedInteger;
exports.boundText = boundText;
exports.boundHistory = boundHistory;
exports.mergeHistories = mergeHistories;
function historyKey(input) {
    return JSON.stringify([input.runId, input.agent.id, input.agent.memory?.scope === "node" ? input.nodeId : "agent"]);
}
function boundedInteger(value, fallback, max) {
    return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
}
/** UTF-8 bytes are a conservative token upper bound, independent of model tokenizer. */
function boundText(text, budget) {
    return Buffer.from(text).subarray(0, budget).toString("utf8").replace(/\uFFFD$/, "");
}
function boundHistory(history) {
    const maxEntries = boundedInteger(history.maxEntries, 20, 100);
    const maxTokens = boundedInteger(history.maxTokens, 4096, 16384);
    if (!maxEntries || !maxTokens)
        return { entries: [], maxEntries, maxTokens };
    let size = 2;
    const entries = [];
    for (const entry of history.entries.slice(-maxEntries).reverse()) {
        const cost = Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (size + cost > maxTokens || entries.length >= maxEntries)
            break;
        entries.unshift(entry);
        size += cost;
    }
    return { entries, maxEntries, maxTokens };
}
/** Updates contain only new entries: parallel branches sharing an agent cannot overwrite each other. */
function mergeHistories(current, update) {
    const result = { ...current };
    for (const [key, next] of Object.entries(update)) {
        const entries = new Map((current[key]?.entries ?? []).map(entry => [entry.id, entry]));
        for (const entry of next.entries)
            entries.set(entry.id, entry);
        result[key] = boundHistory({ ...next, entries: [...entries.values()] });
    }
    return result;
}
//# sourceMappingURL=shortTermMemory.js.map