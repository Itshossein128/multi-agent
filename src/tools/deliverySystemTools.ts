import fs from "node:fs";
import path from "node:path";
import { cliExecutableAvailable } from "../agents/runtime/cliAgentExecutor";

export interface ScheduleSubtask {
  id: string;
  title: string;
  low?: number;
  likely?: number;
  high?: number;
  done?: string;
  evidence?: string[];
}

export interface SchedulePhase {
  wbs: string;
  name: string;
  low?: number;
  likely?: number;
  high?: number;
  depends?: string;
  work?: string;
  acceptance?: string;
  basis?: string;
  sources?: string[];
  inputs?: string;
  owner?: string;
  subtasks?: ScheduleSubtask[];
  technical_dependencies?: string[];
}

function safeResolveWithinRoot(baseRoot: string, relativeOrAbsolute?: string): string {
  const canonicalRoot = fs.existsSync(baseRoot) ? fs.realpathSync(baseRoot) : path.resolve(baseRoot);
  if (!relativeOrAbsolute || !relativeOrAbsolute.trim()) {
    return canonicalRoot;
  }
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? path.resolve(relativeOrAbsolute)
    : path.resolve(canonicalRoot, relativeOrAbsolute);
  const resolvedCandidate = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  const rel = path.relative(canonicalRoot, resolvedCandidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Target path "${relativeOrAbsolute}" escapes configured projectRoot "${canonicalRoot}".`);
  }
  return resolvedCandidate;
}

function resolveProjectRoot(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): string {
  const configured = String(
    input.projectRoot ??
      configuration.projectRoot ??
      configuration.workspaceRoot ??
      "/home/hossein/Desktop/projects/building-management",
  ).trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("Tool requires an absolute projectRoot.");
  }
  if (!fs.existsSync(configured) || !fs.statSync(configured).isDirectory()) {
    throw new Error(`Configured projectRoot "${configured}" does not exist or is not a directory.`);
  }
  return fs.realpathSync(configured);
}

function discoverSubphaseDirectories(projectRoot: string, phaseId: string): {
  dirPath: string;
  implementationPhasesPath?: string;
  manifestPath?: string;
  acceptancePath?: string;
  accessMatrixPath?: string;
  subphases: Array<Record<string, unknown>>;
  prompts: Array<Record<string, unknown>>;
} | null {
  const outputDir = path.join(projectRoot, "output");
  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) return null;

  const normalizedSlug = phaseId.toLowerCase().replace(/\./g, "");
  const entries = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const lower = name.toLowerCase();
      return lower.startsWith(`${normalizedSlug}-`) || lower.startsWith(`${phaseId.toLowerCase()}-`);
    })
    .sort();

  if (!entries.length) return null;
  const latestDir = path.join(outputDir, entries[entries.length - 1]);
  const implJsonPath = path.join(latestDir, "implementation-phases.json");
  const manifestJsonPath = path.join(latestDir, "prompts", "manifest.json");
  const acceptancePath = path.join(latestDir, "acceptance.md");
  const accessMatrixPath = path.join(latestDir, "module-access-matrix.md");

  let subphases: Array<Record<string, unknown>> = [];
  if (fs.existsSync(implJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(implJsonPath, "utf8")) as { phases?: Array<Record<string, unknown>> };
      if (Array.isArray(parsed.phases)) subphases = parsed.phases;
    } catch {
      /* ignore malformed JSON */
    }
  }

  let prompts: Array<Record<string, unknown>> = [];
  if (fs.existsSync(manifestJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestJsonPath, "utf8")) as Record<string, unknown>;
      const rawList = Array.isArray(parsed.prompts)
        ? parsed.prompts
        : Array.isArray(parsed.phases)
          ? parsed.phases
          : [];
      prompts = rawList.map((item: any) => {
        const filePath = typeof item.file === "string" ? item.file : undefined;
        const absolutePromptPath = filePath
          ? path.isAbsolute(filePath)
            ? filePath
            : path.join(latestDir, filePath)
          : undefined;
        return {
          ...item,
          absolutePromptPath,
        };
      });
    } catch {
      /* ignore malformed JSON */
    }
  }

  return {
    dirPath: latestDir,
    ...(fs.existsSync(implJsonPath) ? { implementationPhasesPath: implJsonPath } : {}),
    ...(fs.existsSync(manifestJsonPath) ? { manifestPath: manifestJsonPath } : {}),
    ...(fs.existsSync(acceptancePath) ? { acceptancePath } : {}),
    ...(fs.existsSync(accessMatrixPath) ? { accessMatrixPath } : {}),
    subphases,
    prompts,
  };
}

/**
 * Reads `/output/delivery-plan-2026-11-03` (`schedule.json`, `delivery-plan.md`, `work-packages.csv`)
 * and returns structured WBS phases, work packages, dependencies, and discovered subphase prompts.
 */
export function executeDeliveryPlanReader(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const projectRoot = resolveProjectRoot(configuration, input);
  const planRel = String(input.planDir ?? configuration.planDir ?? "output/delivery-plan-2026-11-03").trim();
  const planDir = safeResolveWithinRoot(projectRoot, planRel);
  const schedulePath = path.join(planDir, "schedule.json");
  if (!fs.existsSync(schedulePath)) {
    throw new Error(`schedule.json not found at "${schedulePath}".`);
  }

  const rawSchedule = JSON.parse(fs.readFileSync(schedulePath, "utf8")) as {
    version?: number;
    assessed_on?: string;
    commit?: string;
    start?: string;
    capacity?: Record<string, unknown>;
    phases?: SchedulePhase[];
  };
  const phases = Array.isArray(rawSchedule.phases) ? rawSchedule.phases : [];
  const mode = String(input.mode ?? "summary").trim().toLowerCase();
  const requestedPhaseId = typeof input.phaseId === "string" ? input.phaseId.trim() : undefined;
  const completedPhases = new Set(
    Array.isArray(input.completedPhaseIds)
      ? input.completedPhaseIds.filter((x): x is string => typeof x === "string").map((x) => x.trim())
      : [],
  );

  if (mode === "phase" && requestedPhaseId) {
    const matched = phases.find((p) => p.wbs.toLowerCase() === requestedPhaseId.toLowerCase());
    if (!matched) {
      return {
        found: false,
        phaseId: requestedPhaseId,
        availablePhases: phases.map((p) => p.wbs),
      };
    }
    const existingSubphases = discoverSubphaseDirectories(projectRoot, matched.wbs);
    return {
      found: true,
      phaseId: matched.wbs,
      name: matched.name,
      hours: { low: matched.low ?? 0, likely: matched.likely ?? 0, high: matched.high ?? 0 },
      depends: matched.depends ?? "",
      technicalDependencies: matched.technical_dependencies ?? [],
      work: matched.work ?? "",
      acceptance: matched.acceptance ?? "",
      inputs: matched.inputs ?? "",
      owner: matched.owner ?? "",
      sources: matched.sources ?? [],
      workPackages: matched.subtasks ?? [],
      workPackagesCount: (matched.subtasks ?? []).length,
      existingDecomposition: existingSubphases
        ? {
            hasExistingPrompts: existingSubphases.prompts.length > 0,
            directory: existingSubphases.dirPath,
            implementationPhasesPath: existingSubphases.implementationPhasesPath,
            manifestPath: existingSubphases.manifestPath,
            acceptancePath: existingSubphases.acceptancePath,
            accessMatrixPath: existingSubphases.accessMatrixPath,
            subphasesCount: existingSubphases.subphases.length,
            subphases: existingSubphases.subphases,
            prompts: existingSubphases.prompts,
          }
        : {
            hasExistingPrompts: false,
            subphasesCount: 0,
            subphases: [],
            prompts: [],
          },
    };
  }

  if (mode === "next_ready_phase") {
    const readyPhases = phases.filter((phase) => {
      if (completedPhases.has(phase.wbs)) return false;
      const deps = Array.isArray(phase.technical_dependencies) ? phase.technical_dependencies : [];
      return deps.every((dep) => completedPhases.has(dep));
    });
    const nextPhase = readyPhases[0] ?? null;
    const decomposition = nextPhase ? discoverSubphaseDirectories(projectRoot, nextPhase.wbs) : null;
    return {
      completedCount: completedPhases.size,
      totalPhases: phases.length,
      allCompleted: completedPhases.size >= phases.length,
      nextPhase: nextPhase
        ? {
            wbs: nextPhase.wbs,
            name: nextPhase.name,
            likelyHours: nextPhase.likely ?? 0,
            workPackagesCount: (nextPhase.subtasks ?? []).length,
            workPackages: nextPhase.subtasks ?? [],
            technicalDependencies: nextPhase.technical_dependencies ?? [],
            hasExistingSubphasePrompts: Boolean(decomposition && decomposition.prompts.length > 0),
            existingDecompositionDir: decomposition?.dirPath,
            prompts: decomposition?.prompts ?? [],
          }
        : null,
      readyQueue: readyPhases.map((p) => p.wbs),
    };
  }

  const totalWorkPackages = phases.reduce((sum, p) => sum + (p.subtasks?.length ?? 0), 0);
  const totalLikelyHours = phases.reduce((sum, p) => sum + (p.likely ?? 0), 0);

  return {
    assessedOn: rawSchedule.assessed_on ?? "2026-11-03",
    basisCommit: rawSchedule.commit ?? "",
    startDate: rawSchedule.start ?? "2026-11-04",
    capacity: rawSchedule.capacity ?? {},
    totalPhases: phases.length,
    totalWorkPackages,
    totalLikelyHours,
    phases: phases.map((phase, index) => {
      const decomposition = discoverSubphaseDirectories(projectRoot, phase.wbs);
      return {
        order: index + 1,
        wbs: phase.wbs,
        name: phase.name,
        likelyHours: phase.likely ?? 0,
        workPackagesCount: (phase.subtasks ?? []).length,
        technicalDependencies: phase.technical_dependencies ?? [],
        acceptance: phase.acceptance ?? "",
        hasSubphaseDecomposition: Boolean(decomposition && decomposition.subphases.length > 0),
        subphasesCount: decomposition?.subphases.length ?? 0,
        decompositionDir: decomposition?.dirPath ?? null,
      };
    }),
  };
}

/**
 * Extracts employer/client requirements, acceptance scenarios, role access boundaries,
 * bilingual rules, and subphase prompts for a target phase/subphase.
 */
export function executeEmployerRequirementsExtractor(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const projectRoot = resolveProjectRoot(configuration, input);
  const phaseId = String(input.phaseId ?? "A.6").trim();
  const subphaseId = typeof input.subphaseId === "string" && input.subphaseId.trim()
    ? input.subphaseId.trim()
    : undefined;

  const planSummary = executeDeliveryPlanReader(configuration, {
    ...input,
    projectRoot,
    mode: "phase",
    phaseId,
  });

  const decomposition = discoverSubphaseDirectories(projectRoot, phaseId);
  let matchedSubphase: Record<string, unknown> | undefined;
  let matchedPromptMeta: Record<string, unknown> | undefined;
  let promptMarkdownExcerpt: string | undefined;
  let acceptanceExcerpt: string | undefined;
  let accessMatrixExcerpt: string | undefined;

  if (decomposition) {
    if (subphaseId) {
      matchedSubphase = decomposition.subphases.find(
        (item) => String(item.id ?? item.phase ?? "").toLowerCase() === subphaseId.toLowerCase(),
      );
      matchedPromptMeta = decomposition.prompts.find(
        (item) => String(item.phase ?? item.id ?? "").toLowerCase() === subphaseId.toLowerCase(),
      );
    } else {
      matchedSubphase = decomposition.subphases[0];
      matchedPromptMeta = decomposition.prompts[0];
    }

    const promptPath = typeof matchedPromptMeta?.absolutePromptPath === "string"
      ? matchedPromptMeta.absolutePromptPath
      : undefined;
    if (promptPath && fs.existsSync(promptPath)) {
      promptMarkdownExcerpt = fs.readFileSync(promptPath, "utf8").slice(0, 24_000);
    }
    if (decomposition.acceptancePath && fs.existsSync(decomposition.acceptancePath)) {
      acceptanceExcerpt = fs.readFileSync(decomposition.acceptancePath, "utf8").slice(0, 16_000);
    }
    if (decomposition.accessMatrixPath && fs.existsSync(decomposition.accessMatrixPath)) {
      accessMatrixExcerpt = fs.readFileSync(decomposition.accessMatrixPath, "utf8").slice(0, 16_000);
    }
  }

  let specExcerpt: string | undefined;
  if (typeof input.featureDir === "string" && input.featureDir.trim()) {
    const resolvedFeatureDir = safeResolveWithinRoot(projectRoot, input.featureDir.trim());
    const specFile = path.join(resolvedFeatureDir, "spec.md");
    if (fs.existsSync(specFile)) {
      specExcerpt = fs.readFileSync(specFile, "utf8").slice(0, 16_000);
    }
  }

  return {
    phaseId,
    subphaseId: subphaseId ?? (matchedSubphase?.id as string | undefined) ?? null,
    phasePlan: planSummary,
    subphaseDefinition: matchedSubphase ?? null,
    promptMetadata: matchedPromptMeta ?? null,
    promptMarkdown: promptMarkdownExcerpt ?? null,
    acceptanceCriteriaDoc: acceptanceExcerpt ?? null,
    moduleAccessMatrixDoc: accessMatrixExcerpt ?? null,
    activeSpecMarkdown: specExcerpt ?? null,
    mandatoryEndUserPersonas: [
      { role: "system_admin", scope: "global", verify: "Full admin governance without unintended cross-project data leakage" },
      { role: "project_manager_project_a", scope: "project_a", verify: "Authorized CRUD, role/team delegation, workflow transitions in Project A only" },
      { role: "project_manager_project_b", scope: "project_b", verify: "Zero visibility or mutation on Project A entities via UI or direct URL/API" },
      { role: "multi_role_project_member", scope: "project_a", verify: "Effective permissions reflect union + explicit grant/deny overrides" },
      { role: "project_viewer_or_visitor", scope: "read_only", verify: "Strict 403 / disabled write controls across both modern and legacy endpoints" },
      { role: "suspended_or_inactive_member", scope: "revoked", verify: "Immediate session/API denial while preserving historical audit trail" },
    ],
    mandatoryVerificationDimensions: [
      "Positive end-to-end happy-path workflows in real browser UI",
      "Negative permission & cross-project isolation (UI hidden/disabled + direct URL/API 403/404)",
      "Form validation, duplicate conflict (409), and edge-case inputs",
      "Bilingual UI & error message integrity (Persian RTL + English LTR, zero raw i18n keys)",
      "Database persistence & reload consistency (hard refresh preserves exact state)",
      "Zero unhandled console errors or 5xx API responses during all scenarios",
    ],
  };
}

/**
 * Inspects `.specify/` and `specs/<feature>/` (`spec.md`, `plan.md`, `tasks.md`),
 * counting completed vs open tasks and `## Phase N: Convergence` sections.
 */
export function executeSpecKitWorkspaceInspector(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const projectRoot = resolveProjectRoot(configuration, input);
  const specifyDir = path.join(projectRoot, ".specify");
  const featureJsonPath = path.join(specifyDir, "feature.json");

  let activeFeatureFromConfig: string | undefined;
  if (fs.existsSync(featureJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(featureJsonPath, "utf8")) as Record<string, unknown>;
      const rawDir = parsed.feature_dir ?? parsed.featureDir ?? parsed.active_feature;
      if (typeof rawDir === "string" && rawDir.trim()) {
        activeFeatureFromConfig = rawDir.trim();
      }
    } catch {
      /* ignore */
    }
  }

  const requestedFeature = typeof input.featureDir === "string" && input.featureDir.trim()
    ? input.featureDir.trim()
    : activeFeatureFromConfig;

  const specsRoot = path.join(projectRoot, "specs");
  const availableSpecs = fs.existsSync(specsRoot) && fs.statSync(specsRoot).isDirectory()
    ? fs.readdirSync(specsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `specs/${d.name}`)
        .sort()
    : [];

  if (!requestedFeature) {
    return {
      specifyConfigured: fs.existsSync(specifyDir),
      featureDir: null,
      availableSpecs,
      verdict: "needs_specify",
    };
  }

  const resolvedFeatureDir = safeResolveWithinRoot(projectRoot, requestedFeature);
  const specPath = path.join(resolvedFeatureDir, "spec.md");
  const planPath = path.join(resolvedFeatureDir, "plan.md");
  const tasksPath = path.join(resolvedFeatureDir, "tasks.md");

  const specExists = fs.existsSync(specPath);
  const planExists = fs.existsSync(planPath);
  const tasksExists = fs.existsSync(tasksPath);

  const completedTasks: string[] = [];
  const incompleteTasks: string[] = [];
  const convergenceHeaders: string[] = [];
  const openConvergenceTasks: string[] = [];

  if (tasksExists) {
    const lines = fs.readFileSync(tasksPath, "utf8").split(/\r?\n/);
    let inConvergenceSection = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^##+\s+.*convergence/i.test(trimmed)) {
        inConvergenceSection = true;
        convergenceHeaders.push(trimmed);
        continue;
      }
      if (/^##\s+/.test(trimmed) && !/convergence/i.test(trimmed)) {
        inConvergenceSection = false;
      }
      const unchecked = /^-\s*\[\s\]\s+(.+)$/.exec(trimmed);
      if (unchecked) {
        incompleteTasks.push(unchecked[1]);
        if (inConvergenceSection) openConvergenceTasks.push(unchecked[1]);
        continue;
      }
      const checked = /^-\s*\[[xX]\]\s+(.+)$/.exec(trimmed);
      if (checked) {
        completedTasks.push(checked[1]);
      }
    }
  }

  const totalTasks = completedTasks.length + incompleteTasks.length;
  const converged = specExists && planExists && tasksExists && totalTasks > 0 && incompleteTasks.length === 0;

  return {
    specifyConfigured: fs.existsSync(specifyDir),
    featureDir: path.relative(projectRoot, resolvedFeatureDir) || ".",
    absoluteFeatureDir: resolvedFeatureDir,
    artifacts: {
      specExists,
      planExists,
      tasksExists,
    },
    totalTasks,
    completedTasksCount: completedTasks.length,
    incompleteTasksCount: incompleteTasks.length,
    incompleteTasks: incompleteTasks.slice(0, 50),
    convergenceSectionsCount: convergenceHeaders.length,
    convergenceHeaders,
    openConvergenceTasksCount: openConvergenceTasks.length,
    openConvergenceTasks: openConvergenceTasks.slice(0, 50),
    verdict: !specExists
      ? "needs_specify"
      : !planExists
        ? "needs_plan"
        : !tasksExists
          ? "needs_tasks"
          : converged
            ? "converged"
            : "continue_implement",
    branch: converged ? "converged" : "continue_implement",
  };
}

function assertLoopbackUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol "${parsed.protocol}" in browser QA probe.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`Browser QA probe only permits loopback targets (localhost / 127.0.0.1); rejected "${host}".`);
  }
  return parsed;
}

/**
 * Probes local frontend/backend endpoints safely on loopback, checks installed browser
 * automation capabilities (Chrome, Playwright, npx), and discovers prior browser audit reports.
 */
export async function executeBrowserQaProbe(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const projectRoot = resolveProjectRoot(configuration, input);
  const frontendUrlRaw = String(input.frontendUrl ?? configuration.frontendUrl ?? "http://127.0.0.1:5173").trim();
  const backendUrlRaw = String(input.backendUrl ?? configuration.backendUrl ?? "http://127.0.0.1:8000").trim();

  const frontendUrl = assertLoopbackUrl(frontendUrlRaw);
  const backendUrl = assertLoopbackUrl(backendUrlRaw);

  const probeEndpoint = async (url: URL) => {
    const probeSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(4_000)])
      : AbortSignal.timeout(4_000);
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: probeSignal,
      });
      return {
        reachable: true,
        status: response.status,
        url: url.toString(),
      };
    } catch (error) {
      return {
        reachable: false,
        status: 0,
        url: url.toString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const [frontendProbe, backendProbe] = await Promise.all([
    probeEndpoint(frontendUrl),
    probeEndpoint(backendUrl),
  ]);

  const outputDir = path.join(projectRoot, "output");
  const priorBrowserAudits: string[] = [];
  if (fs.existsSync(outputDir) && fs.statSync(outputDir).isDirectory()) {
    for (const sub of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const subPath = path.join(outputDir, sub.name);
      for (const file of fs.readdirSync(subPath)) {
        if (file.startsWith("browser-audit-") && file.endsWith(".md")) {
          priorBrowserAudits.push(path.join("output", sub.name, file));
        }
      }
    }
  }

  return {
    frontend: frontendProbe,
    backend: backendProbe,
    browserCapabilities: {
      googleChromeAvailable: cliExecutableAvailable("google-chrome"),
      playwrightCliAvailable: cliExecutableAvailable("playwright") || cliExecutableAvailable("npx"),
    },
    priorBrowserAudits: priorBrowserAudits.sort(),
    readyForEndUserSession: frontendProbe.reachable && backendProbe.reachable,
  };
}
