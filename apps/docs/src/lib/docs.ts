export type DocOverviewItem = {
  label: string;
  value: string;
};

export type DocSectionItem = {
  title: string;
  body: string;
  bullets?: string[];
  code?: string;
  note?: string;
};

export type LocalizedSection = {
  title: string;
  intro: string;
  overview?: DocOverviewItem[];
  code?: string;
  items: DocSectionItem[];
  callout?: {
    title: string;
    body: string;
  };
};

export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  source: string;
  status?: "Current" | "Planned" | "Reference";
};

export const docPages: DocPage[] = [
  // Start here
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Install prerequisites, configure environment files, start the stack and complete onboarding.",
    group: "Start here",
    source: "README.md",
    status: "Current",
  },
  {
    slug: "running-the-platform",
    title: "Ways to run",
    description: "Every supported way to start Studio, the CLI, workers, the broker and supporting services.",
    group: "Start here",
    source: "docs/development.md",
    status: "Current",
  },
  {
    slug: "first-workflow",
    title: "Your first workflow",
    description: "A guided, end-to-end tutorial: project, agent, visual graph, task, human approval and run timeline.",
    group: "Start here",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/org/page.tsx",
    status: "Current",
  },

  // Learn the model
  {
    slug: "concepts",
    title: "Core concepts",
    description: "How organizations, projects, workspaces, agents, tools, workflows, tasks, goals and runs fit together.",
    group: "Learn the model",
    source: "docs/architecture.md",
    status: "Current",
  },
  {
    slug: "architecture",
    title: "Architecture",
    description: "The Next.js control plane, Hono execution server, LangGraph compiler and persistence boundaries.",
    group: "Learn the model",
    source: "docs/architecture.md",
    status: "Current",
  },
  {
    slug: "security",
    title: "Security model",
    description: "Trust boundaries, RBAC, PostgreSQL RLS, zero-secret domain records, worker sandboxes and fail-closed defaults.",
    group: "Learn the model",
    source: "docs/architecture.md",
    status: "Current",
  },

  // Build with Studio
  {
    slug: "account-and-workspace",
    title: "Account, orgs & navigation",
    description: "Sign in, complete organization onboarding, invite members, manage roles and navigate the Studio shell.",
    group: "Build with Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/settings/page.tsx",
    status: "Current",
  },
  {
    slug: "projects-and-workspaces",
    title: "Projects & workspaces",
    description: "Create projects, attach Git repositories, configure branch overrides and manage execution workspaces.",
    group: "Build with Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/projects/[projectId]/page.tsx",
    status: "Current",
  },
  {
    slug: "agents",
    title: "Create & configure agents",
    description: "Register agents across API, CLI, Local, Process and Webhook backends, set guardrails, heartbeats and test live.",
    group: "Build with Studio",
    source: "apps/web/src/components/agents/AgentDetail.tsx",
    status: "Current",
  },
  {
    slug: "workflows",
    title: "Design visual workflows",
    description: "Master all 10 node types, 4 workflow archetypes, step overrides, live canvas runs and workspace packages.",
    group: "Build with Studio",
    source: "apps/web/src/components/workflow/WorkflowEditor.tsx",
    status: "Current",
  },
  {
    slug: "tasks",
    title: "Manage tasks & board",
    description: "Create tasks linked to projects and workspaces, set dependencies, filter the Kanban board and control runs.",
    group: "Build with Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/tasks/page.tsx",
    status: "Current",
  },
  {
    slug: "tools-and-approvals",
    title: "Tools & approvals",
    description: "Register reusable tools, test schemas and pause workflows at human approval gates.",
    group: "Build with Studio",
    source: "docs/phase-6-tools.md",
    status: "Current",
  },
  {
    slug: "memory",
    title: "Memory Explorer",
    description: "Store, search and inspect tenant-aware semantic, episodic and procedural memory across scopes.",
    group: "Build with Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/org/memory/page.tsx",
    status: "Current",
  },

  // Operate Studio
  {
    slug: "goals-and-delegation",
    title: "Goals & delegation",
    description: "Define agent reporting lines (CEO, Manager, Member), propose strategy and delegate goals into tasks.",
    group: "Operate Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/organization/page.tsx",
    status: "Current",
  },
  {
    slug: "routines-and-webhooks",
    title: "Routines & webhooks",
    description: "Schedule cron/interval routines with misfire policies and trigger workflows from HMAC-signed webhooks.",
    group: "Operate Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/routines/page.tsx",
    status: "Current",
  },
  {
    slug: "budgets-and-costs",
    title: "Budgets & cost control",
    description: "Set monthly USD caps for your company, agents and projects with pre-execution spend reservation.",
    group: "Operate Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/budgets/page.tsx",
    status: "Current",
  },
  {
    slug: "runs",
    title: "Monitor & replay runs",
    description: "Use the live dashboard, filter run history, inspect node timelines, resolve approvals and replay executions.",
    group: "Operate Studio",
    source: "apps/web/src/app/(authenticated)/o/[orgSlug]/runs/[runId]/page.tsx",
    status: "Current",
  },
  {
    slug: "persistence",
    title: "Persistence & recovery",
    description: "Understand what survives a server restart and how queued or paused runs recover from snapshots.",
    group: "Operate Studio",
    source: "docs/phase-9-persistence.md",
    status: "Current",
  },
  {
    slug: "workers",
    title: "CLI workers",
    description: "Run trusted local CLI agents or isolated rootless container workers with explicit security boundaries.",
    group: "Operate Studio",
    source: "docs/cli-worker-image.md",
    status: "Current",
  },
  {
    slug: "credentials",
    title: "Credential Broker",
    description: "Issue short-lived single-use provider leases with policy enforcement, hash-chained audit and mTLS.",
    group: "Operate Studio",
    source: "docs/deferred-credential-gateway.md",
    status: "Current",
  },

  // Reference
  {
    slug: "development",
    title: "Development guide",
    description: "Monorepo layout, environment variable catalog, database migrations and verification test suites.",
    group: "Reference",
    source: "docs/development.md",
    status: "Current",
  },
  {
    slug: "deployment",
    title: "Deployment checklist",
    description: "Step-by-step release checklist to promote Multi-Agent Studio from local dev to production.",
    group: "Reference",
    source: "docs/production-saas-readiness-gaps.md",
    status: "Reference",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description: "Symptom-to-fix playbooks for auth, workflow validation, blocked tasks, approvals, budgets and workers.",
    group: "Reference",
    source: "docs/verification.md",
    status: "Current",
  },
  {
    slug: "limitations",
    title: "Limitations & roadmap",
    description: "What is proven in automated suites, what is deployment-specific and what is on the roadmap.",
    group: "Reference",
    source: "docs/implementation-gaps.md",
    status: "Reference",
  },
];

export const groups = [
  "Start here",
  "Learn the model",
  "Build with Studio",
  "Operate Studio",
  "Reference",
];

export function getDoc(slug: string) {
  return docPages.find((page) => page.slug === slug);
}
