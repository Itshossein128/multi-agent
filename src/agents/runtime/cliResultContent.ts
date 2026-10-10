import { parseResultEnvelope } from "@multi-agent/types";

/** Decode a CLI's complete result envelope while preserving legacy text output.
 * Only a whole JSON document (optionally fenced) is accepted. We never search
 * prose for JSON, which could turn a quoted example into a control-flow result.
 * Codex may append its own memory-provenance citation after the final answer.
 */
export function normalizeCliResultContent(stdout: string): unknown {
  const content = stdout.trim().replace(/\s*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>\s*$/, "");
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(content);
  const candidate = fence ? fence[1] : content;
  try {
    const parsed: unknown = JSON.parse(candidate);
    // Forward malformed claimed envelopes too: the workflow contract must
    // reject them instead of silently wrapping them as successful text.
    return parseResultEnvelope(parsed).kind === "absent" ? stdout : parsed;
  } catch {
    return stdout;
  }
}
