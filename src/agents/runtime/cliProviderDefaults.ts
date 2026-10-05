/**
 * Single source of truth for the bare command each CLI provider resolves to
 * when the agent does not set an explicit `backend.executable`. The execution
 * policy and the CLI executor must agree on this mapping, so both import it
 * from here instead of re-encoding provider names.
 */
export function defaultCliExecutable(provider: string): string {
  if (provider === "claude-code") return "claude";
  if (provider === "cursor") return "agent";
  return provider;
}
