import type { Run, RunEvent } from "@multi-agent/types";
import type { ThinkingAttemptView, ThinkingOutcome, ThinkingSegment } from "../components/workflow/live/liveCanvas.types";

type ThinkingStatus = "shared" | "none";

interface AttemptAcc {
  attempt: number;
  outcome: ThinkingOutcome;
  segments: Array<ThinkingSegment & { callId?: string }>;
  sawStatus: boolean;
  status?: ThinkingStatus;
  finalNone: boolean;
  recordIncomplete: boolean;
  fresh: boolean;
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

function textOf(attempt: AttemptAcc): string {
  return attempt.segments.filter((segment): segment is { kind: "thinking"; text: string } => segment.kind === "thinking").map((segment) => segment.text).join("");
}

function appendThinking(attempt: AttemptAcc, value: string, mode: "append" | "replace") {
  if (mode === "replace") {
    attempt.segments = attempt.segments.filter((segment) => segment.kind !== "tool");
    if (value) attempt.segments.push({ kind: "thinking", text: value });
    return;
  }
  if (!value) return;
  const last = attempt.segments[attempt.segments.length - 1];
  if (last?.kind === "thinking") last.text += value;
  else attempt.segments.push({ kind: "thinking", text: value });
}

function availability(attempt: AttemptAcc): ThinkingAttemptView["availability"] {
  const text = textOf(attempt);
  if (!blank(text)) return "shared";
  const ended = attempt.outcome !== "in_progress";
  if (attempt.status === "none" || attempt.finalNone || attempt.status === "shared") return "none";
  if (!ended) return "pending";
  if (!attempt.sawStatus) return "unavailable";
  return "unavailable";
}

function asStatus(value: unknown): ThinkingStatus | undefined {
  return value === "shared" || value === "none" ? value : undefined;
}

function integerAttempt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** Group thinking logs, legacy thoughts, and tool markers into per-attempt transcripts. */
export function projectThinkingAttempts(events: readonly RunEvent[], runStatus: Run["status"] | undefined, recordIncomplete: boolean): ThinkingAttemptView[] {
  const attempts: AttemptAcc[] = [];
  const ensure = (): AttemptAcc => {
    const current = attempts[attempts.length - 1];
    if (current) return current;
    const created: AttemptAcc = { attempt: 1, outcome: "in_progress", segments: [], sawStatus: false, finalNone: false, recordIncomplete: false, fresh: false };
    attempts.push(created);
    return created;
  };
  const open = (attempt: number, fresh: boolean) => {
    const last = attempts[attempts.length - 1];
    if (last?.fresh && last.outcome === "in_progress" && last.segments.length === 0 && !last.sawStatus) {
      last.attempt = attempt;
      last.fresh = false;
      return;
    }
    attempts.push({ attempt, outcome: "in_progress", segments: [], sawStatus: false, finalNone: false, recordIncomplete: false, fresh });
  };

  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "node.started") {
      const explicit = integerAttempt(payload.attempt);
      const last = attempts[attempts.length - 1];
      if (last?.fresh && last.outcome === "in_progress" && last.segments.length === 0 && !last.sawStatus) {
        if (explicit) last.attempt = explicit;
        last.fresh = false;
      } else open(explicit ?? (last ? last.attempt + 1 : 1), false);
    } else if (event.type === "node.retrying") {
      const last = attempts[attempts.length - 1];
      if (last && last.outcome === "in_progress") last.outcome = "failed";
      const next = integerAttempt(payload.nextAttempt) ?? (last ? last.attempt + 1 : 1);
      open(next, true);
    }
    if (event.type === "node.completed") {
      const current = attempts[attempts.length - 1];
      if (current && current.outcome === "in_progress") current.outcome = "completed";
    }
    if (event.type === "node.failed") {
      const current = ensure();
      if (current.outcome === "in_progress") current.outcome = "failed";
    }
    if (event.type === "agent.failed") {
      const current = ensure();
      if (current.outcome === "in_progress") current.outcome = "failed";
    }
    if (event.type.startsWith("tool.")) {
      const current = ensure();
      const callId = typeof payload.toolCallId === "string" ? payload.toolCallId : typeof payload.callId === "string" ? payload.callId : event.id;
      const label = typeof payload.name === "string" ? payload.name : typeof payload.toolId === "string" ? payload.toolId : event.toolId ?? "tool";
      if (event.type === "tool.started") {
        current.segments.push({ kind: "tool", label, status: "running", callId });
      } else {
        const match = [...current.segments].reverse().find((segment) => segment.kind === "tool" && segment.callId === callId);
        if (match && match.kind === "tool") match.status = event.type === "tool.completed" ? "completed" : "failed";
      }
    }
    if (payload.truncated === true && event.type === "log") {
      const current = ensure();
      current.recordIncomplete = true;
    }
    if (event.type === "log" || event.type.startsWith("agent.") || event.type.startsWith("llm.")) {
      const channel = payload.channel === "thinking";
      const status = asStatus(payload.thinkingStatus);
      const raw = channel ? payload.thoughts : payload.thoughts ?? payload.reasoning;
      if (channel && status) {
        const current = ensure();
        current.sawStatus = true;
        current.status = status;
        if (status === "none") current.finalNone = true;
      }
      if (typeof raw !== "string") continue;
      if (channel && payload.final === true && raw && textOf(ensure()).endsWith(raw)) continue;
      const current = ensure();
      const mode = !channel && event.type.endsWith("completed") ? "replace" : "append";
      if (!blank(raw)) appendThinking(current, raw, mode);
      else if (!channel && event.type.endsWith("completed") && (payload.thoughts !== undefined || payload.reasoning !== undefined)) appendThinking(current, "", "replace");
    }
  }

  if (runStatus === "cancelled") {
    const last = attempts[attempts.length - 1];
    if (last && last.outcome !== "completed") last.outcome = "stopped";
  } else if (runStatus === "failed") {
    const last = attempts[attempts.length - 1];
    if (last && last.outcome === "in_progress") last.outcome = "failed";
  } else if (runStatus === "completed") {
    const last = attempts[attempts.length - 1];
    if (last && last.outcome === "in_progress") last.outcome = "completed";
  }

  return attempts.map((attempt) => {
    const text = textOf(attempt);
    const visible = blank(text) ? "" : text;
    return {
      attempt: attempt.attempt,
      outcome: attempt.outcome,
      availability: availability(attempt),
      text: visible,
      segments: attempt.segments.map((segment) => segment.kind === "thinking" ? { kind: "thinking", text: segment.text } : { kind: "tool", label: segment.label, status: segment.status }),
      recordIncomplete: attempt.recordIncomplete || recordIncomplete,
    };
  });
}
