export interface EvaluationCase<Input = unknown, Expected = unknown> {
  id: string;
  version: string;
  input: Input;
  expected: Expected;
}

export interface EvaluationResult {
  caseId: string;
  suiteVersion: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface EvaluationSuite<Input = unknown, Expected = unknown> {
  id: string;
  version: string;
  cases: readonly EvaluationCase<Input, Expected>[];
}

export class EvaluationRunner {
  async run<Input, Expected>(suite: EvaluationSuite<Input, Expected>, execute: (input: Input) => Promise<Expected>, compare: (actual: Expected, expected: Expected) => boolean) {
    const results: EvaluationResult[] = [];
    for (const testCase of suite.cases) {
      const started = Date.now();
      try {
        const actual = await execute(testCase.input);
        results.push({ caseId: testCase.id, suiteVersion: suite.version, passed: compare(actual, testCase.expected), durationMs: Date.now() - started });
      } catch (error) {
        results.push({ caseId: testCase.id, suiteVersion: suite.version, passed: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
      }
    }
    return { suiteId: suite.id, suiteVersion: suite.version, total: results.length, passed: results.filter((result) => result.passed).length, results };
  }
}
