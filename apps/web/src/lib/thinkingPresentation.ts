export const THINKING_FOLLOW_THRESHOLD_PX = 48;

export const THINKING_COPY = {
  pending: "Agent is working — this backend has not streamed live reasoning.",
  none: "Completed without streaming reasoning notes.",
  unavailable: "No reasoning notes were recorded for this step.",
  incomplete: "The run record stopped before the rest of this thinking was saved.",
} as const;

export function shouldFollowThinkingTail(distanceFromBottomPx: number, threshold = THINKING_FOLLOW_THRESHOLD_PX): boolean {
  return distanceFromBottomPx <= threshold;
}
