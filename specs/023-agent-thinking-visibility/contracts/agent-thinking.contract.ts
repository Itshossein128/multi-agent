/**
 * Agent thinking visibility.
 *
 * Executors append `log` events with this payload. The web projection
 * (data-model.md) is the only reader. `agent.completed` `content` is not
 * this contract and must remain the answer alone.
 */

/** Max characters in one `thoughts` chunk before the executor splits it. */
export const THINKING_CHUNK_CHARS = 8_000;

export type ThinkingStatus = "shared" | "none";

/** Payload of a `log` event that carries thinking. */
export interface ThinkingLogPayload {
  channel: "thinking";
  /** One chunk. Empty only when `thinkingStatus` is `"none"`. */
  thoughts: string;
  thinkingStatus: ThinkingStatus;
  /** Last thinking log for this attempt. */
  final: boolean;
  /** 0-based chunk index within the attempt. */
  part: number;
}

/**
 * Optional mirror on `agent.completed`, `agent.output`, or `agent.failed`.
 * Does not contain the thinking text. Absent on runs recorded before this feature.
 */
export interface ThinkingStatusMarker {
  thinkingStatus: ThinkingStatus;
}

export type ThinkingAvailability = "pending" | "shared" | "none" | "unavailable";

export type ThinkingOutcome = "in_progress" | "completed" | "stopped" | "failed";

export type ThinkingSegment =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; label: string; status: string };

/** One attempt of one agent step. Projected, not stored. */
export interface ThinkingAttemptView {
  attempt: number;
  outcome: ThinkingOutcome;
  availability: ThinkingAvailability;
  /** Joined thinking text. Empty when availability is not `shared`. */
  text: string;
  segments: ThinkingSegment[];
  /** Store truncation or the run event limit cut the record short. */
  recordIncomplete: boolean;
}

/** Copy is fixed so tests can tell the empty states apart. */
export const THINKING_COPY = {
  pending: "Thinking has not arrived yet.",
  none: "No thinking was shared.",
  unavailable: "Thinking is unavailable for this run.",
  incomplete: "The run record stopped before the rest of this thinking was saved.",
} as const;

/**
 * Follow-the-latest threshold, in pixels from the bottom of the transcript.
 * At or below this distance, new text keeps the latest line in view.
 * Above it, the view stays where the reader scrolled.
 */
export const THINKING_FOLLOW_THRESHOLD_PX = 48;
