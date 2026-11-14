export const THINKING_FOLLOW_THRESHOLD_PX = 48;

export const THINKING_COPY = {
  pending: "Thinking has not arrived yet.",
  none: "No thinking was shared.",
  unavailable: "Thinking is unavailable for this run.",
  incomplete: "The run record stopped before the rest of this thinking was saved.",
} as const;

export function shouldFollowThinkingTail(distanceFromBottomPx: number, threshold = THINKING_FOLLOW_THRESHOLD_PX): boolean {
  return distanceFromBottomPx <= threshold;
}
