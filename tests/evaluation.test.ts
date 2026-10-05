import { EvaluationRunner, type EvaluationSuite } from "../src/evaluation";

test("evaluation suites are versioned and produce deterministic case results", async () => {
  const suite: EvaluationSuite<number, number> = { id: "math", version: "2026-09-25", cases: [{ id: "one", version: "1", input: 1, expected: 2 }, { id: "two", version: "1", input: 2, expected: 4 }] };
  const report = await new EvaluationRunner().run(suite, async (input) => input * 2, (actual, expected) => actual === expected);
  expect(report).toMatchObject({ suiteId: "math", suiteVersion: "2026-09-25", total: 2, passed: 2 });
});
