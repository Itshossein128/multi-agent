import { createHash } from "node:crypto";
import {
  CLARIFICATION_ANSWER_VALUE_MAX,
  CLARIFICATION_QUESTIONS_MAX,
  type ApprovalRequest,
  type ClarificationAnswer,
  type ClarificationAnswerInput,
  type ClarificationPackage,
  type ClarificationQuestion,
  type NeedsHumanInfo,
  type NodeResultEnvelope,
  type Run,
} from "@multi-agent/types";
import { ApiError } from "./shared/http";

const SECRETISH = /(?:api[_-]?key|secret|token|password|bearer\s+[a-z0-9._\-]+|sk-[a-z0-9]{10,})/i;

/** Known legacy free-text patterns that keep tasks out of Done and may yield extractable questions. */
export const LEGACY_CLARIFICATION_OUTPUT =
  /(?:clarification\s+required|intake\s+remains\s+in\s+clarification)/i;

export function isClarificationNeedsHuman(needsHuman: NeedsHumanInfo | undefined): boolean {
  if (!needsHuman) return false;
  if (needsHuman.purpose === "clarification") return true;
  if (needsHuman.purpose === "approval") return false;
  return Boolean(needsHuman.questions && needsHuman.questions.length > 0);
}

export function questionsFromNeedsHuman(needsHuman: NeedsHumanInfo | undefined): ClarificationQuestion[] {
  if (!needsHuman?.questions?.length) return [];
  return needsHuman.questions.slice(0, CLARIFICATION_QUESTIONS_MAX);
}

/**
 * Deterministic legacy extraction. Older agents emit clarification as either
 * discrete numbered/bullet requirements (often without question marks) or as
 * one prose paragraph. Preserve both shapes so the operator always has a
 * bounded answer target instead of an unavailable form.
 */
export function extractLegacyClarificationQuestions(output: unknown): ClarificationQuestion[] {
  let text = "";
  if (typeof output === "string") {
    text = output;
  } else if (output && typeof output === "object" && !Array.isArray(output) && typeof (output as { content?: unknown }).content === "string") {
    text = (output as { content: string }).content;
  } else {
    try {
      text = JSON.stringify(output ?? "");
    } catch {
      text = String(output ?? "");
    }
  }
  if (!text || !LEGACY_CLARIFICATION_OUTPUT.test(text)) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const questions: ClarificationQuestion[] = [];
  for (const line of lines) {
    const numbered = /^(?:\d+\s*[\).\:]|[-*•])\s+(.+?)\s*$/.exec(line);
    const prompt = numbered?.[1]?.trim() ?? (/\?\s*$/.test(line) && !LEGACY_CLARIFICATION_OUTPUT.test(line) ? line : undefined);
    if (!prompt || prompt.length > 2000) continue;
    if (/^please\s+provide\s*:?$/i.test(prompt)) continue;
    const id = `legacy-q${questions.length + 1}`;
    questions.push({ id, prompt: prompt.slice(0, 2000), required: true });
    if (questions.length >= CLARIFICATION_QUESTIONS_MAX) break;
  }

  if (questions.length > 0) return questions;

  // Some agents return one paragraph instead of discrete questions. Remove
  // the known preamble and generic lead-in; the remaining bounded text is the
  // context for one free-form clarification answer.
  const context = lines
    .map((line) => line
      .replace(/^status:\s*/i, "")
      .replace(/clarification\s+required(?:\s+before\s+implementation(?:\s+can\s+be\s+assigned)?)?/gi, "")
      .replace(/intake\s+remains\s+in\s+clarification/gi, "")
      .trim())
    .filter((line) => !/^please\s+provide\s*:?$/i.test(line))
    .join(" ")
    .trim();
  if (context.length >= 12) {
    return [{
      id: "legacy-q1",
      prompt: `Please provide the clarification details requested in this output:\n\n${context.slice(0, 1900)}`,
      required: true,
    }];
  }

  return questions;
}

export function redactClarificationValue(value: string): string {
  if (!SECRETISH.test(value)) return value.slice(0, CLARIFICATION_ANSWER_VALUE_MAX);
  return value.replace(SECRETISH, "[REDACTED]").slice(0, CLARIFICATION_ANSWER_VALUE_MAX);
}

export function canonicalizeAnswers(answers: ClarificationAnswerInput[]): Array<{ questionId: string; value: string }> {
  return [...answers]
    .map((a) => ({
      questionId: String(a.questionId ?? "").trim(),
      value: redactClarificationValue(String(a.value ?? "").trim()),
    }))
    .filter((a) => a.questionId)
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
}

export function fingerprintAnswers(answers: ClarificationAnswerInput[]): string {
  const canonical = canonicalizeAnswers(answers);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function validateClarificationAnswers(
  questions: ClarificationQuestion[],
  answers: unknown,
): ClarificationAnswerInput[] {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new ApiError(400, "answers must be a non-empty array");
  }
  if (answers.length > CLARIFICATION_QUESTIONS_MAX) {
    throw new ApiError(400, `answers must contain at most ${CLARIFICATION_QUESTIONS_MAX} items`);
  }

  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const normalized: ClarificationAnswerInput[] = [];

  for (const raw of answers) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ApiError(400, "each answer must be an object with questionId and value");
    }
    const questionId = typeof (raw as { questionId?: unknown }).questionId === "string"
      ? (raw as { questionId: string }).questionId.trim()
      : "";
    const valueRaw = (raw as { value?: unknown }).value;
    const value = typeof valueRaw === "string" ? valueRaw.trim() : "";
    if (!questionId || !byId.has(questionId)) {
      throw new ApiError(400, `Unknown or missing questionId "${questionId}"`);
    }
    if (seen.has(questionId)) {
      throw new ApiError(400, `Duplicate answer for questionId "${questionId}"`);
    }
    seen.add(questionId);
    const question = byId.get(questionId)!;
    const required = question.required !== false;
    if (required && !value) {
      throw new ApiError(400, `Answer for "${questionId}" must be a non-empty string`);
    }
    if (value.length > CLARIFICATION_ANSWER_VALUE_MAX) {
      throw new ApiError(400, `Answer for "${questionId}" exceeds ${CLARIFICATION_ANSWER_VALUE_MAX} characters`);
    }
    normalized.push({ questionId, value: redactClarificationValue(value) });
  }

  for (const question of questions) {
    if (question.required === false) continue;
    if (!seen.has(question.id)) {
      throw new ApiError(400, `Missing required answer for questionId "${question.id}"`);
    }
  }

  return normalized;
}

export function serializeOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output ?? "");
  } catch {
    return String(output ?? "");
  }
}

export interface BuildClarificationPackageInput {
  run: Run;
  approvals: ApprovalRequest[];
  taskId?: string | null;
  actorId?: string;
}

/**
 * Build the operator-facing clarification package from run result, approvals, and legacy output.
 */
export function buildClarificationPackage(input: BuildClarificationPackageInput): ClarificationPackage {
  const { run, approvals, taskId } = input;
  const result = run.result as NodeResultEnvelope | undefined;
  const needsHuman = result?.needsHuman;
  const pending = approvals.find((a) => a.status === "requested");
  const resolvedClarification = [...approvals].reverse().find((a) => {
    const meta = a.metadata as { clarificationAnswers?: ClarificationAnswer[]; answerFingerprint?: string } | undefined;
    return Boolean(meta?.clarificationAnswers?.length || meta?.answerFingerprint);
  });

  const structuredQuestions = questionsFromNeedsHuman(needsHuman);
  let questions = structuredQuestions;
  // Default to structured provenance with empty questions (ordinary blocked/approval waits).
  // Only use "unavailable" when a legacy clarification pattern matched but questions could not be extracted.
  let extraction: ClarificationPackage["extraction"] = "structured";
  if (structuredQuestions.length) {
    extraction = "structured";
  }

  if (!structuredQuestions.length && run.status === "completed") {
    const legacy = extractLegacyClarificationQuestions(run.output ?? result?.value);
    if (legacy.length) {
      questions = legacy;
      extraction = "legacy_deterministic";
    } else if (LEGACY_CLARIFICATION_OUTPUT.test(serializeOutputText(run.output ?? result?.value))) {
      extraction = "unavailable";
      questions = [];
    }
  }

  // Prefer questions persisted on pending approval context envelope.
  if (!questions.length && pending?.context && typeof pending.context === "object") {
    const envelope = (pending.context as { envelope?: NodeResultEnvelope }).envelope;
    const fromCtx = questionsFromNeedsHuman(envelope?.needsHuman);
    if (fromCtx.length) {
      questions = fromCtx;
      extraction = "structured";
    }
  }

  const metaAnswers = (resolvedClarification?.metadata as { clarificationAnswers?: ClarificationAnswer[] } | undefined)
    ?.clarificationAnswers;
  const answers = metaAnswers?.length
    ? metaAnswers
    : undefined;

  const waiting = run.status === "waiting_for_human" && Boolean(pending);
  const legacyFollowUp =
    run.status === "completed"
    && extraction !== "unavailable"
    && questions.length > 0
    && !waiting;

  let status: ClarificationPackage["status"] = "unavailable";
  if (waiting && questions.length) status = "pending";
  else if (legacyFollowUp) status = "pending";
  else if (answers?.length && run.status === "running") status = "resumed";
  else if (answers?.length && run.status === "completed" && (run.metadata as { clarificationOfRunId?: string })?.clarificationOfRunId) {
    status = "follow_up_started";
  } else if (answers?.length) status = "answered";
  else if (!questions.length) status = "unavailable";

  const canSubmit =
    (waiting && questions.length > 0 && Boolean(pending))
    || (legacyFollowUp && questions.length > 0);

  const continuation: ClarificationPackage["continuation"] = waiting
    ? "resume"
    : legacyFollowUp
      ? "follow_up"
      : "none";

  const parentRunId =
    typeof (run.metadata as { parentRunId?: unknown })?.parentRunId === "string"
      ? String((run.metadata as { parentRunId: string }).parentRunId)
      : typeof (run.metadata as { clarificationOfRunId?: unknown })?.clarificationOfRunId === "string"
        ? String((run.metadata as { clarificationOfRunId: string }).clarificationOfRunId)
        : null;

  return {
    status,
    runId: run.id,
    taskId: taskId ?? run.taskId ?? null,
    nodeId: pending?.nodeId ?? resolvedClarification?.nodeId ?? run.currentNodeId ?? null,
    approvalId: pending?.id ?? resolvedClarification?.id ?? null,
    reason: needsHuman?.reason ?? pending?.message ?? null,
    questions,
    ...(needsHuman?.missingFields?.length ? { missingFields: needsHuman.missingFields } : {}),
    ...(answers?.length ? { answers } : {}),
    canSubmit,
    continuation,
    parentRunId,
    extraction,
    updatedAt: resolvedClarification?.resolvedAt ?? pending?.requestedAt ?? run.completedAt ?? run.startedAt ?? null,
  };
}
