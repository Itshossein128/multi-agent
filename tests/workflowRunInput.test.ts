import { parseWorkflowRunInput } from "../apps/web/src/lib/workflowRunInput";

describe("workflow run input transport", () => {
  test("plain text and JSON-looking text retain the legacy carrier in text mode", () => {
    expect(parseWorkflowRunInput("", "text")).toEqual({ input: "" });
    expect(parseWorkflowRunInput('{"example":true}', "text")).toEqual({ input: '{"example":true}' });
  });
  test("structured delivery and checksummed attachments survive JSON mode", () => {
    const input = { delivery_request: "Generate report", baseRef: "develop", attachments: [{ path: "/workspace/sample.xlsx", sha256: "abc" }], options: { includeMissing: true }, count: 0 };
    expect(parseWorkflowRunInput(JSON.stringify(input), "json")).toEqual(input);
  });
  test.each(["null", "[]", '"prompt"', "42", "true"])("rejects non-object JSON %s", value => {
    expect(() => parseWorkflowRunInput(value, "json")).toThrow("JSON object with named fields");
  });
  test("malformed JSON cannot be silently sent as text", () => {
    expect(() => parseWorkflowRunInput('{"attachments":', "json")).toThrow("valid JSON");
  });
});
