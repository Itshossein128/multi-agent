const DEFAULT_AGENT_TIMEOUT_MS = 1_200_000;

/** Use one bounded duration for the agent abort signal and its CLI worker. */
export function configuredAgentTimeout(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const value = Number(env.AGENT_MAX_DURATION_MS ?? DEFAULT_AGENT_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 1_000 && value <= 60 * 60_000
    ? value
    : DEFAULT_AGENT_TIMEOUT_MS;
}
