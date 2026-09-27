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
  | "context-budget"
  | "candidate-precision"
  | "cross-source-dedup";

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
const authBearer = semantic("bench-sem-auth-bearer", "Authentication uses signed bearer tokens.", "authentication-bearer-tokens", 0.9, { verificationStatus: "verified", confidence: 0.95 });
const workspacePnpm = semantic("bench-sem-workspace-pnpm", "The workspace uses pnpm.", "package-manager-pnpm", 0.9, { verificationStatus: "verified", confidence: 0.95 });
const dockerRuntime = semantic("bench-sem-docker", "Workers execute inside Docker containers.", "container-runtime-docker", 0.85, { verificationStatus: "verified", confidence: 0.9 });
const storybook = semantic("bench-sem-storybook", "The UI uses Storybook for component documentation.", "ui-component-storybook", 0.7);
const migrationEpisode = episodic("bench-epi-migration-failure", "database migration deployment failure", "run pending database migrations then redeploy", "service started successfully", "Deployment failed because the migration had not run.", true);
const migrationProcedure = procedural("bench-proc-migration-recovery", "database migration failure", "run idempotent schema migration patch", 0.9);

// Phase 8 Generalized Semantic Conflict Fixtures
const vmDeploy = semantic("bench-deploy-vm", "Production runs on virtual machines.", "deployment-platform-vm", 0.6, { verificationStatus: "stale", confidence: 0.4, ageDays: 180 });
const k8sDeploy = semantic("bench-deploy-k8s", "Production runs on Kubernetes.", "deployment-platform-k8s", 0.9, { verificationStatus: "verified", confidence: 0.95 });
const react18 = semantic("bench-react-18", "Application uses React 18.", "framework-version-react18", 0.6, { verificationStatus: "stale", confidence: 0.5, ageDays: 90 });
const react19 = semantic("bench-react-19", "Application uses React 19.", "framework-version-react19", 0.9, { verificationStatus: "verified", confidence: 0.95 });
const apiRest = semantic("bench-api-rest", "Internal API uses REST.", "api-style-rest", 0.6, { verificationStatus: "stale", confidence: 0.4, ageDays: 120 });
const apiGraphql = semantic("bench-api-graphql", "Internal API uses GraphQL.", "api-style-graphql", 0.9, { verificationStatus: "verified", confidence: 0.95 });
const frontendReact = semantic("bench-frontend-react", "Frontend uses React.", "frontend", 0.85, { verificationStatus: "verified", confidence: 0.95 });
const backendAspNet = semantic("bench-backend-aspnet", "Backend uses ASP.NET Core.", "backend", 0.85, { verificationStatus: "verified", confidence: 0.95 });
const browserChrome = semantic("bench-browser-chrome", "Application supports Chrome.", "supported-browsers-chrome", 0.85, { verificationStatus: "verified", confidence: 0.95 });
const browserFirefox = semantic("bench-browser-firefox", "Application supports Firefox.", "supported-browsers-firefox", 0.85, { verificationStatus: "verified", confidence: 0.95 });
const pkgHistoricalNpm = semantic("bench-pkg-2025-npm", "In 2025 the project used npm.", "repository package manager", 0.8, { verificationStatus: "verified", confidence: 0.9 });
const pkgCurrentPnpm = semantic("bench-pkg-current-pnpm", "The project uses pnpm.", "repository package manager", 0.9, { verificationStatus: "verified", confidence: 0.95 });

// Phase 9 Distractors and Scenarios
const generateDistractors = (count = 100): MemoryEvalFixture[] => {
  const topics = [
    "css-grid", "color-theme", "unit-test-coverage", "webhook-retry", "image-optimization",
    "markdown-parser", "icon-sprite", "font-loading", "rate-limiting", "cookie-banner",
    "dns-records", "tls-certificate", "email-template", "csv-export", "pdf-generation",
    "cron-scheduler", "session-timeout", "oauth-provider", "graphql-schema", "websocket-heartbeat",
  ];
  return Array.from({ length: count }, (_, i) => {
    const topic = topics[i % topics.length];
    return semantic(
      `distractor-${i}`,
      `Configuration notes for ${topic} feature item ${i} in operational docs.`,
      `system-${topic}-${i}`,
      0.2,
      { confidence: 0.5 }
    );
  });
};
const distractors100 = generateDistractors(100);

const epiDiverse1 = episodic("bench-epi-div-1", "migration incident with database lock timeout", "terminate blocking locks and retry migration", "migration succeeded after unlocking", "kill blocking locks before retrying", true);
const epiDiverse2 = episodic("bench-epi-div-2", "migration incident with duplicate column", "inspect schema then add idempotent guard", "migration succeeded", "avoid blindly rerunning failing ALTER statement", true);
const epiDiverse3 = episodic("bench-epi-div-3", "migration incident with secondary lock conflict", "terminate blocking locks and retry migration", "migration succeeded after unlocking", "kill blocking locks before retrying", true);

const procFiveSteps = procedural("bench-proc-five-steps", "execute production release", "1. run security audit; 2. run regression suite; 3. compile release artifacts; 4. execute blue-green deployment; 5. verify health check and smoke tests", 0.95);

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
    expectedBehavior: ["recall PostgreSQL despite paraphrase"],
    requiredOutputMarkers: ["postgresql"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "vocabulary-auth", title: "Authentication fact with vocabulary mismatch", category: "vocabulary-mismatch",
    setup: { priorRuns: ["Signed bearer tokens configure API access."], memories: [authBearer] },
    targetTask: "How are API requests authorized?", expectedRelevantMemories: [authBearer.id], forbiddenMemories: [],
    expectedBehavior: ["recall bearer tokens authorization"],
    requiredOutputMarkers: ["bearer tokens"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "vocabulary-package-manager", title: "Package manager with dependency manager phrasing", category: "vocabulary-mismatch",
    setup: { priorRuns: ["Workspace toolchain configured with pnpm."], memories: [workspacePnpm] },
    targetTask: "Which dependency manager should I use?", expectedRelevantMemories: [workspacePnpm.id], forbiddenMemories: [],
    expectedBehavior: ["recall pnpm for dependency manager query"],
    requiredOutputMarkers: ["pnpm"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "vocabulary-container-runtime", title: "Docker containers with isolated agent phrasing", category: "vocabulary-mismatch",
    setup: { priorRuns: ["Isolated worker sandbox runs in Docker."], memories: [dockerRuntime] },
    targetTask: "Where does isolated agent execution happen?", expectedRelevantMemories: [dockerRuntime.id], forbiddenMemories: [],
    expectedBehavior: ["recall Docker containers for isolated execution"],
    requiredOutputMarkers: ["docker"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "vocabulary-negative-control", title: "Unrelated UI component memory negative control", category: "vocabulary-mismatch",
    setup: { priorRuns: ["UI design system documented."], memories: [storybook] },
    targetTask: "Which database backs persistence?", expectedRelevantMemories: [], forbiddenMemories: [storybook.id],
    expectedBehavior: ["exclude unrelated UI Storybook memory from database query"],
    requiredOutputMarkers: [], forbiddenOutputMarkers: ["storybook"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "vocabulary-episodic", title: "Cross-kind episodic schema initialization retrieval", category: "vocabulary-mismatch",
    setup: { priorRuns: ["A past deployment missed running database migrations."], memories: [migrationEpisode] },
    targetTask: "Have we seen a schema initialization issue before?", expectedRelevantMemories: [migrationEpisode.id], forbiddenMemories: [],
    expectedBehavior: ["recall prior migration deployment failure episode"],
    requiredOutputMarkers: ["database migrations"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-episodic", "full"], kinds: ["episodic"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "vocabulary-procedural", title: "Cross-kind procedural schema upgrade recovery retrieval", category: "vocabulary-mismatch",
    setup: { priorRuns: ["Automated recovery for database migration failures."], memories: [migrationProcedure] },
    targetTask: "schema upgrade broke deployment", expectedRelevantMemories: [migrationProcedure.id], forbiddenMemories: [],
    expectedBehavior: ["recall migration failure recovery procedure"],
    requiredOutputMarkers: ["idempotent schema migration patch"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "full"], kinds: ["procedural"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "unknown-domain-conflict", title: "Unknown authentication conflict family", category: "conflict",
    setup: { priorRuns: ["Authentication changed from session cookies to bearer tokens."], memories: [
      semantic("bench-auth-session", "Authentication mode is session cookies.", "authentication-mode-session", 0.6, { verificationStatus: "stale", confidence: 0.4, ageDays: 120 }),
      semantic("bench-auth-bearer", "Authentication mode is bearer tokens.", "authentication-mode-bearer", 0.9, { verificationStatus: "verified", confidence: 0.95 }),
    ] },
    targetTask: "Which authentication mode should the API client use?", expectedRelevantMemories: ["bench-auth-bearer"], forbiddenMemories: ["bench-auth-session"],
    expectedBehavior: ["select bearer tokens", "suppress obsolete session cookies"],
    requiredOutputMarkers: ["bearer tokens"], forbiddenOutputMarkers: ["session cookies"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "conflict-deployment-platform", title: "Deployment platform conflict resolution", category: "conflict",
    setup: { priorRuns: ["Production deployment migrated from virtual machines to Kubernetes."], memories: [vmDeploy, k8sDeploy] },
    targetTask: "Where does production deploy and run?", expectedRelevantMemories: [k8sDeploy.id], forbiddenMemories: [vmDeploy.id],
    expectedBehavior: ["select Kubernetes platform", "suppress obsolete virtual machines"],
    requiredOutputMarkers: ["kubernetes"], forbiddenOutputMarkers: ["virtual machines"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "conflict-framework-version", title: "Framework version conflict resolution", category: "conflict",
    setup: { priorRuns: ["Application updated from React 18 to React 19."], memories: [react18, react19] },
    targetTask: "Which React version does the application use?", expectedRelevantMemories: [react19.id], forbiddenMemories: [react18.id],
    expectedBehavior: ["select React 19", "suppress obsolete React 18"],
    requiredOutputMarkers: ["react 19"], forbiddenOutputMarkers: ["react 18"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "conflict-api-style", title: "Internal API style conflict resolution", category: "conflict",
    setup: { priorRuns: ["Internal API architecture transitioned from REST to GraphQL."], memories: [apiRest, apiGraphql] },
    targetTask: "What API architecture style is used for internal services?", expectedRelevantMemories: [apiGraphql.id], forbiddenMemories: [apiRest.id],
    expectedBehavior: ["select GraphQL API style", "suppress obsolete REST"],
    requiredOutputMarkers: ["graphql"], forbiddenOutputMarkers: ["rest"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "non-conflict-multidomain", title: "Multi-domain independent stack coexistence", category: "conflict",
    setup: { priorRuns: ["Architecture stack contains frontend and backend technologies."], memories: [frontendReact, backendAspNet] },
    targetTask: "What technologies do the frontend and backend use?", expectedRelevantMemories: [frontendReact.id, backendAspNet.id], forbiddenMemories: [],
    expectedBehavior: ["retain both frontend and backend facts", "do not falsely suppress independent domains"],
    requiredOutputMarkers: ["react", "asp.net core"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "non-conflict-multivalued", title: "Multi-valued browser support coexistence", category: "conflict",
    setup: { priorRuns: ["Browser support matrix configured."], memories: [browserChrome, browserFirefox] },
    targetTask: "Which browsers are supported by the application?", expectedRelevantMemories: [browserChrome.id, browserFirefox.id], forbiddenMemories: [],
    expectedBehavior: ["retain both supported browsers", "do not treat multi-valued facts as mutually exclusive"],
    requiredOutputMarkers: ["chrome", "firefox"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "temporal-historical-query", title: "Historical query targets past package manager", category: "conflict",
    setup: { priorRuns: ["Historical package manager was npm in 2025."], memories: [pkgHistoricalNpm, pkgCurrentPnpm] },
    targetTask: "What package manager did the project use in 2025?", expectedRelevantMemories: [pkgHistoricalNpm.id], forbiddenMemories: [],
    expectedBehavior: ["select historical npm memory for historical query"],
    requiredOutputMarkers: ["npm"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "temporal-current-query", title: "Current query selects current package manager", category: "conflict",
    setup: { priorRuns: ["Current package manager is pnpm."], memories: [pkgHistoricalNpm, pkgCurrentPnpm] },
    targetTask: "What package manager does the project use now?", expectedRelevantMemories: [pkgCurrentPnpm.id], forbiddenMemories: [pkgHistoricalNpm.id],
    expectedBehavior: ["select current pnpm", "suppress historical npm"],
    requiredOutputMarkers: ["pnpm"], forbiddenOutputMarkers: ["used npm"],
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
  {
    id: "candidate-precision-noise-scale", title: "Relevant fact discovered amid 100+ distractor memories", category: "candidate-precision",
    setup: { priorRuns: ["Extensive operational notes recorded in repository."], memories: [pnpm, ...distractors100] },
    targetTask: "Which package manager should be used for repository commands?", expectedRelevantMemories: [pnpm.id], forbiddenMemories: [],
    expectedBehavior: ["select pnpm", "exclude all distractors"],
    requiredOutputMarkers: ["pnpm"], forbiddenOutputMarkers: ["distractor", "configuration notes"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "candidate-precision-vocab-noise", title: "Vocabulary mismatch resolved amid 100+ distractor memories", category: "candidate-precision",
    setup: { priorRuns: ["Extensive operational notes recorded in repository."], memories: [postgres, ...distractors100] },
    targetTask: "What relational datastore backs persistence?", expectedRelevantMemories: [postgres.id], forbiddenMemories: [],
    expectedBehavior: ["select postgresql despite vocabulary mismatch and noise distractors"],
    requiredOutputMarkers: ["postgresql"], forbiddenOutputMarkers: ["distractor", "configuration notes"],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
  {
    id: "episodic-diversity-budget", title: "Episodic diversity preserved under constrained context budget", category: "episodic-diversity",
    setup: { priorRuns: ["Three distinct migration incidents were encountered."], memories: [epiDiverse1, epiDiverse2, epiDiverse3] },
    targetTask: "Resolve database migration failure incidents.", expectedRelevantMemories: [epiDiverse1.id, epiDiverse2.id], forbiddenMemories: [],
    expectedBehavior: ["select informative diverse incidents under budget", "do not falsely treat distinct incidents as conflicts"],
    requiredOutputMarkers: ["retry migration", "idempotent guard"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-episodic", "full"], kinds: ["episodic"], maxMemories: 2, memoryTokenBudget: 850, baseContextTokens: 400,
  },
  {
    id: "procedural-completeness", title: "Multi-step safety-critical procedure remains completely intact", category: "procedural-recall",
    setup: { priorRuns: ["Verified 5-step release procedure documented."], memories: [procFiveSteps] },
    targetTask: "Execute production release.", expectedRelevantMemories: [procFiveSteps.id], forbiddenMemories: [],
    expectedBehavior: ["all 5 procedure steps must remain intact without partial truncation"],
    requiredOutputMarkers: ["security audit", "regression suite", "compile release artifacts", "blue-green deployment", "health check and smoke tests"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "full"], kinds: ["procedural"], maxMemories: 3, memoryTokenBudget: 2048, baseContextTokens: 400,
  },
  {
    id: "cross-source-duplication", title: "Cross-source redundant memory pruned without loss of authority", category: "cross-source-dedup",
    setup: { priorRuns: ["Handoff already established that the package manager is pnpm."], memories: [pnpm] },
    targetTask: "Which package manager should be used for repository commands?", expectedRelevantMemories: [pnpm.id], forbiddenMemories: [],
    expectedBehavior: ["select pnpm", "authority preserved"],
    requiredOutputMarkers: ["pnpm"], forbiddenOutputMarkers: [],
    modes: ["no-memory", "semantic-only", "semantic-episodic", "full"], kinds: ["semantic"], maxMemories: 4, memoryTokenBudget: 2048, baseContextTokens: 420,
  },
];

export function kindsForBenchmarkMode(mode: MemoryBenchmarkMode): MemoryKind[] | undefined {
  if (mode === "no-memory") return [];
  if (mode === "semantic-only") return ["semantic"];
  if (mode === "semantic-episodic") return ["semantic", "episodic"];
  return undefined;
}
