"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultMemoryExtractor = exports.DeterministicMemoryExtractor = void 0;
const access_1 = require("./access");
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
/** Only an explicit candidate channel or an anchored user request promotes data. Events/output prose are never mined. */
class DeterministicMemoryExtractor {
    async extract(input) {
        const candidates = [];
        const source = { type: "agent", agentId: input.agentId, workflowId: input.workflowId, runId: input.runId, nodeId: input.nodeId };
        const raw = record(input.output)?.memoryCandidates;
        if (Array.isArray(raw))
            for (const value of raw.slice(0, 20)) {
                const item = record(value);
                if (!item || typeof item.content !== "string" || !item.content.trim() || item.content.length > 16000)
                    continue;
                const kind = item.kind ?? "semantic";
                if (kind !== "semantic" && kind !== "episodic" && kind !== "procedural")
                    continue;
                const candidate = { namespace: { ...input.namespace }, kind, content: item.content.trim(), source, explicit: true };
                for (const key of ["subject", "situation", "action", "result", "lesson", "title", "procedure", "trigger"])
                    if (typeof item[key] === "string")
                        candidate[key] = item[key];
                if (typeof item.success === "boolean")
                    candidate.success = item.success;
                if (record(item.structuredData))
                    candidate.structuredData = structuredClone(item.structuredData);
                for (const key of ["importance", "confidence"])
                    if (typeof item[key] === "number" && Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= 1)
                        candidate[key] = item[key];
                candidates.push(candidate);
            }
        const envelope = record(input.input);
        const userInput = typeof input.input === "string" ? input.input : [envelope?.input, envelope?.message, envelope?.content, envelope?.prompt].find(value => typeof value === "string");
        if (typeof userInput === "string") {
            const match = userInput.match(/^\s*(?:please\s+)?remember(?:\s+that\b|\s*:)?\s+([\s\S]+)$/i);
            if (match && match[1].length <= 16000)
                candidates.unshift({ namespace: { ...input.namespace }, kind: "semantic", content: match[1].trim(), source: { ...source, type: "user" }, explicit: true });
        }
        const seen = new Set();
        return candidates.filter(candidate => {
            const hash = (0, access_1.contentHash)(candidate.content);
            if (seen.has(hash))
                return false;
            seen.add(hash);
            candidate.idempotencyKey = (0, access_1.contentHash)(JSON.stringify([input.runId, input.nodeId, candidate.kind, hash]));
            return true;
        });
    }
}
exports.DeterministicMemoryExtractor = DeterministicMemoryExtractor;
exports.DefaultMemoryExtractor = DeterministicMemoryExtractor;
//# sourceMappingURL=memoryExtractor.js.map