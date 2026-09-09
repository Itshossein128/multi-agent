"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultMemoryWritePolicy = void 0;
class DefaultMemoryWritePolicy {
    async shouldRemember(candidate) {
        if (candidate.explicit !== true)
            return { remember: false, reason: "not_explicit" };
        const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
        let serialized;
        try {
            serialized = JSON.stringify(candidate);
        }
        catch {
            return { remember: false, reason: "invalid_candidate" };
        }
        if (serialized.length > 64000)
            return { remember: false, reason: "too_large" };
        if (/\b(?:password|passwd|api[_ -]?key|access[_ -]?token|client[_ -]?secret)\s+(?:is|equals)\s+\S+/i.test(content))
            return { remember: false, reason: "secret" };
        if (/\b(password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key)\b\s*["']?\s*[:=]|-----BEGIN [\w ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sk|ghp|github_pat)[_-][a-zA-Z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b/i.test(serialized))
            return { remember: false, reason: "secret" };
        if (content.length < 12 || !/[\p{L}]/u.test(content) || /^(?:ok(?:ay)?|thanks?(?: you)?|hello|hi|done|success|test|acknowledged|sounds good|task completed)[\s!.]*$/i.test(content))
            return { remember: false, reason: "trivial" };
        if (content.length > 16000)
            return { remember: false, reason: "too_large" };
        return { remember: true, importance: candidate.importance ?? .5, reason: "durable_candidate" };
    }
}
exports.DefaultMemoryWritePolicy = DefaultMemoryWritePolicy;
//# sourceMappingURL=memoryWritePolicy.js.map