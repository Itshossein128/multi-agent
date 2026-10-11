export type WorkflowRunInputMode = "text" | "json";

/** Text mode retains the legacy carrier; JSON mode preserves named inputs. */
export function parseWorkflowRunInput(value: string, mode: WorkflowRunInputMode): Record<string, unknown> {
  if (mode === "text") return { input: value };
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("Run input must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Run input must be a JSON object with named fields.");
  }
  return parsed as Record<string, unknown>;
}
