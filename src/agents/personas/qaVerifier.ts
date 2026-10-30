import path from "node:path";
import type {
  AgentRecord,
  WorkflowEdge,
  WorkflowRecursionGuardConfig,
} from "@multi-agent/types";
import {
  createEdge,
  createRecursionGuard,
  DEFAULT_MAX_RECURSION_ITERATIONS,
} from "@multi-agent/types";

export const QA_VERIFIER_PERSONA_ID = "delivery-qa-verifier";
export const QA_VERIFIER_PERSONA_NAME = "Delivery QA Verifier";

export const GAP_ENGINEER_PERSONA_ID = "gap-implementation-engineer";
export const GAP_ENGINEER_PERSONA_NAME = "Gap Implementation Engineer";

export const QA_VERIFIER_RETRY_BOUNDS = {
  maxRetries: 3,
  maxIterations: DEFAULT_MAX_RECURSION_ITERATIONS,
  recursionLimit: 3,
  backoffMs: 1000,
} as const;

export const DEFAULT_SANDBOX_ROOT = path.resolve("workspaces/building-management-sandbox");

export const QA_VERIFIER_SYSTEM_PROMPT = `You are the Delivery QA Verifier, an autonomous quality verification and test automation specialist in the Studio multi-agent orchestration platform.

Your primary responsibilities include:
1. Sandboxed Test Execution:
   - Execute test suites (e.g. \`pytest\`, \`pnpm test\`, \`npm test\`) strictly within the designated sandbox workspace (\`workspaces/building-management-sandbox\`).
   - Never execute tests or inspect files outside the sandbox boundary; host repository access is strictly forbidden.

2. Evidence-Based Verification:
   - Evaluate every acceptance criterion and user story requirement against sandbox codebase changes.
   - Capture detailed assertion output, failure stack traces, and exit codes when tests fail.
   - Verify that no regressions are introduced into existing features.

3. Structured Feedback Reporting:
   - Construct and return a structured \`QAVerificationResult\` and \`SupervisorOutcomeEnvelope\`:
     * \`testsPassed\`: boolean indicating overall test verdict.
     * \`totalTests\`: total count of tests executed.
     * \`failedTestsCount\`: number of failed tests.
     * \`failureOutput\`: concise failure summary with failing test names and error details.
     * \`iterationCount\`: current cycle of the remediation loop.
     * \`verifiedFiles\`: list of inspected code files.
   - When tests pass, set \`nextAction: "complete"\`.
   - When tests fail, set \`nextAction: "implement_spec"\` to route back to the Gap Implementation Engineer for remediation.

4. Bounded Execution & Safety:
   - Respect per-route recursion guards (maximum 3 remediation iterations).
   - If tests fail after 3 remediation cycles, trigger or escalate to \`loop_limit_exceeded\`.
`;

export const GAP_ENGINEER_SYSTEM_PROMPT = `You are the Gap Implementation Engineer, an autonomous remediation specialist responsible for closing technical gaps and implementing missing capabilities in the Studio platform.

Your primary responsibilities include:
1. Sandboxed Code Implementation:
   - Make all file edits, additions, and refactorings strictly inside \`workspaces/building-management-sandbox\`.
   - Strictly respect the host repository protection barrier; never access or modify \`/home/hossein/Desktop/projects/building-management\`.

2. Governed Remediation Execution:
   - CRITICAL: Never modify code files without prior approval from the mandatory Human Approval Gate.
   - Remediate gaps identified in the approved Consolidated Gap Report or QA failure output.
   - Follow existing architecture, coding standards, and type safety constraints.

3. Iterative Feedback Incorporation:
   - When receiving QA failure evidence from the Delivery QA Verifier, carefully analyze failing assertions and fix root causes.
   - Keep changes focused, minimal, and targeted to the failing scenarios.
   - Track iteration count and report modified files to the supervisor.
`;

export function createQaVerifierPersona(overrides?: Partial<AgentRecord>): AgentRecord {
  const timestamp = new Date().toISOString();
  return {
    id: QA_VERIFIER_PERSONA_ID,
    name: QA_VERIFIER_PERSONA_NAME,
    description:
      "Independent QA verification specialist that runs sandboxed test suites, validates acceptance criteria, and returns structured QA outcome envelopes to the supervisor.",
    backend: {
      type: "api",
      provider: "openai",
      model: "gpt-4o",
    },
    systemPrompt: QA_VERIFIER_SYSTEM_PROMPT,
    tools: [],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read",
      network: false,
      workspaceRoot: DEFAULT_SANDBOX_ROOT,
      allowedCommands: ["pnpm", "npm", "pytest", "node", "git"],
    },
    metadata: {
      archetype: "hierarchical-supervisor",
      role: "qa_verifier",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    isSystem: true,
    ...overrides,
  };
}

export function createGapEngineerPersona(overrides?: Partial<AgentRecord>): AgentRecord {
  const timestamp = new Date().toISOString();
  return {
    id: GAP_ENGINEER_PERSONA_ID,
    name: GAP_ENGINEER_PERSONA_NAME,
    description:
      "Remediation engineer that implements missing features and fixes QA failures in the sandbox workspace strictly under human authorization.",
    backend: {
      type: "api",
      provider: "openai",
      model: "gpt-4o",
    },
    systemPrompt: GAP_ENGINEER_SYSTEM_PROMPT,
    tools: [],
    enabled: true,
    executionPolicy: {
      shell: "restricted",
      filesystem: "read-write",
      network: false,
      workspaceRoot: DEFAULT_SANDBOX_ROOT,
      allowedCommands: ["pnpm", "npm", "node", "git"],
    },
    metadata: {
      archetype: "hierarchical-supervisor",
      role: "remediation_engineer",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    isSystem: true,
    ...overrides,
  };
}

export const qaVerifierPersona: AgentRecord = createQaVerifierPersona();
export const gapEngineerPersona: AgentRecord = createGapEngineerPersona();

/**
 * Constructs a recursion guard config with default 3-iteration limit for QA remediation loops.
 */
export function createQaRemediationRecursionGuard(
  options?: Partial<WorkflowRecursionGuardConfig>
): WorkflowRecursionGuardConfig {
  return createRecursionGuard(
    options?.routeKey ?? "qa_verify->implement_spec",
    options?.fallbackBranch ?? "loop_limit_exceeded",
    options?.maxIterations ?? QA_VERIFIER_RETRY_BOUNDS.maxIterations
  );
}

/**
 * Builds the conditional and cyclic edges for a QA remediation loop connected to a supervisor router.
 */
export function createQaVerifierRoutingEdges(options: {
  conditionNodeId: string;
  qaVerifierNodeId: string;
  remediationNodeId: string;
  outputNodeId?: string;
  fallbackNodeId?: string;
}): WorkflowEdge[] {
  const edges: WorkflowEdge[] = [
    // Condition router -> Remediation engineer (when nextAction === "implement_spec")
    createEdge({
      source: options.conditionNodeId,
      target: options.remediationNodeId,
      kind: "conditional",
      branchKey: "implement_spec",
      label: "QA Failed: Remediate",
    }),
    // Remediation engineer -> QA verifier
    createEdge({
      source: options.remediationNodeId,
      target: options.qaVerifierNodeId,
      label: "Code Ready for QA",
    }),
    // QA verifier -> Condition router (feedback cycle)
    createEdge({
      source: options.qaVerifierNodeId,
      target: options.conditionNodeId,
      label: "Evaluate QA Outcome",
    }),
  ];

  if (options.outputNodeId) {
    // Condition router -> Output (when nextAction === "complete")
    edges.push(
      createEdge({
        source: options.conditionNodeId,
        target: options.outputNodeId,
        kind: "conditional",
        branchKey: "complete",
        label: "QA Passed: Complete",
      })
    );
  }

  if (options.fallbackNodeId) {
    // Condition router -> Fallback handler (when limit reached: "loop_limit_exceeded")
    edges.push(
      createEdge({
        source: options.conditionNodeId,
        target: options.fallbackNodeId,
        kind: "conditional",
        branchKey: "loop_limit_exceeded",
        label: "Recursion Limit Exceeded",
      })
    );
  }

  return edges;
}
