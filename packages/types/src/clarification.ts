/**
 * Shared clarification package shapes for run/task read + submit APIs.
 * Validation helpers live on the server; this module is the contract surface.
 */

import type { ClarificationAnswer, ClarificationQuestion } from "./nodeContract";

export type ClarificationPackageStatus =
  | "pending"
  | "answered"
  | "unavailable"
  | "resumed"
  | "follow_up_started";

export type ClarificationContinuation = "resume" | "follow_up" | "none";

export type ClarificationExtraction =
  | "structured"
  | "legacy_deterministic"
  | "unavailable";

export interface ClarificationPackage {
  status: ClarificationPackageStatus;
  runId: string;
  taskId?: string | null;
  nodeId?: string | null;
  approvalId?: string | null;
  reason?: string | null;
  questions: ClarificationQuestion[];
  missingFields?: string[];
  answers?: ClarificationAnswer[];
  canSubmit: boolean;
  continuation: ClarificationContinuation;
  parentRunId?: string | null;
  extraction: ClarificationExtraction;
  updatedAt?: string | null;
}

export interface ClarificationSubmitRequest {
  answers: Array<{ questionId: string; value: string }>;
}

export interface ClarificationSubmitResponse {
  ok: boolean;
  package: ClarificationPackage;
  followUpRunId?: string | null;
  idempotentReplay?: boolean;
  errorVisible?: boolean;
}

export const CLARIFICATION_QUESTION_ID_MAX = 64;
export const CLARIFICATION_PROMPT_MAX = 2000;
export const CLARIFICATION_MISSING_FIELD_MAX = 128;
export const CLARIFICATION_QUESTIONS_MAX = 20;
export const CLARIFICATION_MISSING_FIELDS_MAX = 32;
export const CLARIFICATION_ANSWER_VALUE_MAX = 4000;
