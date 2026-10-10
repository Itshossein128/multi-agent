import { parseResultEnvelope } from "@multi-agent/types";
import { normalizeCliResultContent } from "../src/agents/runtime/cliResultContent";

describe("CLI result control flow", () => {
  test.each(["success", "blocked", "needs_human", "failed"])("decodes %s as a typed outcome", status => {
    const result = { contractVersion: 1, status, value: { featureComplete: false },
      ...(status === "needs_human" ? { needsHuman: { reason: "Missing scope" } } : {}),
      ...(["blocked", "failed"].includes(status) ? { error: { code: "CHECK_FAILED", message: "Verification failed" } } : {}) };
    expect(normalizeCliResultContent(JSON.stringify(result))).toEqual(result);
    expect(parseResultEnvelope(normalizeCliResultContent(JSON.stringify(result))).kind).toBe("valid");
  });

  test("handles a complete fenced envelope followed by Codex memory provenance", () => {
    const result = { contractVersion: 1, status: "blocked", error: { code: "INCOMPLETE", message: "Unverified browser" } };
    const stdout = "```json\n" + JSON.stringify(result) + "\n```\n\n<oai-mem-citation>\n<citation_entries>MEMORY.md:1-2</citation_entries>\n</oai-mem-citation>\n";
    expect(normalizeCliResultContent(stdout)).toEqual(result);
  });

  test("malformed claimed envelopes reach contract validation", () => {
    const result = { status: "blocked", error: "bad" };
    expect(parseResultEnvelope(normalizeCliResultContent(JSON.stringify(result))).kind).toBe("malformed");
  });

  test.each(["done", '{"status":"success","count":2}', '{"business":"data"}', "[1,2]", "42", 'Example: {"status":"blocked"}', '```json\n{"status":"blocked"}\n```\nUnrelated prose', '{"status":'])
  ("preserves legacy/non-envelope output exactly: %s", stdout => {
    expect(normalizeCliResultContent(stdout)).toBe(stdout);
  });
});
