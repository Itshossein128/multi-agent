export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  source: string;
  status?: "Current" | "Planned" | "Reference";
};

export const docPages: DocPage[] = [
  { slug: "getting-started", title: "Getting started", description: "Install the platform, create an account and complete your first run.", group: "Start here", source: "README.md", status: "Current" },
  { slug: "first-workflow", title: "Your first workflow", description: "A guided, end-to-end tutorial: agent, graph, task, run and result.", group: "Start here", source: "apps/web/src/app/(authenticated)/org/page.tsx", status: "Current" },
  { slug: "concepts", title: "Core concepts", description: "Learn how organizations, agents, workflows, tasks and runs fit together.", group: "Learn the model", source: "docs/architecture.md", status: "Current" },
  { slug: "architecture", title: "Architecture", description: "The control plane, execution server, LangGraph runtime and persistence boundaries.", group: "Learn the model", source: "docs/architecture.md", status: "Current" },
  { slug: "security", title: "Security model", description: "Trust boundaries, authorization, worker isolation and fail-closed behavior.", group: "Learn the model", source: "docs/architecture.md", status: "Current" },
  { slug: "account-and-workspace", title: "Account & workspace", description: "Sign in, understand the workspace shell and keep organization data isolated.", group: "Build with Studio", source: "apps/web/src/app/(authenticated)/layout.tsx", status: "Current" },
  { slug: "agents", title: "Create an agent", description: "Register an agent, choose a backend and configure runtime behavior.", group: "Build with Studio", source: "apps/web/src/app/(authenticated)/org/agents/page.tsx", status: "Current" },
  { slug: "workflows", title: "Design workflows", description: "Use the visual editor to connect agents, tools, conditions and outputs.", group: "Build with Studio", source: "apps/web/src/components/workflow/WorkflowEditor.tsx", status: "Current" },
  { slug: "tasks", title: "Manage tasks", description: "Create work items, assign workflows and move them through the task board.", group: "Build with Studio", source: "apps/web/src/app/(authenticated)/tasks/page.tsx", status: "Current" },
  { slug: "tools-and-approvals", title: "Tools & approvals", description: "Register capabilities and safely pause execution for human decisions.", group: "Build with Studio", source: "docs/phase-6-tools.md", status: "Current" },
  { slug: "memory", title: "Memory Explorer", description: "Store, search and inspect tenant-aware long-term memory.", group: "Build with Studio", source: "apps/web/src/app/(authenticated)/org/memory/page.tsx", status: "Current" },
  { slug: "runs", title: "Monitor runs", description: "Read live execution events, inspect outcomes and replay history.", group: "Operate Studio", source: "apps/web/src/app/(authenticated)/runs/page.tsx", status: "Current" },
  { slug: "persistence", title: "Persistence & recovery", description: "Understand what survives restart and how queued or paused work recovers.", group: "Operate Studio", source: "docs/phase-9-persistence.md", status: "Current" },
  { slug: "workers", title: "CLI workers", description: "Run trusted local agents or isolated container workers with explicit boundaries.", group: "Operate Studio", source: "docs/cli-worker-image.md", status: "Current" },
  { slug: "credentials", title: "Credential Broker", description: "Short-lived provider leases, policy enforcement, audit and mTLS boundaries.", group: "Operate Studio", source: "docs/deferred-credential-gateway.md", status: "Current" },
  { slug: "development", title: "Development guide", description: "Environment setup, database migrations and verification commands.", group: "Reference", source: "docs/development.md", status: "Current" },
  { slug: "deployment", title: "Deployment checklist", description: "Move from local development to a controlled production deployment.", group: "Reference", source: "docs/production-saas-readiness-gaps.md", status: "Reference" },
  { slug: "troubleshooting", title: "Troubleshooting", description: "Diagnose auth, database, workflow, provider and recovery issues.", group: "Reference", source: "docs/verification.md", status: "Current" },
  { slug: "limitations", title: "Limitations & roadmap", description: "Known gaps, deployment boundaries and the next product milestones.", group: "Reference", source: "docs/implementation-gaps.md", status: "Reference" },
];

export const groups = ["Start here", "Learn the model", "Build with Studio", "Operate Studio", "Reference"];

export function getDoc(slug: string) {
  return docPages.find((page) => page.slug === slug);
}
