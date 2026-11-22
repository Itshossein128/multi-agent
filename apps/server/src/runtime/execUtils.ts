import type { NodeRetryPolicy } from "@multi-agent/types";

export function abortError(): Error {
  const error = new Error("Execution cancelled");
  error.name = "AbortError";
  return error;
}

export function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, delayMs);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function combineSignals(parent?: AbortSignal, branch?: AbortSignal): AbortSignal | undefined {
  if (parent && branch) return AbortSignal.any([parent, branch]);
  return parent ?? branch;
}

export function retryDelay(policy: Required<NodeRetryPolicy>, failedAttempt: number, maximum: number): number {
  return Math.min(maximum, Math.round(policy.backoffMs * policy.backoffMultiplier ** (failedAttempt - 1)));
}

export function isGraphInterrupt(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  return name === "GraphInterrupt" || name === "GraphBubbleUp" || String(error).includes("GraphInterrupt");
}

export function asToolInput(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value }; }

/**
 * Extract a JSON object that carries routing/branch fields from free-form agent text.
 * Supports raw JSON objects as well as Markdown fenced ```json ... ``` blocks.
 */
export function coerceBranchCarrier(value: unknown, valueField?: string): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();

  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    const inner = match[1]?.trim();
    if (inner && inner.startsWith("{") && inner.endsWith("}")) {
      candidates.unshift(inner);
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      if (valueField && typeof record[valueField] === "string") return parsed;
      if (typeof record.branch === "string" || typeof record.branchKey === "string") return parsed;
      if (typeof record.next === "string" || typeof record.nextAction === "string") return parsed;
      if (typeof record.convergeStatus === "string" || typeof record.qaStatus === "string") return parsed;
      if (typeof record.verdict === "string") {
        const verdict = record.verdict.toLowerCase();
        if (verdict === "approve" || verdict === "approved") return { ...record, branch: "approved" };
        if (verdict === "reject" || verdict === "rejected") return { ...record, branch: "rejected" };
      }
      if (typeof record.status === "string") return parsed;
    } catch {
      /* try next candidate */
    }
  }
  return value;
}

export function branchValue(value: Record<string, unknown>, field?: string): string | undefined {
  const raw = field ? value[field] : value.branch ?? value.branchKey ?? value.verdict ?? value.status;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "passed" || normalized === "success" || normalized === "successful") return "pass";
  if (normalized === "failed" || normalized === "error" || normalized === "blocked") return "fail";
  if (normalized === "approve") return "approved";
  if (normalized === "reject") return "rejected";
  return normalized;
}

function normalizeCliClarificationQuestions(rawQuestions: unknown): Array<{
  id: string;
  prompt: string;
  required?: boolean;
  missingField?: string;
}> {
  if (!Array.isArray(rawQuestions)) return [];
  const questions: Array<{ id: string; prompt: string; required?: boolean; missingField?: string }> = [];
  for (let i = 0; i < rawQuestions.length && questions.length < 20; i++) {
    const item = rawQuestions[i];
    if (typeof item === "string" && item.trim()) {
      questions.push({ id: `Q${i + 1}`, prompt: item.trim().slice(0, 2000), required: true });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const rawPrompt =
      typeof obj.prompt === "string" && obj.prompt.trim()
        ? obj.prompt.trim()
        : typeof obj.question === "string" && obj.question.trim()
          ? obj.question.trim()
          : typeof obj.text === "string" && obj.text.trim()
            ? obj.text.trim()
            : "";
    if (!rawPrompt) continue;
    let prompt = rawPrompt;
    if (obj.options && typeof obj.options === "object" && !Array.isArray(obj.options)) {
      const optionLines = Object.entries(obj.options as Record<string, unknown>)
        .map(([k, v]) => `  - ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n");
      if (optionLines) prompt = `${prompt}\nOptions:\n${optionLines}`;
    }
    const id =
      typeof obj.id === "string" && obj.id.trim()
        ? obj.id.trim().slice(0, 64)
        : `Q${questions.length + 1}`;
    const missingField =
      typeof obj.missingField === "string" && obj.missingField.trim()
        ? obj.missingField.trim().slice(0, 128)
        : typeof obj.requirement_id === "string" && obj.requirement_id.trim()
          ? obj.requirement_id.trim().slice(0, 128)
          : undefined;
    questions.push({
      id,
      prompt: prompt.slice(0, 2000),
      required: typeof obj.required === "boolean" ? obj.required : true,
      ...(missingField ? { missingField } : {}),
    });
  }
  return questions;
}

/**
 * Extract a structured NodeResultEnvelope (especially `needs_human` or `blocked`)
 * from CLI agent string outputs that wrap JSON inside Markdown prose/code fences.
 * Non-string values are returned untouched to preserve strict object envelope checks.
 */
export function extractStructuredResultEnvelope(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    const inner = match[1]?.trim();
    if (inner && inner.startsWith("{") && inner.endsWith("}")) {
      candidates.unshift(inner);
    }
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const status = typeof record.status === "string" ? record.status.trim() : "";

    if (status === "needs_human") {
      if (record.needsHuman && typeof record.needsHuman === "object" && !Array.isArray(record.needsHuman)) {
        return { ...record, ...(record.value === undefined ? { value } : {}) };
      }
      const questions = normalizeCliClarificationQuestions(record.questions);
      const reasonSource =
        record.reason ??
        record.required_input ??
        record.requiredInput ??
        record.notes ??
        record.message ??
        record.summary;
      const reason =
        typeof reasonSource === "string" && reasonSource.trim()
          ? reasonSource.trim().slice(0, 2000)
          : "Agent requested human clarification or decision before proceeding.";
      const purpose =
        record.purpose === "approval" || record.purpose === "clarification"
          ? record.purpose
          : questions.length > 0
            ? "clarification"
            : "approval";
      return {
        contractVersion: 1,
        status: "needs_human",
        value,
        needsHuman: {
          reason,
          purpose,
          ...(questions.length > 0 ? { questions } : {}),
        },
      };
    }

    if (
      status === "blocked" &&
      (record.error !== undefined ||
        typeof record.reason === "string" ||
        typeof record.required_input === "string" ||
        typeof record.blocked_stage === "string")
    ) {
      if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
        return { ...record, ...(record.value === undefined ? { value } : {}) };
      }
      const msgSource =
        record.reason ??
        record.required_input ??
        record.notes ??
        record.message ??
        "Agent reported that execution is blocked.";
      return {
        contractVersion: 1,
        status: "blocked",
        value,
        error: {
          code: "AGENT_BLOCKED",
          message: typeof msgSource === "string" && msgSource.trim() ? msgSource.trim().slice(0, 500) : "Agent reported that execution is blocked.",
          retryable: false,
        },
      };
    }

    if (record.contractVersion !== undefined && status) {
      return record;
    }
  }

  return value;
}
