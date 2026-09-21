import type { MemoryCandidate, MemoryWriteDecision, MemoryWritePolicy } from "../contracts";

// Shared content guards. Long-term memory and run-scoped working memory must
// agree on what counts as a secret or as non-informative chatter, otherwise one
// layer would accept content the other rejects.
const SECRET_ASSIGNMENT = /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|client[_ -]?secret)\s+(?:is|equals)\s+\S+/i;
const SECRET_PATTERN = /\b(password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key)\b\s*["']?\s*[:=]|-----BEGIN [\w ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sk|ghp|github_pat)[_-][a-zA-Z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b/i;
const TRIVIAL_PATTERN = /^(?:ok(?:ay)?|thanks?(?: you)?|hello|hi|done|success|test|acknowledged|sounds good|task completed)[\s!.]*$/i;

/** "password is hunter2" phrasing, which only matches on the content itself. */
export function containsSecretAssignment(value: string): boolean {
  return SECRET_ASSIGNMENT.test(value);
}

/** Credential-shaped text (key/value pairs, bearer tokens, provider key prefixes). */
export function containsSensitiveContent(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** Blank, letterless, or pure acknowledgement text carries no reusable knowledge. */
export function isTrivialContent(content: string, minLength = 12): boolean {
  return content.length < minLength || !/[\p{L}]/u.test(content) || TRIVIAL_PATTERN.test(content);
}

export class DefaultMemoryWritePolicy implements MemoryWritePolicy {
  async shouldRemember(candidate: MemoryCandidate): Promise<MemoryWriteDecision> {
    if (candidate.explicit !== true) return { remember: false, reason: "not_explicit" };
    const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
    let serialized: string;
    try { serialized = JSON.stringify(candidate); } catch { return { remember: false, reason: "invalid_candidate" }; }
    if (serialized.length > 64000) return { remember: false, reason: "too_large" };
    if (containsSecretAssignment(content) || containsSensitiveContent(serialized)) return { remember: false, reason: "secret" };
    if (isTrivialContent(content)) return { remember: false, reason: "trivial" };
    if (content.length > 16000) return { remember: false, reason: "too_large" };
    return { remember: true, importance: candidate.importance ?? .5, reason: "durable_candidate" };
  }
}
