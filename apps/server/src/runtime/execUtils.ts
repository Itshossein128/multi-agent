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
 * Extract a JSON object that carries branch/branchKey from free-form agent text.
 */
export function coerceBranchCarrier(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return value;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
    const record = parsed as { branch?: unknown; branchKey?: unknown; verdict?: unknown; status?: unknown };
    if (typeof record.branch === "string" || typeof record.branchKey === "string") return parsed;
    if (typeof record.verdict === "string") {
      const verdict = record.verdict.toLowerCase();
      if (verdict === "approve" || verdict === "approved") return { ...record, branch: "approved" };
      if (verdict === "reject" || verdict === "rejected") return { ...record, branch: "rejected" };
    }
    if (typeof record.status === "string") return parsed;
    return value;
  } catch {
    return value;
  }
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
