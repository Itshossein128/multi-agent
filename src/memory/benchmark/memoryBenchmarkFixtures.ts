import type { MemoryKind } from "@multi-agent/types";
import type { MemoryEvalFixture } from "../evaluation/memoryEvalFixtures";

export const MEMORY_BENCHMARK_VERSION = 1;
export const MEMORY_BENCHMARK_NOW = Date.parse("2026-09-26T00:00:00.000Z");

export type MemoryBenchmarkMode = "no-memory" | "semantic-only" | "semantic-episodic" | "full";
export type MemoryBenchmarkCategory =
  | "semantic-recall"
  | "episodic-recall"
  | "procedural-recall"
  | "novel-task"
  | "conflict"
  | "supersession"
  | "episodic-diversity"
  | "procedural-conflict"
  | "vocabulary-mismatch"
  | "context-budget";

export interface MemoryBenchmarkScenario {
  id: string;
  title: string;
  category: MemoryBenchmarkCategory;
  setup: {
    priorRuns: string[];
    memories: MemoryEvalFixture[];
  };
  targetTask: string;
  expectedRelevantMemories: string[];
  forbiddenMemories: string[];
  expectedBehavior: string[];
  requiredOutputMarkers: string[];
  forbiddenOutputMarkers: string[];
  modes: MemoryBenchmarkMode[];
  kinds?: MemoryKind[];
  maxMemories: number;
  memoryTokenBudget: number;
  baseContextTokens: number;
  /** Known limitations are measured as task failures but do not fail regression gates. */
  diagnosticOnly?: boolean;
}

const semantic = (id: string, content: string, subject: string, importance = 0.7, extra: Partial<MemoryEvalFixture> = {}): MemoryEvalFixture => ({
  id, kind: "semantic", content, subject, importance, ...extra,
});
const episodic = (id: string, situation: string, action: string, result: string, lesson: string, success: boolean): MemoryEvalFixture => ({
  id, kind: "episodic", subject: situation, situation, action, result, lesson, success,
  content: `Situation: ${situation}\nAction: ${action}\nResult: ${result}\nLesson: ${lesson}`,
  importance: success ? 0.65 : 0.75,
});
const procedural = (id: string, trigger: string, procedure: string, confidence: number, importance = confidence, extra: Partial<MemoryEvalFixture> = {}): MemoryEvalFixture => ({
  id, kind: "procedural", subject: trigger, trigger, procedure, confidence, importance, ...extra,
  content: `Trigger: ${trigger}\nProcedure: ${procedure}`,
});

const pnpm = semantic("bench-sem-pnpm", "The repository package manager is pnpm. Use pnpm for install, test, and build commands.", "package-manager-pnpm", 0.9, { verificationStatus: "verified", confidence: 0.95 });
const npm = semantic("bench-sem-npm-stale", "The repository package manager is npm. Use npm install.", "package-manager-npm", 0.7, { verificationStatus: "stale", confidence: 0.4, ageDays: 180 });
const postgres = semantic("bench-sem-postgres", "The repository uses PostgreSQL.", "database-postgresql", 0.8, { verificationStatus: "verified", confidence: 0.9 });

export const MEMORY_BENCHMARK_SCENARIOS: MemoryBenchmarkScenario[] = [
  {
    id: "semantic-recall", title: "Durable package-manager fact", category: "semantic-recall",
    setup: { priorRuns: ["The repository migrated from npm to pnpm."], memories: [pnpm] },
    targetTask: "Which package manager should be used for repository commands?",
    expectedRelevantMemories: [pnpm.id], forbiddenMemories: [],
    expectedBehavior: ["select pnpm", "do not invent package-manager guidance"],
    requiredOutputMarkers: ["pnpm"], forbiddenOutputMarkers: ["npm"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "episodic-recall", title: "Prior migration failure and recovery", category: "episodic-recall",
    setup: { priorRuns: ["Migration failed with duplicate columns; idempotent migration guard succeeded."], memories: [
      episodic("bench-epi-migration", "retry a schema migration after duplicate-column failure", "inspect schema then add an idempotent guard", "migration succeeded", "avoid blindly rerunning the failing ALTER statement", true),
    ] },
    targetTask: "Retry the schema migration after the duplicate column error.",
    expectedRelevantMemories: ["bench-epi-migration"], forbiddenMemories: [],
    expectedBehavior: ["inspect schema first", "avoid the known failing retry"],
    requiredOutputMarkers: ["inspect schema", "idempotent guard"], forbiddenOutputMarkers: ["blindly rerun"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["episodic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "procedural-recall", title: "Learned release procedure", category: "procedural-recall",
    setup: { priorRuns: ["Two successful releases followed the same verified sequence."], memories: [
      procedural("bench-proc-release", "prepare a production release", "run lint; run tests; build artifacts; tag only after verification", 0.85),
    ] },
    targetTask: "Prepare a production release.", expectedRelevantMemories: ["bench-proc-release"], forbiddenMemories: [],
    expectedBehavior: ["lint before tag", "test before tag", "build before tag"],
    requiredOutputMarkers: ["run lint", "run tests", "build artifacts"], forbiddenOutputMarkers: ["tag immediately"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["procedural"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 440,
  },
  {
    id: "novel-task", title: "Unrelated astronomy task", category: "novel-task",
    setup: { priorRuns: ["Repository work only."], memories: [pnpm, postgres, procedural("bench-proc-deploy", "deploy the web service", "build; migrate; restart; health check", 0.8)] },
    targetTask: "Compute the orbital period of a newly observed exoplanet from telescope measurements.",
    expectedRelevantMemories: [], forbiddenMemories: [pnpm.id, postgres.id, "bench-proc-deploy"],
    expectedBehavior: ["return an empty memory context"],
    requiredOutputMarkers: [], forbiddenOutputMarkers: ["pnpm", "postgresql", "health check"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], maxMemories: 8, memoryTokenBudget: 2048, baseContextTokens: 380,
  },
  {
    id: "stale-conflict", title: "Supported package-manager conflict family", category: "conflict",
    setup: { priorRuns: ["npm was replaced by pnpm."], memories: [npm, pnpm] },
    targetTask: "Install dependencies with the current package manager.", expectedRelevantMemories: [pnpm.id], forbiddenMemories: [npm.id],
    expectedBehavior: ["use pnpm", "suppress stale npm"],
    requiredOutputMarkers: ["pnpm"], forbiddenOutputMarkers: ["npm"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "supersession", title: "Explicit A to B supersession", category: "supersession",
    setup: { priorRuns: ["The npm fact was explicitly superseded by pnpm."], memories: [
      { ...npm, id: "bench-super-old", verificationStatus: undefined },
      { ...pnpm, id: "bench-super-new", subject: "package-manager-pnpm" },
    ] },
    targetTask: "Which package manager is current?", expectedRelevantMemories: ["bench-super-new"], forbiddenMemories: ["bench-super-old"],
    expectedBehavior: ["use replacement", "exclude superseded record"],
    requiredOutputMarkers: ["pnpm"], forbiddenOutputMarkers: ["npm"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "episodic-diversity", title: "Distinct migration episodes remain available", category: "episodic-diversity",
    setup: { priorRuns: ["Three migration incidents had different causes."], memories: [
      episodic("bench-epi-duplicate-column", "database migration incident", "inspect schema for duplicate columns", "migration repaired", "guard ALTER statements", true),
      episodic("bench-epi-lock-timeout", "database migration incident", "identify blocking transaction", "lock cleared and migration resumed", "check database locks", true),
      episodic("bench-epi-permission", "database migration incident", "verify migration role grants", "permissions corrected", "check database role privileges", true),
    ] },
    targetTask: "Investigate another database migration incident.",
    expectedRelevantMemories: ["bench-epi-duplicate-column", "bench-epi-lock-timeout", "bench-epi-permission"], forbiddenMemories: [],
    expectedBehavior: ["retain distinct causes", "do not collapse separate incidents"],
    requiredOutputMarkers: ["inspect schema", "blocking transaction", "role grants"], forbiddenOutputMarkers: [],
    diagnosticOnly: true,
    modes: ["no-memory", "semantic-episodic", "full"], kinds: ["episodic"], maxMemories: 3, memoryTokenBudget: 4096, baseContextTokens: 450,
  },
  {
    id: "procedural-conflict", title: "Stronger procedure wins for the same trigger", category: "procedural-conflict",
    setup: { priorRuns: ["The verified release sequence succeeded repeatedly; the shortcut often failed."], memories: [
      procedural("bench-proc-strong", "prepare production release", "lint; test; build; tag after checks", 0.95, 0.95, {
        verificationStatus: "verified", metadata: { __reliability_evidence_count: 5, successRatio: 0.9 },
      }),
      procedural("bench-proc-weak", "prepare production release", "tag immediately", 0.25, 0.25, {
        metadata: { __reliability_evidence_count: 1, successRatio: 0.3 },
      }),
    ] },
    targetTask: "Prepare production release.", expectedRelevantMemories: ["bench-proc-strong"], forbiddenMemories: ["bench-proc-weak"],
    expectedBehavior: ["select stronger procedure", "suppress weaker same-trigger procedure"],
    requiredOutputMarkers: ["lint", "test", "build"], forbiddenOutputMarkers: ["tag immediately"],
    modes: ["no-memory", "full"], kinds: ["procedural"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "procedural-distinct-triggers", title: "Different procedural triggers are not suppressed", category: "procedural-conflict",
    setup: { priorRuns: ["Deployment and rollback are distinct operations."], memories: [
      procedural("bench-proc-deploy-distinct", "deploy service", "build; migrate; restart; health check", 0.9),
      procedural("bench-proc-rollback-distinct", "rollback service", "restore artifact; rollback migration; restart; health check", 0.9),
    ] },
    targetTask: "Compare the deploy service and rollback service procedures.",
    expectedRelevantMemories: ["bench-proc-deploy-distinct", "bench-proc-rollback-distinct"], forbiddenMemories: [],
    expectedBehavior: ["retain both genuinely different procedures"],
    requiredOutputMarkers: ["migrate", "rollback migration"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "full"], kinds: ["procedural"], maxMemories: 3, memoryTokenBudget: 4096, baseContextTokens: 440,
  },
  {
    id: "vocabulary-mismatch", title: "PostgreSQL fact with vocabulary mismatch", category: "vocabulary-mismatch",
    setup: { priorRuns: ["Persistence was configured with PostgreSQL."], memories: [postgres] },
    targetTask: "What relational datastore backs persistence?", expectedRelevantMemories: [postgres.id], forbiddenMemories: [],
    expectedBehavior: ["recall PostgreSQL despite paraphrase"], diagnosticOnly: true,
    requiredOutputMarkers: ["postgresql"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "unknown-domain-conflict", title: "Unknown authentication conflict family", category: "conflict",
    setup: { priorRuns: ["Authentication changed from session cookies to bearer tokens."], memories: [
      semantic("bench-auth-session", "Authentication mode is session cookies.", "authentication-mode-session", 0.6, { verificationStatus: "stale", confidence: 0.4, ageDays: 120 }),
      semantic("bench-auth-bearer", "Authentication mode is bearer tokens.", "authentication-mode-bearer", 0.9, { verificationStatus: "verified", confidence: 0.95 }),
    ] },
    targetTask: "Which authentication mode should the API client use?", expectedRelevantMemories: ["bench-auth-bearer"], forbiddenMemories: ["bench-auth-session"],
    expectedBehavior: ["select bearer tokens", "suppress obsolete session cookies"], diagnosticOnly: true,
    requiredOutputMarkers: ["bearer tokens"], forbiddenOutputMarkers: ["session cookies"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "context-budget", title: "Highest-value memory survives a tight budget", category: "context-budget",
    setup: { priorRuns: ["The current verified deployment rule must outrank low-value notes."], memories: [
      procedural("bench-budget-useful", "deploy production service", "back up; migrate; restart; verify health", 0.99),
      procedural("bench-budget-noise-1", "deploy production service notes", "check status sometime", 0.2),
      procedural("bench-budget-noise-2", "deploy production service reminder", "look at dashboard", 0.15),
    ] },
    targetTask: "Deploy production service.", expectedRelevantMemories: ["bench-budget-useful"], forbiddenMemories: ["bench-budget-noise-1", "bench-budget-noise-2"],
    expectedBehavior: ["preserve the highest-value procedure under budget"],
    requiredOutputMarkers: ["back up", "migrate", "verify health"], forbiddenOutputMarkers: ["sometime", "dashboard"],
    modes: ["no-memory", "full"], kinds: ["procedural"], maxMemories: 8, memoryTokenBudget: 330, baseContextTokens: 180,
  },
];

export function kindsForBenchmarkMode(mode: MemoryBenchmarkMode): MemoryKind[] | undefined {
  if (mode === "no-memory") return [];
  if (mode === "semantic-only") return ["semantic"];
  if (mode === "semantic-episodic") return ["semantic", "episodic"];
  return undefined;
}
