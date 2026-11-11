import type { LocalizedSection } from "./docs";

export const enSections: Record<string, LocalizedSection> = {
  "getting-started": {
    title: "Getting started",
    intro:
      "Welcome to Multi-Agent Studio. This step-by-step guide walks you through installing prerequisites, configuring environment files, starting PostgreSQL and the application stack, creating your user account, and completing organization onboarding.",
    overview: [
      { label: "Studio Web UI", value: "http://localhost:3060" },
      { label: "Execution Server", value: "http://localhost:4000" },
      { label: "Documentation Site", value: "http://localhost:3070" },
      { label: "Local PostgreSQL", value: "127.0.0.1:55432 (pgvector/pg16)" },
    ],
    code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
    items: [
      {
        title: "1. Prerequisites",
        body: "Make sure the following tools are installed on your machine before cloning and running the workspace:",
        bullets: [
          "Node.js 20+ (LTS recommended) and pnpm 10.17.0 (corepack enable).",
          "Docker Desktop or Docker Engine (used to run the local PostgreSQL 16 + pgvector database container, or to run isolated container CLI workers).",
          "Git (required for repository management and workspace checkouts).",
          "At least one AI provider API key (OpenAI, Anthropic, or Google Gemini) or a local model server (Ollama / LM Studio) if you want live LLM completions.",
        ],
      },
      {
        title: "2. Configure environment files",
        body: "Multi-Agent Studio separates browser control-plane configuration from execution-server secrets. Next.js in apps/web does not automatically read the repository root .env, so configure both files explicitly:",
        bullets: [
          "Copy relevant variables from the root .env.example into apps/server/.env for the Hono execution server.",
          "Create apps/web/.env.local for the Next.js web app and BFF (Backend-for-Frontend).",
          "Set identical database URLs (MEMORY_DATABASE_URL) and shared BFF assertion secrets so the web app and execution server can authenticate requests.",
          "Never commit real API keys or secrets to Git.",
        ],
        code: `# apps/web/.env.local
AUTH_SECRET="replace-with-32-byte-random-secret"
MEMORY_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"
EXECUTION_SERVER_URL="http://localhost:4000"
NEXT_PUBLIC_ORG_MEMORY_SCOPE="true"

# apps/server/.env
PORT=4000
STUDIO_STORE="postgres"
MEMORY_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"
OPENAI_API_KEY="sk-..."`,
        note: "In local development, you can also run pnpm db:seed:dev after migrating to populate sample development data.",
      },
      {
        title: "3. Start PostgreSQL, run migrations, and launch Studio",
        body: "Database migrations are explicit and never run silently inside application startup. Run the commands below from the repository root:",
        bullets: [
          "pnpm db:dev:up starts the PostgreSQL 16 + pgvector container on 127.0.0.1:55432.",
          "pnpm db:migrate applies both the memory schema and the Studio control-plane schema.",
          "pnpm dev builds @multi-agent/types and starts Web (3060), Server (4000), and Docs (3070) in parallel.",
        ],
        code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
      },
      {
        title: "4. Register your account and create an organization",
        body: "Open http://localhost:3060 in your browser to complete your first-time setup:",
        bullets: [
          "Go to /register and create an account with your name, email address, and password.",
          "Sign in at /login. On first login without an organization, Studio redirects you to /onboarding/organization.",
          "In the Organization Onboarding Wizard, enter your Organization Name (e.g. Acme Studio), an optional description, Default Timezone (e.g. UTC), and choose whether members can invite others.",
          "Click Create organization. Studio provisions your tenant boundary and redirects you to /o/<your-org-slug>/projects.",
        ],
      },
      {
        title: "5. Verify your installation",
        body: "Before shipping code or deploying, run the test and build checks from the repository root to confirm all packages and types compile cleanly:",
        code: "pnpm test --runInBand\npnpm --filter server build\npnpm --filter web build\npnpm build:docs",
      },
    ],
    callout: {
      title: "Ready for your first agentic run?",
      body: "Continue to Your first workflow for a guided 10-minute walkthrough that creates a project, registers an agent, builds a visual graph, and executes a task.",
    },
  },

  "running-the-platform": {
    title: "Ways to run the platform",
    intro:
      "Multi-Agent Studio can run as a full local web stack, individual microservices, compiled production processes, a standalone Credential Broker, container CLI workers, or the classic root CLI orchestrator. Pick the start path that matches what you want to do.",
    overview: [
      { label: "Recommended Dev Command", value: "pnpm dev" },
      { label: "Studio Without Docs", value: "pnpm dev:all" },
      { label: "Standalone Broker", value: "Port 8484 (src/broker/server.ts)" },
      { label: "Root CLI Engine", value: "pnpm dev:cli -- start \"...\"" },
    ],
    code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
    items: [
      {
        title: "1. Full local Studio stack (recommended)",
        body: "Builds shared workspace types (@multi-agent/types), then launches the Next.js Web app (port 3060), Hono Execution Server (port 4000), and Docs app (port 3070) in parallel.",
        code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
      },
      {
        title: "2. Studio without the docs site",
        body: "Use when you only need the Studio web UI (port 3060) and execution server (port 4000).",
        code: "pnpm db:dev:up\npnpm db:migrate\npnpm dev:all",
      },
      {
        title: "3. Individual services during development",
        body: "Start any package on its own when debugging or iterating on a single surface:",
        bullets: [
          "pnpm build:types — compiles @multi-agent/types (run once before starting individual apps).",
          "pnpm dev:web — starts the Next.js control plane on http://localhost:3060.",
          "pnpm dev:server — starts the Hono execution server on http://localhost:4000.",
          "pnpm dev:docs — starts this documentation app on http://localhost:3070.",
        ],
        code: "pnpm build:types\npnpm dev:server   # Terminal 1 (http://localhost:4000)\npnpm dev:web      # Terminal 2 (http://localhost:3060)\npnpm dev:docs     # Terminal 3 (http://localhost:3070)",
      },
      {
        title: "4. Production-like compiled starts",
        body: "Compile TypeScript and Next.js bundles first, then run the production servers. This is the closest local check to a real deployment layout:",
        code: "pnpm --filter server build && pnpm --filter server start\npnpm --filter web build && pnpm --filter web start\npnpm build:docs && pnpm start:docs",
      },
      {
        title: "5. Database lifecycle, seeding, and reset",
        body: "Manage the local PostgreSQL 16 (pgvector) container and schemas with these root scripts:",
        bullets: [
          "pnpm db:dev:up — starts the Docker Compose PostgreSQL service on 127.0.0.1:55432.",
          "pnpm db:migrate — runs infrastructure/memory/migrate.cjs and infrastructure/studio/migrate.cjs.",
          "pnpm db:seed:dev — seeds development fixtures for quick testing.",
          "pnpm db:reset — resets the local database cleanly.",
          "pnpm db:dev:down — stops and removes the local database container.",
        ],
        code: "pnpm db:dev:up\npnpm db:migrate\npnpm db:seed:dev\n# To reset or stop:\npnpm db:reset\npnpm db:dev:down",
      },
      {
        title: "6. Standalone Credential Broker",
        body: "The Credential Broker issues short-lived, single-use credential leases (default port 8484). It is not started by pnpm dev. Without CREDENTIAL_BROKER_DATABASE_URL it uses in-memory stores; in production it uses PostgreSQL, HashiCorp Vault, and mTLS.",
        code: `CREDENTIAL_BROKER_SERVICE_TOKENS=dev:local-dev-token \\
CREDENTIAL_BROKER_PORT=8484 \\
npx ts-node src/broker/server.ts

# Apply durable broker tables (optional locally, required in production):
CREDENTIAL_BROKER_DATABASE_URL=postgresql://... node infrastructure/broker/migrate.cjs`,
      },
      {
        title: "7. Root CLI workflow engine",
        body: "Separate from the Studio web/server stack, the root multi-agent CLI runs the classic software-delivery orchestrator graph directly from your terminal using variables in the root .env file.",
        code: `pnpm dev:cli -- start "Build a hello-world REST API"\n# Or after pnpm build:\npnpm start -- start "Build a hello-world REST API"`,
      },
      {
        title: "8. Legacy Docker Compose (CLI + Langfuse + LangFlow)",
        body: "Located at infrastructure/docker/docker-compose.yml. This starts the root CLI container alongside Langfuse (port 3001) and LangFlow (port 7860) and is distinct from the Studio web/server stack.",
        code: "docker compose -f infrastructure/docker/docker-compose.yml up",
      },
      {
        title: "9. CLI workers (local trusted vs isolated container)",
        body: "When running CLI-backed agents (Codex, Claude Code, Cursor agent, Antigravity agy), choose local mode only for trusted code or container mode for untrusted code isolation:",
        code: `pnpm worker:image:build
pnpm worker:image:smoke
pnpm worker:e2e:multi-agent-workflow

# Optional helper to write an isolated Codex auth file for worker delivery:
pnpm credentials:login-codex
pnpm credentials:status-codex`,
      },
      {
        title: "10. Supporting maintenance and verification scripts",
        body: "Run memory benchmarks, embedding backfills, load tests, and end-to-end browser tests with the built-in scripts:",
        code: `pnpm memory:backfill-embeddings
pnpm memory:eval
pnpm memory:benchmark
pnpm verification:load
pnpm verification:docker
pnpm verification:real-tools
pnpm --filter web test:e2e`,
      },
    ],
  },

  "first-workflow": {
    title: "Your first workflow (End-to-End Tutorial)",
    intro:
      "Follow this hands-on tutorial to go from a fresh installation to a complete, multi-step workflow execution. You will create a project, register and test an agent, build a visual workflow with a human approval gate, run it on a task, and inspect the live timeline.",
    overview: [
      { label: "Time Required", value: "~10 minutes" },
      { label: "Step 1–2", value: "Project & Agent (/o/<slug>/projects, /org/agents)" },
      { label: "Step 3", value: "Visual Graph (/o/<slug>/org)" },
      { label: "Step 4–5", value: "Task & Run (/o/<slug>/tasks, /runs)" },
    ],
    items: [
      {
        title: "Step 1: Create a Project",
        body: "Every task in Studio belongs to a project (and optionally a project workspace).",
        bullets: [
          "In the left sidebar under Work, click Projects (/o/<orgSlug>/projects).",
          "Enter a project name such as Customer Portal v1 and click Create.",
          "Click the newly created project to view its dashboard. By default, it uses a project-level default workspace until you add explicit workspaces or repositories.",
        ],
      },
      {
        title: "Step 2: Register and test your first Agent",
        body: "Agents are reusable execution configurations stored in your organization's Agent Registry.",
        bullets: [
          "In the left sidebar under Orchestration, click Org (/o/<orgSlug>/org), or navigate directly to /o/<orgSlug>/org/agents.",
          "In the left Node Palette of the workflow editor (or on the Agent Registry page), click Create agent.",
          "On the Agent Detail page, click Edit agent, switch to the Configuration tab, set Name to Architecture Reviewer, and enter a System Prompt (e.g. 'You are a senior software architect. Summarize the design and highlight risks in 3 bullet points.').",
          "Switch to the Backend tab: choose Backend type = API, Provider = openai (or anthropic / google / local), and enter a model name (or leave blank for runtime default).",
          "Click Save at the top right.",
          "Switch to the Test tab, keep the sample JSON input { \"input\": \"Say hello in one sentence.\" }, and click Test agent to verify your backend credentials work before building a graph.",
        ],
      },
      {
        title: "Step 3: Build a visual workflow in the Graph Editor",
        body: "Now connect your agent into an executable LangGraph workflow.",
        bullets: [
          "Click ← Back to Graph Editor (/o/<orgSlug>/org).",
          "In the top bar, click New workflow, name it Architecture Review Pipeline, keep the Linear Pipeline archetype selected, and click Create.",
          "From the left Node Palette, add an Input node, your Architecture Reviewer agent (under Agents), an Approval node (Human Approval), and an Output node.",
          "Drag handles on the canvas to connect: Input → Architecture Reviewer → Approval → Output.",
          "Select the edge from Approval to Output: in the right Properties Panel, set Edge Type = Conditional and Branch Key = approved.",
          "Select the Architecture Reviewer node on the canvas: in the right Properties Panel, add Step Instructions such as 'Review the user requirement and propose an implementation plan.'",
          "Click Validate in the toolbar to confirm 0 errors, then press Ctrl+S (or Cmd+S) to save.",
        ],
      },
      {
        title: "Step 4: Run directly on the Live Canvas or via the Task Board",
        body: "You can test your workflow immediately in the editor or dispatch it as a tracked task:",
        bullets: [
          "Option A (Live Canvas): In the Editor Toolbar at the top right, choose Text input mode, type 'Design a webhook retry queue', and click the Play (Run workflow) button. The canvas switches to Live · Read only mode and highlights each node as it executes!",
          "Option B (Task Board): In the left sidebar under Work, click Tasks (/o/<orgSlug>/tasks). Click + Add task on the Backlog column, enter Title = 'Review webhook retry queue', select Project = Customer Portal v1, select Workflow = Architecture Review Pipeline, and click Create Task. Then click Start on the task card.",
        ],
      },
      {
        title: "Step 5: Approve the Human Gate and inspect the Run",
        body: "When execution reaches your Approval node, LangGraph checkpoints the state and pauses the run with status waiting_for_human:",
        bullets: [
          "If you are watching on the Live Canvas, a Live Approval Banner appears at the top of the canvas. Click Approve (or open the Run page).",
          "Or go to Runs (/o/<orgSlug>/runs), click your active run, review the bounded proposal in the Approval Panel, and click Approve.",
          "The workflow resumes from the exact checkpoint without re-running the LLM call, traverses the approved edge to the Output node, and marks the run completed!",
          "Click any node on the Live Canvas (or inspect the Event Timeline on the Run page) to read the exact inputs, outputs, latency, and token usage.",
        ],
      },
    ],
    callout: {
      title: "What to explore next",
      body: "Now that you have completed a linear pipeline, check out Design visual workflows to learn about Hierarchical Supervisor, Evaluator-Optimizer, and Autonomous Swarm archetypes.",
    },
  },

  concepts: {
    title: "Core concepts",
    intro:
      "Multi-Agent Studio is built around a clean set of domain nouns. Understanding how Organizations, Projects, Workspaces, Agents, Tools, Workflows, Tasks, Runs, and Governance entities relate makes every screen in the app intuitive.",
    overview: [
      { label: "Ownership Boundary", value: "Organization (tenantId)" },
      { label: "Code & Repo Scope", value: "Project → Project Workspace" },
      { label: "Reusable Capabilities", value: "Agent Registry & Tool Registry" },
      { label: "Execution Units", value: "Workflow → Task → Run" },
    ],
    items: [
      {
        title: "1. Organization (Tenant) and Roles",
        body: "The Organization is the top-level multi-tenant boundary (tenantId). Every URL inside Studio is scoped under /o/<orgSlug>/... and every database table enforces tenant isolation.",
        bullets: [
          "owner: Full control over the organization, members, billing/budgets, and organization deletion.",
          "admin: Can manage organization profile, invite/suspend members (except owners), and delete organization-scoped memories.",
          "member: Can create and edit projects, workspaces, agents, tools, workflows, tasks, routines, and webhooks.",
          "viewer: Read-only access to inspect workflows, runs, and dashboards.",
        ],
      },
      {
        title: "2. Project vs. Project Workspace vs. Studio Package",
        body: "Studio separates code/repository organization from workflow graph definitions:",
        bullets: [
          "Project (/o/<orgSlug>/projects): A product initiative or codebase container. Holds project-level settings, attached Git repositories (ProjectRepository), and linked tasks.",
          "Project Workspace (/o/<orgSlug>/workspaces): An isolated working environment under a project (e.g. 'Staging' or 'Feature branch lab'). Each workspace selects which project repositories to include, overrides their Git branches, tracks uncommitted file changes, and can override project JSON settings.",
          "Workflow Studio Workspace Package: A portable JSON bundle ({ version, workflows, agents, tools }) exported or imported from the Workflow Switcher bar in /o/<orgSlug>/org.",
        ],
      },
      {
        title: "3. Agent vs. Agent Node",
        body: "An Agent is a reusable record in the Agent Registry (/o/<orgSlug>/org/agents) that defines the backend (API, CLI, Local, Process, Webhook), model, base system prompt, assigned tools, memory config, execution policy, and optional heartbeat.",
        bullets: [
          "Multiple workflows—and multiple steps within the same workflow—can reference the same base Agent.",
          "Each Agent Node on a workflow canvas can define step-specific overrides (Step Instructions, temperature/token overrides, active tool subsets, and stateless vs. shared session mode) without mutating the shared Agent record.",
        ],
      },
      {
        title: "4. Tool and Human Approval Gate",
        body: "Capabilities and human-in-the-loop checkpoints are first-class citizens:",
        bullets: [
          "Tool (/o/<orgSlug>/org/tools): A server-governed capability with a category, impact level (low, medium, high, critical), and JSON input/output schemas. Assigned either to an Agent (for ReAct tool-calling loops) or placed directly on a workflow canvas as a Tool node.",
          "Approval Node: A workflow gate that pauses LangGraph execution (waiting_for_human) with a bounded proposal until an authorized operator approves or rejects it.",
        ],
      },
      {
        title: "5. Workflow and Archetype",
        body: "A Workflow is a directed graph of nodes and edges compiled by the execution server into a LangGraph StateGraph. Every workflow has an Archetype that governs its topology rules:",
        bullets: [
          "Linear Pipeline: Strict directed acyclic graph (DAG) with no cycles.",
          "Hierarchical Supervisor: A central Supervisor Hub agent routes work to specialist worker nodes with bounded recursion guards.",
          "Evaluator-Optimizer: A generator agent and evaluator agent iterate in a quality loop up to a maximum iteration ceiling.",
          "Autonomous Swarm: Peer agents hand off control dynamically within a bounded hop limit.",
        ],
      },
      {
        title: "6. Task vs. Run",
        body: "Tasks represent *what* needs to be done; Runs represent *an execution attempt*:",
        bullets: [
          "Task (/o/<orgSlug>/tasks): A Kanban work item linked to a project, workspace, workflow, or agent, with priority, dependencies (blockedBy), and status columns (backlog, in_progress, review, done).",
          "Run (/o/<orgSlug>/runs): Created whenever a workflow, task, routine, or webhook executes. Captures an immutable snapshot of the workflow, agents, and tools at start time, plus a real-time stream of RunEvents, approvals, and token/cost metrics.",
        ],
      },
      {
        title: "7. Goals, Routines, Webhooks, and Budgets",
        body: "Autonomous operations wrap around your agents and workflows:",
        bullets: [
          "Goals & Reporting Lines (/o/<orgSlug>/organization): Organize agents into a CEO → Manager → Member hierarchy, generate CEO strategy proposals, and delegate company goals into tracked tasks.",
          "Routines (/o/<orgSlug>/routines): Cron or interval schedules that trigger workflows or agents automatically.",
          "Webhooks (/o/<orgSlug>/webhooks): HMAC-SHA256 authenticated HTTP endpoints that trigger workflows or agents from GitHub, CI/CD, or external systems.",
          "Budgets (/o/<orgSlug>/budgets): Monthly USD spend caps at the Company, Agent, or Project level that reserve estimated cost before every invocation.",
        ],
      },
    ],
  },

  architecture: {
    title: "System architecture",
    intro:
      "Multi-Agent Studio is architected around strict separation of concerns: the Next.js browser app acts as the control plane, the Hono server enforces policy and compiles workflows into LangGraph state machines, PostgreSQL provides durable tenant-isolated storage, and the Credential Broker and Container Workers isolate secrets and untrusted execution.",
    overview: [
      { label: "Control Plane", value: "apps/web (Next.js 16 + Auth.js + BFF)" },
      { label: "Execution Boundary", value: "apps/server (Hono + LangGraph)" },
      { label: "Durable Storage", value: "PostgreSQL 16 + pgvector + RLS" },
      { label: "Secret & OS Isolation", value: "Credential Broker + Container Workers" },
    ],
    items: [
      {
        title: "1. Control Plane and BFF (apps/web)",
        body: "The Next.js application renders the authenticated UI and hosts the Backend-for-Frontend (BFF) API routes under /api/...",
        bullets: [
          "Authenticates users via Auth.js session cookies.",
          "Resolves organization membership (/o/[orgSlug]) against studio_organizations and studio_organization_memberships.",
          "Signs short-lived, HMAC-verified internal principal headers when forwarding requests to /api/o/[orgSlug]/execution/[...path] on the execution server.",
          "Never holds provider API keys or executes LLM/tool calls directly.",
        ],
      },
      {
        title: "2. Execution Server and Compiler (apps/server & src/)",
        body: "The Hono execution server is the single authority for validation, policy enforcement, compilation, and runtime orchestration:",
        bullets: [
          "Verifies the BFF principal assertion, tenant membership, and role permissions (RBAC).",
          "Validates workflow topology, node contracts, archetype constraints, and recursion guards.",
          "Compiles a saved WorkflowDefinition into an executable LangGraph StateGraph with checkpointing and interrupt/resume support.",
          "Streams sanitized RunEvent records back to the browser over Server-Sent Events (SSE).",
        ],
      },
      {
        title: "3. Runtime Subsystems",
        body: "Inside the execution boundary, dedicated runtime services handle each capability:",
        bullets: [
          "AgentRuntime & Executors: Dispatches agent steps to API providers (OpenAI, Anthropic, Google), local models (Ollama, LM Studio), allowlisted processes, webhooks, or CLI workers.",
          "ToolRuntime: Validates input/output schemas and executes function, HTTP (with anti-SSRF protection), database, search, and MCP tools.",
          "MemoryService: Manages tenant- and namespace-scoped semantic, episodic, and procedural memories backed by pgvector embeddings.",
          "RoutineScheduler & TriggerOutbox: Polls due cron/interval routines and dispatches webhook/routine triggers reliably.",
          "BudgetService: Reserves estimated USD cost prior to agent execution and reconciles actual spend upon completion.",
        ],
      },
      {
        title: "4. Persistence, Credential Broker, and Workers",
        body: "External boundaries keep state durable and secrets isolated:",
        bullets: [
          "PostgreSQL 16 + pgvector: Stores organizations, users, projects, workspaces, agents, tools, workflows, tasks, runs, run snapshots, events, approvals, budgets, routines, webhooks, and vector memories with Row-Level Security (RLS).",
          "Credential Broker (src/broker/): Issues short-lived, single-use credential leases backed by HashiCorp Vault KV v2 or encrypted stores, with SHA-256 hash-chained audit logs.",
          "CLI Worker Runtime: Runs untrusted CLI agent tasks inside rootless, read-only, network-disabled Docker containers pinned by SHA-256 image digest.",
        ],
      },
    ],
  },

  security: {
    title: "Security model",
    intro:
      "Security in Multi-Agent Studio is built on explicit trust boundaries and fail-closed defaults. Every layer assumes browser inputs are untrusted, secrets never enter domain records, and production services refuse to start if security prerequisites are missing.",
    overview: [
      { label: "Browser Trust", value: "Untrusted (server validates all inputs)" },
      { label: "Tenant Isolation", value: "RBAC + PostgreSQL Row-Level Security" },
      { label: "Secret Storage", value: "Zero secrets in records (Broker leases)" },
      { label: "Production Mode", value: "Fail-closed (no silent dev fallbacks)" },
    ],
    items: [
      {
        title: "1. The browser is never authoritative",
        body: "All payloads coming from the browser—including workflow graphs, agent configs, tool parameters, and URL slugs—are treated as untrusted input.",
        bullets: [
          "The Next.js BFF authenticates the user session and verifies active organization membership before forwarding any request.",
          "The execution server independently verifies the signed principal assertion, tenant ownership, and role permissions on every route.",
          "Forged initiator headers or cross-tenant IDs are rejected with 401/403/404 before touching domain logic.",
        ],
      },
      {
        title: "2. Zero secrets in domain records (assertNoCredentials)",
        body: "API keys, tokens, passwords, and private keys are strictly forbidden inside Agent records, Tool configurations, Workflow definitions, metadata fields, and Run events.",
        bullets: [
          "Both client and server run assertNoCredentials() on agent, tool, and workflow payloads and reject any field that looks like a raw secret or credential key.",
          "Instead of raw keys, configurations reference a server-owned provider name or a Credential Broker alias.",
          "Inbound webhook signing secrets are generated once, encrypted at rest, and never returned in subsequent GET responses.",
        ],
      },
      {
        title: "3. Multi-tenant isolation and Row-Level Security (RLS)",
        body: "Every resource belongs to an organization (tenant_id):",
        bullets: [
          "Composite foreign keys and PostgreSQL Row-Level Security (RLS) policies prevent cross-tenant reads or writes even if a query omits a filter.",
          "Organization deletion purges tenant data across Studio tables, memory namespaces, and broker leases in a fail-closed transaction.",
        ],
      },
      {
        title: "4. Worker sandboxing and Anti-SSRF guardrails",
        body: "Executing external commands or HTTP requests is tightly constrained:",
        bullets: [
          "Local CLI workers (CLI_WORKER_MODE=local) are for trusted development only and enforce executable path allowlists (CLI_AGENT_ALLOWED_EXECUTABLES) and workspace root checks.",
          "Container CLI workers (CLI_WORKER_MODE=container) enforce a digest-pinned image (@sha256:...), non-root UID/GID, read-only root filesystem, dropped Linux capabilities, no-new-privileges, PID/memory/CPU limits, and disabled networking by default.",
          "HTTP tools and webhook agents validate target URLs against private IP ranges, loopback addresses, and cloud metadata endpoints to prevent Server-Side Request Forgery (SSRF).",
        ],
      },
    ],
    callout: {
      title: "Core security principle",
      body: "Every boundary has one clear owner, an explicit authorization check, and a fail-closed failure mode. Production never silently falls back to development defaults.",
    },
  },

  "account-and-workspace": {
    title: "Account, organizations & workspace navigation",
    intro:
      "Learn how to create your account, set up or switch organizations, invite team members with role-based permissions, customize light/dark appearance, and navigate the Studio shell.",
    overview: [
      { label: "Auth Routes", value: "/register, /login, /onboarding/organization" },
      { label: "Invitations Route", value: "/invitations" },
      { label: "Org Settings Route", value: "/o/<orgSlug>/settings" },
      { label: "Roles", value: "owner · admin · member · viewer" },
    ],
    items: [
      {
        title: "1. Registration, sign-in, and Organization Onboarding",
        body: "Every user authenticates with their own account and works inside one or more organizations:",
        bullets: [
          "Register at /register with your name, email, and password, then sign in at /login.",
          "If you do not belong to an organization yet, you are guided to /onboarding/organization.",
          "In the setup wizard, enter your Organization name (up to 120 characters), optional Description, Default timezone (e.g. UTC or Asia/Tehran), and toggle Allow members to invite others.",
          "Your wizard draft is automatically saved in sessionStorage while you type, and you can also click View organization invitations at the top if a teammate already invited you.",
        ],
      },
      {
        title: "2. Navigating the Studio App Shell",
        body: "Once inside an organization (/o/<orgSlug>/...), the Studio layout provides three main areas:",
        bullets: [
          "Top Header: Shows live connection status (Live / Connecting...), the Launch Agent Task quick-dispatch button, the Appearance Toggle (Dark / Light theme), and your User Menu.",
          "Left Sidebar — Organization Switcher: Switch between any organization you belong to or create a new one.",
          "Left Sidebar — Navigation Groups: Divided into Work (Dashboard, Tasks, Projects, Project workspaces), Orchestration (Org workflow studio, Goals, Routines), and Operations (Budgets, Webhooks, Settings). You can collapse the sidebar to an icon rail using the Collapse button.",
        ],
      },
      {
        title: "3. Updating organization profile and URL slug",
        body: "Owners and admins can update the organization's display name and URL slug in Settings (/o/<orgSlug>/settings):",
        bullets: [
          "Open Settings in the left sidebar under Operations.",
          "Under Organization profile, edit the Organization name or Organization slug and click Save changes.",
          "If you change the slug, Studio automatically redirects your browser to /o/<new-slug>/settings.",
        ],
        note: "Changing the organization slug invalidates old bookmarked URLs that used the previous slug (they will return 404).",
      },
      {
        title: "4. Inviting members, accepting invitations, and managing roles",
        body: "Collaborate safely with role-based access control:",
        bullets: [
          "To invite a teammate: In /o/<orgSlug>/settings, enter their registered user email, choose an Invitation role (admin, member, or viewer; owners can also invite as owner), and click Invite member.",
          "To accept an invitation: The invited user visits /invitations, reviews the organization name and role, and clicks Accept invitation.",
          "To manage existing members: In the members table in Settings, owners and admins can change a user's role dropdown, click Suspend (and later Restore), or click Remove.",
          "Protected owner safeguard: Studio prevents removing, suspending, or demoting the last active owner of an organization.",
        ],
      },
      {
        title: "5. Deleting an organization (Danger Zone)",
        body: "Only an organization owner can permanently delete an organization:",
        bullets: [
          "Scroll to the Danger Zone at the bottom of /o/<orgSlug>/settings.",
          "Type the exact organization name to confirm and click Delete this organization.",
          "Studio purges all associated projects, workspaces, workflows, tasks, runs, memories, and broker state.",
        ],
      },
    ],
  },

  "projects-and-workspaces": {
    title: "Projects & project workspaces",
    intro:
      "Projects organize your tasks, repositories, and settings around a codebase or initiative. Project Workspaces let you create isolated branch and setting environments under a project so multiple agent tasks can work in parallel without colliding.",
    overview: [
      { label: "Projects List", value: "/o/<orgSlug>/projects" },
      { label: "Project Dashboard", value: "/o/<orgSlug>/projects/<projectId>" },
      { label: "Workspaces List", value: "/o/<orgSlug>/workspaces" },
      { label: "Workspace Dashboard", value: "/o/<orgSlug>/workspaces/<workspaceId>" },
    ],
    items: [
      {
        title: "1. Create, rename, and retire Projects",
        body: "Open Projects (/o/<orgSlug>/projects) from the Work group in the left sidebar:",
        bullets: [
          "Enter a project name in New project name (or leave blank for 'Untitled project') and click Create.",
          "You can also create a project inline directly from the Create Task modal on the Task Board.",
          "Use Rename on any project row to update its title inline, or click Retire when a project is finished so it no longer receives new tasks.",
        ],
      },
      {
        title: "2. Attach Git repositories on the Project Dashboard",
        body: "Click any project name to open its Project Dashboard (/o/<orgSlug>/projects/<projectId>):",
        bullets: [
          "Scroll to the Repositories section.",
          "Fill in Name (e.g. backend-api), Source (e.g. https://github.com/org/backend-api.git or local path), and Default branch (e.g. main), then click Attach repository.",
          "To detach a repository, click Remove. If any workspace currently has uncommitted file changes for that repository, Studio warns you with a 409 conflict and asks you to confirm before discarding changes.",
        ],
      },
      {
        title: "3. Default Workspace vs. Explicit Project Workspaces",
        body: "When a project is first created, it shows 'Using default workspace — tasks attach at the project level until you create an explicit workspace.'",
        bullets: [
          "As soon as you need branch isolation or custom environment settings (e.g. 'Staging', 'Feature-Auth', 'QA Lab'), create an explicit Project Workspace.",
          "You can create a workspace from the Project Dashboard (under Workspaces) or from the global Project workspaces page (/o/<orgSlug>/workspaces).",
          "When creating a workspace on a project with attached repositories, you can check/uncheck which repositories to include and specify a custom Git branch for each repository right at creation time!",
        ],
      },
      {
        title: "4. Manage branches, dirty files, and JSON overrides in the Workspace Dashboard",
        body: "Click any workspace name to open /o/<orgSlug>/workspaces/<workspaceId>:",
        bullets: [
          "Repository membership: Check or uncheck project repositories, edit the active Branch for each repo, and click Save repository membership.",
          "Live status badges: Studio displays availability badges (ready, branch missing, unavailable) and highlights uncommitted changes along with the exact list of Changed files.",
          "Settings overrides (JSON): Each workspace inherits settings from its parent project. Enter a JSON object in Settings overrides and click Save to override specific keys, or click Clear overrides to revert to project defaults.",
          "Related tasks: View every task assigned to this workspace and jump straight to the Task Board.",
        ],
      },
      {
        title: "5. Don't confuse Project Workspaces with Studio Workspace Packages",
        body: "The word 'workspace' appears in two distinct places in Studio:",
        bullets: [
          "Project Workspaces (/o/<orgSlug>/workspaces): Execution environments tied to a Project, its Git repositories, branches, and tasks.",
          "Studio Workspace Package (Import/Export buttons in /o/<orgSlug>/org): A portable JSON file containing your visual Workflow definitions, Agent records, and Tool records for backup or sharing.",
        ],
      },
    ],
  },

  agents: {
    title: "Create & configure agents",
    intro:
      "Agents are reusable worker definitions stored in your organization's Agent Registry. You can back an agent with cloud LLM APIs, local model servers (Ollama / LM Studio), CLI coding agents (Codex, Claude Code, Cursor, Antigravity), allowlisted OS processes, or HTTPS webhooks.",
    overview: [
      { label: "Agent Registry", value: "/o/<orgSlug>/org/agents" },
      { label: "Agent Detail & Test", value: "/o/<orgSlug>/org/agents/<agentId>" },
      { label: "Supported Backends", value: "API · CLI · Local · Process · Webhook" },
      { label: "Detail Tabs", value: "Overview, Config, Backend, Heartbeat, Tools, Memory, Workflows, Executions, Test" },
    ],
    items: [
      {
        title: "1. Create an agent and inspect Overview",
        body: "You can create an agent from the Agent Registry (/o/<orgSlug>/org/agents) by clicking Create agent, or from the left Node Palette in the Workflow Editor by clicking Agent.",
        bullets: [
          "The Overview tab displays the agent's runtime status (idle, running, waiting, failed), backend/model summary, assigned tool count, workflow usage count, memory mode, and system prompt.",
          "It also runs an automatic Backend health check against the execution server and displays live diagnostics.",
          "Top action buttons let you Duplicate the agent, jump to Test agent, Edit agent, Open in Graph, or Delete the agent.",
        ],
      },
      {
        title: "2. Configure general settings and System Prompt (Configuration tab)",
        body: "Click Edit agent at the top right, then open the Configuration tab:",
        bullets: [
          "Enabled for execution: Uncheck to temporarily disable this agent without removing it from workflows.",
          "Name & Description: Give the agent a clear role name (e.g. Security Auditor) and purpose.",
          "System prompt: Define the base persona, instructions, and output expectations shared across all workflows that use this agent.",
          "Metadata (JSON): Attach custom structured metadata. Studio enforces assertNoCredentials()—never put API keys or secrets in metadata.",
        ],
      },
      {
        title: "3. Choose and configure the Execution Backend (Backend tab)",
        body: "Open the Backend tab (while in Edit mode) to choose one of the 5 supported backend types:",
        bullets: [
          "API: Cloud LLM providers (openai, anthropic, google, etc.). Set Provider, Model, and optional model settings (Temperature, Top P, Max output tokens, Reasoning effort).",
          "CLI: Coding CLI agents (codex, claude, cursor/agent, agy). Leave Executable blank to use the provider default binary, or specify an allowlisted path. On Windows, always put the real .exe path in CLI_AGENT_ALLOWED_EXECUTABLES because npm .cmd shims cannot be spawned directly.",
          "Local: Local inference servers such as ollama (default http://127.0.0.1:11434) or lmstudio (default http://127.0.0.1:1234). Supports model name, custom Base URL, and temperature/token limits.",
          "Process: Runs a server-allowlisted command/binary with line-separated Arguments and an optional Workspace root directory.",
          "Webhook: Calls an external HTTPS agent service via POST or PUT, protected by anti-SSRF allowlists and authenticated via a Credential Broker alias.",
        ],
      },
      {
        title: "4. Set Execution Policy guardrails (Backend tab)",
        body: "Below the backend settings on the Backend tab, configure the Execution policy for the agent:",
        bullets: [
          "Filesystem: None, Read, or Read/write.",
          "Shell: Disabled, Restricted, or Full.",
          "Network: Disabled or Enabled.",
          "Workspace root & Allowed commands: Restrict which directory and commands the agent is permitted to access.",
        ],
        note: "Execution policy settings act alongside server-owned allowlists. For untrusted code execution, always run CLI workers in Container mode.",
      },
      {
        title: "5. Enable Agent Heartbeat & Auto-Wakeup (Heartbeat tab)",
        body: "Open the Heartbeat tab to configure periodic autonomous check-ins for the agent even when no manual tasks are dispatched:",
        bullets: [
          "Check Enable periodic heartbeat wakeup for this agent.",
          "Set Heartbeat Interval (seconds)—minimum 30 seconds, default 300 seconds (5 minutes).",
          "Click Save Heartbeat Settings. The panel shows Last Heartbeat and Next Scheduled wakeup times, and includes an English / Persian language toggle.",
        ],
      },
      {
        title: "6. Attach Tools, configure Memory, and run a Live Test",
        body: "Use the remaining tabs on the Agent Detail page to complete your agent setup:",
        bullets: [
          "Tools tab: Check or uncheck registered tools from your Tool Registry to grant the agent ReAct tool-calling capabilities.",
          "Memory tab: Enable run memory, select the memory scope (agent, workflow, project, user), and choose the retrieval/storage mode.",
          "Workflows & Executions tabs: Inspect every workflow graph that uses this agent and review past runs.",
          "Test tab: Enter a sample JSON object (e.g. { \"input\": \"Summarize our auth architecture\" }) and click Test agent. Studio executes a real run on the server and streams the output and event timeline live.",
        ],
      },
    ],
  },

  workflows: {
    title: "Design visual workflows",
    intro:
      "The Workflow Studio (/o/<orgSlug>/org) is a full-featured visual graph IDE. Design simple linear pipelines or cyclic multi-agent topologies, configure per-step overrides, validate contracts, and watch runs execute live on the canvas.",
    overview: [
      { label: "Workflow Editor URL", value: "/o/<orgSlug>/org" },
      { label: "4 Archetypes", value: "Linear · Supervisor · Evaluator-Optimizer · Swarm" },
      { label: "10 Node Types", value: "agent, tool, condition, approval, memory, input, output, parallel_split, parallel_join, subgraph" },
      { label: "Shortcuts", value: "Ctrl+S Save · Ctrl+Z Undo · Ctrl+Shift+Z Redo · Del Delete" },
    ],
    items: [
      {
        title: "1. Choose or convert a Workflow Archetype",
        body: "When you click New workflow in the top Workflow Switcher bar (or change the Active archetype dropdown in the right Overview panel), you choose one of four execution topologies:",
        bullets: [
          "Linear Pipeline (linear-pipeline): A strict directed acyclic graph (DAG). Cycles are forbidden, ensuring predictable sequential or parallel fan-out/fan-in execution.",
          "Hierarchical Supervisor (hierarchical-supervisor): A central Supervisor Hub agent node coordinates specialist worker nodes. Requires selecting a Supervisor hub node, configuring Recursion guards (route key, max iterations 1–10, fallback branch), and setting Max execution steps (1–5000).",
          "Evaluator-Optimizer (evaluator-optimizer): Pairs a generator agent node with an evaluator agent node in an iterative refinement loop bounded by a maximum iteration ceiling and an exhaustion fallback route.",
          "Autonomous Swarm (autonomous-swarm): Allows peer agent nodes to hand off control dynamically to one another within strict hop and cycle bounds.",
        ],
        note: "You can switch a workflow's archetype later without deleting your canvas. If you switch back to Linear Pipeline, supervisor/evaluator/swarm settings are preserved in a dormant state.",
      },
      {
        title: "2. All 10 Workflow Node Types explained",
        body: "Drag nodes from the left Node Palette onto the canvas (or click a palette item to add it):",
        bullets: [
          "Agent: Executes a registered Agent. Supports Step Instructions, per-step Model settings overrides, Active tools mode (Inherit agent tools, No tools for this step, or Subset of agent tools), ReAct tool-calling step limit (1–10), and Session mode (stateless vs. shared with a sessionKey).",
          "Tool: Invokes a registered Tool directly as a deterministic graph step.",
          "Condition: Routes execution along outgoing conditional edges based on state fields or expressions. Always wire an unknown fallback branch for unresolved values.",
          "Approval: Pauses the run (waiting_for_human) with a bounded proposal. Outgoing conditional edges use branch keys approved and rejected.",
          "Memory: Reads from or writes to an authorized long-term memory namespace.",
          "Input & Output: Define the entry portal and final output projection of the workflow.",
          "Parallel Split & Parallel Join: Fan execution out into concurrent branches (parallel_split) and synchronize/merge results back together (parallel_join).",
          "Subgraph: Invokes another saved workflow as a nested reusable module with input/output mapping and recursion depth guards.",
        ],
      },
      {
        title: "3. Connect edges, configure Node Contracts, and Auto-Arrange",
        body: "Click any node or edge to open its configuration in the right Properties Panel:",
        bullets: [
          "Normal vs. Conditional edges: Select an edge and set Edge Type to Normal (always traversed) or Conditional (traversed when the source Condition or Approval node emits the matching Branch Key).",
          "Node Contracts: At the bottom of any node's properties panel, define input/output contract schemas so mismatches are caught before execution.",
          "Toolbar helpers: Use Undo (Ctrl+Z), Redo (Ctrl+Shift+Z), Delete (Del), Zoom In/Out, Fit View, and Auto-Arrange (automatically lays out your graph cleanly).",
        ],
      },
      {
        title: "4. Validate and run on the Live Canvas",
        body: "Test and observe workflows without leaving the editor:",
        bullets: [
          "Click Validate in the toolbar. If any topological or contract errors exist, Studio highlights the count and focuses the first offending node or field.",
          "Choose Text or JSON object in the Run input format selector, enter your input in the Run input box, and click Run workflow (Play icon).",
          "In Live · Read only mode, nodes animate as they start, complete, fail, or pause for human approval.",
          "Click any node during or after a live run to open the Node Execution Inspector and inspect its exact input, output, and events.",
          "If a run pauses at an Approval node, use the Live Approval Banner right on the canvas to approve or reject.",
          "Use the bottom Live Run Tray to switch runs, or click Exit Live in the toolbar to return to Design mode.",
        ],
      },
      {
        title: "5. Export and Import Workspace Packages",
        body: "In the top Workflow Switcher bar, use Export workspace and Import workspace to download or upload a portable .json package containing your workflows, agents, and tools. Studio validates archetype contracts before importing.",
      },
    ],
  },

  tasks: {
    title: "Manage tasks & the Kanban board",
    intro:
      "The Task Board (/o/<orgSlug>/tasks) turns your workflows and agents into trackable operational work items with priorities, project/workspace links, dependency blocking, and one-click execution controls.",
    overview: [
      { label: "Task Board URL", value: "/o/<orgSlug>/tasks" },
      { label: "Quick Dispatch", value: "Top Header → Launch Agent Task" },
      { label: "Board Columns", value: "Backlog · In Progress · Review · Done" },
      { label: "Deep Link", value: "/o/<orgSlug>/tasks?taskId=<id>" },
    ],
    items: [
      {
        title: "1. Two ways to create a task",
        body: "You can create tasks either from the full Task Board or from any screen using the header quick-dispatch modal:",
        bullets: [
          "Full Create Task Modal: On /o/<orgSlug>/tasks, click + on any column header to open Create Task.",
          "Quick Dispatch Modal: Click Launch Agent Task (Sparkles button) in the top application header from anywhere in Studio, type your prompt, and click Dispatch to Pipeline to immediately enqueue a high-priority orchestrator task.",
        ],
      },
      {
        title: "2. Configure Project, Workspace, Workflow, and Dependencies",
        body: "In the Create Task modal, configure how the task should run:",
        bullets: [
          "Title, Description & Priority: Give the work item a clear title, detailed prompt/requirements, and priority (low, medium, high, critical).",
          "Project & Project Workspace: Select an existing Project (or click New project to create one inline!). If the selected project has explicit workspaces, pick the target Project Workspace so code changes happen on the right Git branch.",
          "Assigned Workflow & Assigned Agent: Choose which Workflow graph (and/or specific Agent) executes this task.",
          "Parent Task & Dependencies: Optionally link a parentTaskId or check upstream tasks that must complete before this task is allowed to start.",
        ],
      },
      {
        title: "3. Filter, search, and share board views",
        body: "Use the Task Filter Bar at the top of the board to narrow down large backlogs:",
        bullets: [
          "Filter by text search, Project, Workspace, Assigned Agent, Workflow, Priority, or blocked status.",
          "Active filters automatically sync to the browser URL query string (with a 200ms debounce) so you can bookmark or share filtered views with teammates.",
          "Click Reset to clear all active filters.",
        ],
      },
      {
        title: "4. Start, pause, retry, cancel, and inspect tasks",
        body: "Each task card and the slide-over Task Detail Panel give you full lifecycle control:",
        bullets: [
          "Start: Validates that dependencies are complete and dispatches a new Run from an immutable snapshot of the workflow and task.",
          "Drag-and-Drop / Move: Drag cards between columns. If a task is blocked by unfinished dependencies, Studio prevents the transition and displays the exact blocking task titles.",
          "Pause / Resume: Pause an active task or resume it when ready.",
          "Waiting for Human: If a task's run hits a Human Approval Gate, resume it by approving or rejecting the gate on the Run page—never start a duplicate run to bypass a pause.",
          "Retry, Cancel & Delete: Retry transient failures, cancel an unwanted run, or delete obsolete tasks.",
        ],
      },
    ],
  },

  "tools-and-approvals": {
    title: "Tools & human approvals",
    intro:
      "Tools give your agents governed access to external APIs, databases, search, and functions. Human Approval Gates ensure high-impact decisions pause cleanly for operator review before execution continues.",
    overview: [
      { label: "Tool Registry", value: "/o/<orgSlug>/org/tools" },
      { label: "Tool Detail & Test", value: "/o/<orgSlug>/org/tools/<toolId>" },
      { label: "Impact Levels", value: "low · medium · high · critical" },
      { label: "Approval Branches", value: "approved · rejected" },
    ],
    items: [
      {
        title: "1. Register and configure a Tool",
        body: "Open the Tool Registry (/o/<orgSlug>/org/tools) or click Tool in the Workflow Editor palette:",
        bullets: [
          "Click Create tool to open its Tool Detail page (/o/<orgSlug>/org/tools/<toolId>).",
          "Click Edit tool and open the Configuration tab.",
          "Set Name, Category, Impact / permission level (low, medium, high, critical), and Description.",
          "Provide the Configuration JSON and Metadata JSON (no raw secrets allowed—use server credential aliases).",
          "On the Overview tab, inspect the Input Schema and Output Schema contracts.",
        ],
      },
      {
        title: "2. Test a Tool in isolation (Test tab)",
        body: "Before attaching a tool to an agent or workflow, verify its schema and execution behavior:",
        bullets: [
          "On the Tool Detail page, switch to the Test tab.",
          "Provide sample JSON arguments matching the tool's inputSchema and run a test invocation.",
          "Use the Agents and Workflows tabs to see every agent and workflow currently referencing this tool.",
        ],
      },
      {
        title: "3. Attach Tools to Agents vs. Workflow Tool Nodes",
        body: "Studio supports two ways to invoke a registered tool:",
        bullets: [
          "Agent-driven (ReAct loop): Assign the tool to an Agent in the Agent's Tools tab. On any workflow Agent node, you can further refine Active tools to Inherit agent tools, No tools for this step, or a specific Subset of agent tools.",
          "Workflow-driven (Deterministic Tool node): Drag the tool directly onto the workflow canvas as a Tool node so it executes at a fixed point in the graph.",
        ],
      },
      {
        title: "4. Design and resolve Human Approval Gates",
        body: "When an operation has high impact (e.g. deploying code, modifying production records, or approving a budget), place an Approval node in your workflow:",
        bullets: [
          "Add an Approval node from the palette and connect incoming work to it.",
          "Draw two outgoing edges from the Approval node, set both to Edge Type = Conditional, and set their Branch Keys to approved and rejected.",
          "When a run reaches the Approval node, LangGraph checkpoints the state and transitions the run to waiting_for_human.",
          "Operators can review the bounded proposal and click Approve or Reject either in the Run Detail page (/o/<orgSlug>/runs/<runId>) or directly in the Live Approval Banner on the workflow canvas.",
          "Resuming from an approval gate continues from the saved checkpoint without re-running upstream LLM calls.",
        ],
      },
    ],
  },

  memory: {
    title: "Memory Explorer & long-term recall",
    intro:
      "Multi-Agent Studio combines short-term run checkpoints with tenant-aware, pgvector-backed long-term memory. Use the Memory Explorer (/o/<orgSlug>/org/memory) to inspect, search, and manage stored memories across scopes.",
    overview: [
      { label: "Memory Explorer URL", value: "/o/<orgSlug>/org/memory" },
      { label: "Memory Scopes", value: "organization · agent · workflow · project · user" },
      { label: "Memory Kinds", value: "semantic · episodic · procedural" },
      { label: "Storage Engine", value: "PostgreSQL 16 + pgvector" },
    ],
    items: [
      {
        title: "1. Short-term run state vs. Long-term memory",
        body: "Studio separates ephemeral execution state from durable knowledge:",
        bullets: [
          "Short-term state (Working / Run memory): Holds node outputs, conversation turns, and LangGraph checkpoints for a single run (or across steps sharing a sessionKey within a run).",
          "Long-term memory (MemoryService): Stores durable facts, past episodes, and reusable procedures in PostgreSQL with pgvector embeddings for semantic similarity retrieval across runs.",
        ],
      },
      {
        title: "2. Understand Memory Scopes and Kinds",
        body: "Every long-term memory belongs to an explicit Namespace ({ scope, id }) and has a specific Kind:",
        bullets: [
          "Scopes: agent (private to one agent ID), workflow (shared across runs of a workflow ID), project (shared across a project ID), user (scoped to a user ID), and organization (tenant-wide when NEXT_PUBLIC_ORG_MEMORY_SCOPE=true).",
          "semantic: Facts, domain concepts, architectural decisions, and reference knowledge.",
          "episodic: Timestamped summaries of past run outcomes, incidents, and interactions.",
          "procedural: Reusable how-to playbooks, successful tool sequences, and workflow recipes.",
        ],
      },
      {
        title: "3. Browse and search in the Memory Explorer",
        body: "Open /o/<orgSlug>/org/memory (from the Org workflow studio or directly by URL):",
        bullets: [
          "Bearer token (optional): Leave blank to use your current organization session credentials, or paste a manual token override.",
          "Namespace scope & Namespace ID: Pick the scope (e.g. agent or organization) and enter the corresponding ID (when scope is organization, Studio auto-fills your organization ID).",
          "Kind filter: Filter by All kinds, semantic, episodic, or procedural.",
          "List recent vs. Search: Click List recent to browse the latest 50 memories in that namespace, or enter a query in Search text and click Search to run relevance-scored vector recall.",
        ],
      },
      {
        title: "4. Inspect provenance and delete stale memories",
        body: "Every memory record preserves full provenance so you always know where a piece of knowledge came from:",
        bullets: [
          "Click any memory row in the Results list to expand its full JSON payload, including subject, content, importance score, status, and source metadata (agentId, runId, workflowId).",
          "Click Delete to remove an outdated or incorrect memory. Note: deleting organization-scoped memories requires an owner or admin role (members and viewers see a Read-only badge).",
        ],
      },
    ],
  },

  "goals-and-delegation": {
    title: "Organization goals, reporting lines & delegation",
    intro:
      "The Organization & Goals page (/o/<orgSlug>/organization) lets you organize your registered agents into a reporting hierarchy (CEO, Manager, Member), request AI-generated strategy proposals from your CEO agent, and delegate company goals into tracked tasks.",
    overview: [
      { label: "UI Route", value: "/o/<orgSlug>/organization" },
      { label: "Sidebar Location", value: "Orchestration → Goals" },
      { label: "Agent Roles", value: "CEO · Manager · Member" },
      { label: "Goal Statuses", value: "proposed · active · completed · cancelled" },
    ],
    items: [
      {
        title: "1. Define Agent Reporting Lines",
        body: "Open Goals (/o/<orgSlug>/organization) from the Orchestration group in the left sidebar. The top section lists every registered agent in your organization:",
        bullets: [
          "For each agent, choose a hierarchy Role: CEO, Manager, or Member.",
          "Choose a Manager agent from the dropdown (or leave as No manager for top-level agents such as the CEO).",
          "Click Save on the agent's card to persist its reporting line.",
        ],
        note: "Assigning at least one agent the CEO role unlocks the CEO strategy proposal workflow when creating new goals.",
      },
      {
        title: "2. Create Company Goals and Sub-Goals",
        body: "In the New goal section, define strategic objectives and organize them into a tree:",
        bullets: [
          "Enter a Goal title (up to 200 characters) and a Description.",
          "Select a Goal owner agent (optional) to assign accountability.",
          "Select a Parent goal (or keep Company goal for a root-level objective) and link an optional Project.",
          "Click Create goal to add it directly to the Goal tree as an active goal.",
        ],
      },
      {
        title: "3. Request a CEO Strategy Proposal",
        body: "If you have configured a CEO agent in Reporting Lines, you can ask the CEO agent to draft a strategy before approving a goal:",
        bullets: [
          "In the New goal form, check CEO strategy proposal.",
          "Select a target Project (required for strategy proposals) and enter a Strategy brief for CEO agent in the description field.",
          "Click Create goal. Studio creates the goal in proposed status and automatically dispatches a strategy proposal task to your CEO agent.",
          "Wait for the CEO strategy task to finish (its output appears directly under the goal in the Goal tree). Once complete, the Approve button unlocks—click Approve to promote the goal to active!",
        ],
      },
      {
        title: "4. Delegate Active Goals into Tasks",
        body: "Once a goal is active in the Goal tree, break it down and assign execution work:",
        bullets: [
          "On any active goal card, choose an agent from the Delegate dropdown.",
          "If the goal is not already tied to a project, pick a Project from the project selector.",
          "Click Delegate to task. Studio creates a linked task on the Task Board assigned to that agent and project.",
          "The goal card tracks progress automatically (e.g. 2 / 3 tasks complete), links directly to each task on the Task Board (/o/<orgSlug>/tasks?taskId=...), and previews up to 2,000 characters of each task's output. Click Complete when the goal is achieved.",
        ],
      },
    ],
  },

  "routines-and-webhooks": {
    title: "Recurring routines & inbound webhooks",
    intro:
      "Run your workflows and agents automatically without manual clicks. Use Routines (/o/<orgSlug>/routines) for cron and interval schedules, and Inbound Webhooks (/o/<orgSlug>/webhooks) for event-driven triggers from GitHub, Stripe, or CI/CD pipelines.",
    overview: [
      { label: "Routines Route", value: "/o/<orgSlug>/routines (Orchestration → Routines)" },
      { label: "Webhooks Route", value: "/o/<orgSlug>/webhooks (Operations → Webhooks)" },
      { label: "Schedule Types", value: "Cron Expression · Interval (every:Ns)" },
      { label: "Webhook Auth", value: "HMAC-SHA256 Signing Secret + Rate Limit" },
    ],
    items: [
      {
        title: "1. Create a Recurring Routine (Cron or Interval)",
        body: "Open Routines (/o/<orgSlug>/routines) from the Orchestration sidebar group and click Create Routine:",
        bullets: [
          "Name & Description: e.g. Daily Queue Sweeper or Nightly Security Audit.",
          "Schedule Type & Expression: Choose Cron Expression (e.g. 0 9 * * 1-5 for 9:00 AM Monday–Friday) or Interval (e.g. every:300s for every 5 minutes).",
          "Timezone: Enter any valid IANA timezone (e.g. UTC, America/New_York, Europe/London, Asia/Tehran).",
          "Preview Next Runs: Click Preview Next Runs inside the modal to verify your expression and see the exact next 5 trigger timestamps localized to your timezone!",
          "Target Type & Target ID: Choose Workflow or Agent and paste its ID.",
          "Misfire Policy: Choose how Studio handles triggers missed while the server was down: Skip (ignore missed runs), Coalesce (collapse missed runs into a single immediate run), or Enqueue (run every missed trigger in order).",
        ],
      },
      {
        title: "2. Pause, resume, and inspect Routine Execution History",
        body: "Each routine card displays its Active/Paused badge, schedule, timezone, target, misfire policy, and relative Next / Last run times:",
        bullets: [
          "Click the Pause / Play icon button to pause or resume a routine at any time.",
          "Click the History icon button to open the Execution History modal, showing each trigger's status (success, failed, skipped), timestamp, error message, and linked Run ID.",
          "Use the top-right language button (فارسی / English) to toggle the Routines interface between English and Persian.",
        ],
      },
      {
        title: "3. Create an Inbound Webhook Trigger",
        body: "Open Webhooks (/o/<orgSlug>/webhooks) from the Operations sidebar group and click Create Webhook Trigger:",
        bullets: [
          "Enter a Name (e.g. GitHub Pull Request Webhook) and optional Description.",
          "Select Target Type (Workflow or Agent) and enter the Target ID.",
          "Set Rate Limit (requests / min) between 1 and 1000 (default 60 req/min) and click Save Webhook Trigger.",
          "Save your Signing Secret immediately: Studio displays the generated signingSecret once in a modal. Copy it to your password manager or webhook producer—it is never shown again in plaintext.",
        ],
      },
      {
        title: "4. Send HMAC-SHA256 signed requests and inspect Delivery Logs",
        body: "Each webhook card shows its inbound endpoint: POST /api/webhooks/triggers/<triggerId>. Producers must sign the raw JSON request body with HMAC-SHA256 using the signing secret:",
        code: `# Example: Compute HMAC-SHA256 signature and trigger the webhook
BODY='{"event":"pull_request.opened","pr":42}'
SECRET="your-webhook-signing-secret"
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST "http://localhost:4000/api/webhooks/triggers/<triggerId>" \\
  -H "Content-Type: application/json" \\
  -H "X-Hub-Signature-256: sha256=$SIG" \\
  -d "$BODY"`,
        bullets: [
          "Rotate Secret (Key icon): Immediately invalidates the old signing secret and reveals a new one.",
          "Delivery Log (Activity icon): Opens the audit log of inbound HTTP deliveries showing HTTP status code, ACCEPTED / REJECTED badge, duration in milliseconds, error reason, and payload summary keys.",
        ],
      },
    ],
  },

  "budgets-and-costs": {
    title: "Cost budgets & spend guardrails",
    intro:
      "Prevent runaway token bills before they happen. The Cost Budgets page (/o/<orgSlug>/budgets) lets you configure monthly USD spending caps for your entire company, individual agents, or specific projects—with automatic pre-execution reservation.",
    overview: [
      { label: "UI Route", value: "/o/<orgSlug>/budgets" },
      { label: "Sidebar Location", value: "Operations → Budgets" },
      { label: "Budget Scopes", value: "Company · Agent · Project" },
      { label: "Enforcement", value: "Pre-execution reservation (Fail-closed)" },
    ],
    items: [
      {
        title: "1. How pre-execution budget reservation works",
        body: "Unlike passive analytics dashboards that only report overspending after the fact, Multi-Agent Studio enforces budgets proactively:",
        bullets: [
          "Before an agent step executes, BudgetService estimates the invocation cost and reserves that amount (reservedUsd) against all applicable budgets (Company, Agent, and Project).",
          "If spentUsd + reservedUsd + estimatedCost would exceed limitUsd on any matching budget scope, the invocation is blocked before calling the LLM provider.",
          "When the step finishes, the reservation is released and replaced with the actual spentUsd calculated from provider token usage.",
        ],
      },
      {
        title: "2. Configure a Company, Agent, or Project budget",
        body: "Open Budgets (/o/<orgSlug>/budgets) from the Operations group in the left sidebar:",
        bullets: [
          "Select the Budget scope: Company (applies to all runs in the organization), Agent (caps a specific agent), or Project (caps all tasks linked to a specific project).",
          "If you chose Agent or Project, select the target from the second dropdown.",
          "Set Monthly USD (from $0.01 to $1,000,000) and Alert at % (1% to 100%, e.g. 80%).",
          "Click Save budget.",
        ],
      },
      {
        title: "3. Monitor current period usage and threshold alerts",
        body: "Below the configuration form, Studio displays real-time budget health:",
        bullets: [
          "Current period cards: Show spent USD, currently reserved USD, total monthly limit, a visual progress bar, alert threshold percentage, and the monthly renewal date.",
          "Alerts feed: Records a timestamped alert entry whenever a Company, Agent, or Project budget crosses its warning threshold (thresholdPercent) or hits its hard cap (limitUsd).",
        ],
      },
    ],
  },

  runs: {
    title: "Monitor, control & replay runs",
    intro:
      "Every execution in Studio—whether started from the Workflow Canvas, Task Board, Routine Scheduler, or Inbound Webhook—produces a durable Run record with a live event stream, graph visualization, and replayable timeline.",
    overview: [
      { label: "Live Dashboard", value: "/o/<orgSlug>" },
      { label: "Runs History", value: "/o/<orgSlug>/runs" },
      { label: "Run Detail & Replay", value: "/o/<orgSlug>/runs/<runId>" },
      { label: "Run Statuses", value: "queued · running · waiting_for_human · completed · failed · cancelled" },
    ],
    items: [
      {
        title: "1. Live Operations Dashboard (/o/<orgSlug>)",
        body: "Your organization home page is a real-time command center:",
        bullets: [
          "Header Metrics (StatCards): Track active agents, queued tasks, completed runs, and token/cost totals.",
          "Interactive React Flow Preview: Preview your saved workflow topology right on the dashboard.",
          "Active Running Agents & Queue/Failed Incidents: Monitor in-flight work and spot failed runs immediately.",
          "Completed Tasks & Token/Cost Analytics: Review throughput and spend across recent executions.",
        ],
      },
      {
        title: "2. Filter Runs History (/o/<orgSlug>/runs)",
        body: "Open Runs (/o/<orgSlug>/runs) to search and filter every historical or active execution:",
        bullets: [
          "Filter by Workflow ID, Task ID, Status (queued, running, waiting_for_human, completed, failed, cancelled), and From / To timestamps.",
          "The list auto-refreshes every 5 seconds so you can watch queued and running attempts progress.",
          "Click any run ID or the Open button to inspect its full execution detail.",
        ],
      },
      {
        title: "3. Inspect Run Detail, Runtime Graph, and Event Timeline",
        body: "On /o/<orgSlug>/runs/<runId>, Studio shows two synchronized panels:",
        bullets: [
          "Workflow execution (left): Renders the snapshot of the workflow graph used by this run, showing per-node status icons (spinning loader for running, amber clock for paused/approval, green check for completed, red X for failed) and highlighting traversed edges.",
          "Event timeline (right): Streams sanitized RunEvent records in chronological order—including node starts/completions, ReAct tool calls, memory reads/writes, policy checks, and approval decisions.",
          "Open on canvas: Click Open on canvas in the top right header to jump into the full Visual Workflow Editor attached to this runId (/o/<orgSlug>/org?workflowId=...&runId=...).",
        ],
      },
      {
        title: "4. Cancel, Retry, and handle failures systematically",
        body: "Use the run header actions and failure classification to operate reliably:",
        bullets: [
          "Cancel: Available while a run is queued, running, or waiting_for_human.",
          "Retry run: Available when a run is failed or cancelled; spawns a fresh run attempt from the workflow.",
          "Classify failures first: Before clicking retry, check the timeline to see whether the failure was caused by input validation, RBAC/policy, budget cap, provider rate limit, tool error, or human rejection.",
        ],
      },
    ],
  },

  persistence: {
    title: "Persistence & restart recovery",
    intro:
      "Multi-Agent Studio is designed to survive process restarts without losing your work or repeating expensive LLM calls. Learn what is stored durably in PostgreSQL versus what lives in process memory.",
    overview: [
      { label: "Durable Store", value: "PostgreSQL 16 (STUDIO_STORE=postgres)" },
      { label: "Checkpoints", value: "LangGraph state + Run Snapshots" },
      { label: "Paused Work", value: "waiting_for_human resumes without re-running upstream nodes" },
    ],
    items: [
      {
        title: "1. What is persisted in PostgreSQL",
        body: "When STUDIO_STORE=postgres and MEMORY_DATABASE_URL are configured, the following records are stored durably in PostgreSQL:",
        bullets: [
          "Organizations, users, memberships, invitations, projects, project repositories, and project workspaces.",
          "Agent records, heartbeat configs, Tool records, and Workflow definitions (including archetype configs).",
          "Tasks, task dependencies, Runs, immutable Run snapshots, RunEvents, and Human Approval records.",
          "Long-term memories and vector embeddings (pgvector), Cost Budgets, Recurring Routines, and Webhook Triggers.",
        ],
      },
      {
        title: "2. Immutable Run Snapshots",
        body: "When a run starts, the execution server captures a frozen snapshot of the WorkflowDefinition, referenced Agent records, and Tool records.",
        bullets: [
          "Editing a workflow or agent later in the UI does not corrupt or alter an already-running or historical run.",
          "Replay and canvas inspection always read the snapshot recorded for that specific runId.",
        ],
      },
      {
        title: "3. What happens across a server restart",
        body: "Understanding recovery boundaries helps operators manage deployments safely:",
        bullets: [
          "Queued runs: Re-queued and recovered from their durable snapshots on startup.",
          "Waiting for human approvals: The paused LangGraph checkpoint and Approval record live in PostgreSQL. Even if the server restarts while waiting for a human, clicking Approve or Reject after restart resumes the run from the checkpoint without repeating prior LLM calls.",
          "Process-local resources: Active SSE browser streams, in-flight child processes, and in-memory rate limit counters are process-local. Browser clients automatically reconnect SSE streams.",
        ],
      },
    ],
  },

  workers: {
    title: "CLI workers (Local vs. Container)",
    intro:
      "CLI-backed agents (Codex, Claude Code, Cursor agent, Antigravity agy) execute inside a Worker Runtime. Studio provides two worker modes so you can balance local developer convenience with strict OS container isolation.",
    overview: [
      { label: "Trusted Dev Mode", value: "CLI_WORKER_MODE=local" },
      { label: "Isolated Mode", value: "CLI_WORKER_MODE=container" },
      { label: "Worker Image Tag", value: "multi-agent-cli-worker:local (or @sha256 digest)" },
    ],
    code: "pnpm worker:image:build\npnpm worker:image:smoke\npnpm worker:e2e:multi-agent-workflow",
    items: [
      {
        title: "1. Local worker mode (trusted code only)",
        body: "When CLI_WORKER_MODE=local (the development default), the execution server spawns the CLI executable as a local child process:",
        bullets: [
          "Enforces CLI_AGENT_ALLOWED_EXECUTABLES and workspace root path checks.",
          "Preserves the CLI tool's native flags, approval mode, and sandbox flags.",
          "Not an OS security boundary against untrusted code—use only in trusted local development.",
          "Windows note: Put the full path to the real .exe binary in CLI_AGENT_ALLOWED_EXECUTABLES (Node.js cannot spawn npm .cmd shims when shell=false).",
        ],
      },
      {
        title: "2. Container worker mode (untrusted code isolation)",
        body: "For untrusted repositories or production deployments, set CLI_WORKER_MODE=container. Each CLI invocation runs inside an ephemeral Docker container with hardened flags:",
        bullets: [
          "Digest-pinned image: Requires CLI_WORKER_IMAGE pinned by @sha256:<digest> in production.",
          "Non-root execution: Runs as an unprivileged user/group with --security-opt no-new-privileges.",
          "Read-only root filesystem: Rootfs is mounted read-only; only the bounded workspace mount is writable.",
          "Dropped capabilities & resource limits: Drops all Linux capabilities (--cap-drop ALL) and enforces memory, CPU, and PID ceilings.",
          "Network disabled by default: Container networking is off unless explicitly permitted by policy.",
        ],
      },
      {
        title: "3. Build, smoke-test, and authenticate CLI workers",
        body: "Use the built-in root scripts to build and verify the worker image and provider auth files:",
        code: `# 1. Build and smoke-test the local worker image
pnpm worker:image:build
pnpm worker:image:smoke

# 2. Authenticate Codex for isolated file-based worker credential delivery
pnpm credentials:login-codex
pnpm credentials:status-codex

# 3. Run end-to-end worker verification suites
pnpm worker:e2e:codex-auth-file
pnpm worker:e2e:claude-auth-file
pnpm worker:e2e:multi-agent-workflow`,
      },
    ],
  },

  credentials: {
    title: "Credential Broker",
    intro:
      "The Credential Broker (src/broker/) is a dedicated security service that issues short-lived, single-use credential leases to the execution server. Raw provider secrets stay in HashiCorp Vault (or the broker's secret store) and never enter workflow definitions, agent records, or browser responses.",
    overview: [
      { label: "Broker Endpoints", value: "POST /v1/leases · /consume · /revoke · GET /v1/health · /v1/audit/leases" },
      { label: "Default Port", value: "8484 (CREDENTIAL_BROKER_PORT)" },
      { label: "Audit Integrity", value: "Append-only PostgreSQL + SHA-256 hash chain" },
      { label: "Prod Transport", value: "HTTPS + mTLS + FAIL_CLOSED" },
    ],
    code: "CREDENTIAL_BROKER_SERVICE_TOKENS=dev:local-dev-token \\\nCREDENTIAL_BROKER_PORT=8484 \\\nnpx ts-node src/broker/server.ts",
    items: [
      {
        title: "1. Lease lifecycle: Issue, Consume, and Revoke",
        body: "Whenever an agent or tool needs a provider credential during a run, the execution server talks to the Credential Broker:",
        bullets: [
          "1. Issue (POST /v1/leases): The execution server requests a lease bound to { tenantId, principalId, runId, agentId/toolId, provider, alias, purpose, ttlSeconds } with an Idempotency-Key.",
          "2. Consume (POST /v1/leases/:id/consume): Immediately before calling the provider, the execution server consumes the lease in an atomic single-use operation. A second consume attempt on the same lease always fails.",
          "3. Revoke (POST /v1/leases/:id/revoke): Cancels an unconsumed lease if a run is aborted or fails early.",
        ],
      },
      {
        title: "2. Deny-by-default Policy and Rate Limiting",
        body: "Before issuing or consuming a lease, BrokerPolicy and RateLimiter verify:",
        bullets: [
          "Tenant is active and the principal and run belong to that tenant.",
          "The agent or tool is allowed to use the requested provider, alias, and purpose (purpose-by-provider matrix).",
          "Run lease quotas and tenant cost budgets have not been exceeded.",
          "Per-tenant issue rates, active lease counts, and per-lease failed consume attempts are within configured limits.",
        ],
      },
      {
        title: "3. Tamper-evident SHA-256 Audit Chain",
        body: "Every issue, consume, revoke, and policy denial is recorded by AuditRecorder:",
        bullets: [
          "Each audit row includes a SHA-256 hash computed over the previous event's hash and the whitelisted fields of the current event.",
          "In PostgreSQL (infrastructure/broker/migrate.cjs), a database trigger blocks UPDATE and DELETE statements on the audit table to enforce append-only storage.",
          "Operators can query audit history via GET /v1/audit/leases and verify chain integrity with verifyAuditChain().",
        ],
      },
      {
        title: "4. Environment precedence and Production requirements",
        body: "CREDENTIAL_BROKER_* variables always take precedence over legacy TOOL_CREDENTIAL_GATEWAY_* variables. In production (NODE_ENV=production), assertValidBrokerClientEnvironment enforces:",
        bullets: [
          "An HTTPS CREDENTIAL_BROKER_URL and valid service token.",
          "Existing mTLS client certificate, private key, and CA bundle files on disk.",
          "CREDENTIAL_BROKER_FAIL_CLOSED=true (never falls back to environment variables in production).",
        ],
      },
    ],
  },

  development: {
    title: "Development guide",
    intro:
      "A complete reference for contributors and self-hosted operators working inside the Multi-Agent Studio monorepo: repository structure, environment variables, database migrations, and test suites.",
    overview: [
      { label: "Package Manager", value: "pnpm@10.17.0" },
      { label: "Typecheck", value: "npx tsc --noEmit && pnpm typecheck:tests" },
      { label: "Unit & Integration Tests", value: "pnpm test --runInBand" },
      { label: "Graphify Update", value: "graphify update ." },
    ],
    code: "pnpm test --runInBand\nnpx tsc --noEmit\npnpm --filter server build\npnpm --filter web build\npnpm build:docs",
    items: [
      {
        title: "1. Monorepo directory structure",
        body: "Understanding where each boundary lives in the repository:",
        bullets: [
          "packages/types/ — Shared TypeScript contracts (@multi-agent/types) for workflows, archetypes, agents, tools, runs, and memory.",
          "src/ — Core runtime engine, LangGraph workflow compiler, agent/tool executors, memory service, security/credential gateway, and standalone Credential Broker (src/broker/).",
          "apps/server/ — Hono HTTP execution server, Studio REST/SSE routes, routine scheduler, webhook router, and runtime composition.",
          "apps/web/ — Next.js 16 authenticated Studio UI, React Flow visual workflow editor, Kanban task board, and BFF proxy routes.",
          "apps/docs/ — Bilingual (English & Persian) Next.js tutorial and documentation site.",
          "infrastructure/ — Dockerfiles, Docker Compose stacks, and explicit PostgreSQL migration runners (memory/, studio/, broker/).",
          "tests/ — Comprehensive Jest unit, integration, security, persistence, and UI component test suites.",
        ],
      },
      {
        title: "2. Key environment variables catalog",
        body: "Keep apps/server/.env and apps/web/.env.local aligned during local development:",
        code: `# Database & Persistence
MEMORY_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"
STUDIO_STORE="postgres"

# Web Auth & BFF (apps/web/.env.local)
AUTH_SECRET="your-32-char-secret"
EXECUTION_SERVER_URL="http://localhost:4000"
NEXT_PUBLIC_ORG_MEMORY_SCOPE="true"
NEXT_PUBLIC_ORG_DELETION_ENABLED="true"

# LLM Providers (apps/server/.env)
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_API_KEY="AIza..."

# CLI Workers (apps/server/.env)
CLI_WORKER_MODE="local" # or "container"
CLI_AGENT_ALLOWED_EXECUTABLES="/usr/local/bin/codex,/usr/local/bin/claude"

# Credential Broker (optional locally, required in prod)
CREDENTIAL_BROKER_URL="https://broker.internal:8484"
CREDENTIAL_BROKER_TOKEN="service-token"
CREDENTIAL_BROKER_FAIL_CLOSED="true"`,
      },
      {
        title: "3. Running tests and verification suites",
        body: "Run focused or full test suites before opening a pull request:",
        code: `# Run the full Jest suite
pnpm test --runInBand

# Run a single test file
pnpm test -- tests/workflowArchetype.test.ts

# Run PostgreSQL broker persistence tests
MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory" \\
  pnpm test -- tests/brokerPersistence.test.ts

# Typecheck root, tests, and apps
npx tsc --noEmit
pnpm typecheck:tests
pnpm --filter server build
pnpm --filter web build
pnpm build:docs
git diff --check`,
      },
    ],
  },

  deployment: {
    title: "Deployment checklist",
    intro:
      "Use this checklist when promoting Multi-Agent Studio from a local development environment to a self-hosted staging or production deployment.",
    overview: [
      { label: "Step 1", value: "Database & Explicit Migrations" },
      { label: "Step 2", value: "Credential Broker + Vault + mTLS" },
      { label: "Step 3", value: "Container Worker Image Digest" },
      { label: "Step 4", value: "Web BFF & Execution Server Secrets" },
    ],
    items: [
      {
        title: "1. Provision PostgreSQL 16 + pgvector and run migrations",
        body: "Run all three migration scripts as a release step before starting application servers:",
        code: `MEMORY_DATABASE_URL="postgresql://..." node infrastructure/memory/migrate.cjs
MEMORY_DATABASE_URL="postgresql://..." node infrastructure/studio/migrate.cjs
CREDENTIAL_BROKER_DATABASE_URL="postgresql://..." node infrastructure/broker/migrate.cjs`,
        bullets: [
          "Verify automated backups, point-in-time recovery (PITR), and restore procedures before routing production traffic.",
          "Ensure STUDIO_STORE=postgres is set on the execution server.",
        ],
      },
      {
        title: "2. Deploy the Credential Broker with Vault and mTLS",
        body: "In production, the execution server refuses to start without a valid HTTPS/mTLS Credential Broker:",
        bullets: [
          "Configure HashiCorp Vault KV v2 (CREDENTIAL_BROKER_VAULT_ADDR, CREDENTIAL_BROKER_VAULT_TOKEN, CREDENTIAL_BROKER_VAULT_MOUNT).",
          "Wire your deployment's AuthorizationSource and QuotaUsageSource into startBroker() (the standalone broker defaults to deny-all until wired).",
          "Configure TLS/mTLS server certificates on the broker and client certificates on the execution server.",
          "Set CREDENTIAL_BROKER_FAIL_CLOSED=true and CREDENTIAL_BROKER_TRUSTED_SERVER_DELIVERY=true (if using server-mediated CLI worker credentials).",
        ],
      },
      {
        title: "3. Build, scan, and pin the CLI Worker container image",
        body: "If any agents use the CLI backend in production, isolate them with container mode:",
        bullets: [
          "Build infrastructure/docker/worker.Dockerfile and push it to your private container registry.",
          "Set CLI_WORKER_MODE=container and CLI_WORKER_IMAGE=registry.example.com/multi-agent-cli-worker@sha256:<digest>.",
          "Verify that the execution host can run rootless/non-root containers with read-only rootfs and disabled network.",
        ],
      },
      {
        title: "4. Harden the Web BFF and Execution Server",
        body: "Verify network topology and secrets between apps/web and apps/server:",
        bullets: [
          "Place apps/server on an internal private network reachable only by the apps/web BFF (and an ingress proxy for /api/webhooks/triggers/:id if using external webhooks).",
          "Set a strong random AUTH_SECRET in apps/web and matching BFF principal signing credentials between apps/web and apps/server.",
          "Configure company and project Cost Budgets (/o/<orgSlug>/budgets) before enabling autonomous routines or external webhooks.",
        ],
      },
    ],
  },

  troubleshooting: {
    title: "Troubleshooting guide",
    intro:
      "Quickly diagnose and fix the most common issues across sign-in, organization routing, workflow validation, blocked tasks, paused approvals, budgets, CLI workers, and webhooks.",
    overview: [
      { label: "Auth & 404s", value: "Check AUTH_SECRET, DB migrations & /o/<slug>" },
      { label: "Workflow Won't Run", value: "Click Validate in toolbar & check archetype rules" },
      { label: "Task Stuck / Paused", value: "Check blockedBy dependencies or waiting_for_human approval" },
      { label: "CLI Spawn Error", value: "Check CLI_AGENT_ALLOWED_EXECUTABLES (.exe on Windows)" },
    ],
    items: [
      {
        title: "1. Cannot sign in, or /o/<orgSlug> returns 404",
        body: "If login fails or opening an organization URL shows a 404 page:",
        bullets: [
          "Verify PostgreSQL is running (pnpm db:dev:up) and both migrations have been applied (pnpm db:migrate).",
          "Check that apps/web/.env.local has AUTH_SECRET and MEMORY_DATABASE_URL pointing to the same database as apps/server/.env.",
          "Remember that Organization Layout (/o/[orgSlug]) returns 404 if your user account is not an active member of that organization slug or if the slug was recently renamed in Settings.",
        ],
      },
      {
        title: "2. Workflow refuses to save or Run button is disabled",
        body: "The Run workflow button in the Editor Toolbar is disabled whenever the graph has validation errors:",
        bullets: [
          "Click the Validate button in the Editor Toolbar—Studio automatically focuses the first offending node or archetype field.",
          "LINEAR_PIPELINE_CYCLE_FORBIDDEN: Your graph has a loop while set to Linear Pipeline. Remove the cycle or switch the archetype to Hierarchical Supervisor / Evaluator-Optimizer / Autonomous Swarm.",
          "MISSING_SUPERVISOR_HUB / UNGUARDED_CYCLE: In Hierarchical Supervisor mode, select a valid Agent node as the Supervisor Hub and add a Recursion Guard with a wired fallback branch.",
          "Session key missing: If an Agent node uses sessionMode = shared, you must enter a non-empty sessionKey.",
        ],
      },
      {
        title: "3. Task refuses to start or move across columns",
        body: "When the Task Board displays a red error banner on Start or drag-and-drop:",
        bullets: [
          "Blocked by dependencies: The banner lists unfinished upstream tasks ('Blocked by: ...'). Complete those tasks first or edit the task to remove the dependency.",
          "Missing workspace selection: If a project has explicit Project Workspaces, you must select a workspace on the task.",
          "Agent disabled or missing: Ensure the assigned agent or every agent inside the assigned workflow is enabled in the Agent Registry.",
        ],
      },
      {
        title: "4. Run is stuck in waiting_for_human",
        body: "waiting_for_human is not a failure—the run is paused at a Human Approval Gate:",
        bullets: [
          "Open the run at /o/<orgSlug>/runs/<runId> (or attach to it on the Live Canvas).",
          "In the Approval Panel, review the proposal and click Approve or Reject.",
          "Do not create a second task to bypass a paused run; resolving the approval resumes the existing run from its checkpoint.",
        ],
      },
      {
        title: "5. Agent invocation fails with Budget Exceeded or Credential Error",
        body: "If a run fails immediately before calling the LLM provider:",
        bullets: [
          "Budget exceeded: Open /o/<orgSlug>/budgets and check if your Company, Agent, or Project budget has reached 100% (spentUsd + reservedUsd). Increase the Monthly USD cap if appropriate.",
          "Credential / Provider error: Check the Backend health panel on the Agent Detail page (/o/<orgSlug>/org/agents/<agentId>). In local dev, ensure the provider API key is set in apps/server/.env; in production, check Credential Broker health (GET /v1/health) and lease policy.",
        ],
      },
      {
        title: "6. CLI Agent fails to spawn on Windows",
        body: "When using a CLI backend (codex, claude, agent, agy) on Windows with CLI_WORKER_MODE=local:",
        bullets: [
          "Node.js child_process.spawn with shell: false cannot execute npm .cmd wrapper scripts directly.",
          "Point CLI_AGENT_ALLOWED_EXECUTABLES and the agent's Executable field to the actual underlying .exe binary (or run the agent inside a Linux container with CLI_WORKER_MODE=container).",
        ],
      },
    ],
  },

  limitations: {
    title: "Limitations & roadmap",
    intro:
      "Multi-Agent Studio documents clearly what is proven in automated test suites, what requires deployment-specific wiring, and what is planned next on the roadmap.",
    overview: [
      { label: "Automated Suite", value: "63+ suites / 900+ tests green" },
      { label: "Broker Persistence", value: "Proven on PostgreSQL 16" },
      { label: "Deployment Boundaries", value: "Shared rate-limit store, real mTLS certs, prod Vault" },
    ],
    items: [
      {
        title: "1. Known deployment-specific gaps",
        body: "When deploying multi-instance clusters in production, account for these architectural boundaries:",
        bullets: [
          "Process-local rate limiting: The Credential Broker and inbound webhook rate limiters currently track counters in process memory. Multi-instance broker deployments should place a shared rate-limit store or API gateway in front.",
          "Standalone broker directory wiring: The standalone broker entrypoint (src/broker/server.ts) defaults to deny-all authorization until wired to your deployment's AuthorizationSource and QuotaUsageSource.",
          "Server-mediated worker credential delivery: CLI worker credentials are currently resolved by the execution server and injected into the worker runtime; direct worker-to-broker lease consumption is a future milestone.",
        ],
      },
      {
        title: "2. Verification proof boundaries",
        body: "We distinguish between local test harness verification and live infrastructure proof:",
        bullets: [
          "mTLS transport is code-verified in unit/integration tests, but real certificate chains must be verified in your target deployment environment.",
          "VaultSecretStore is proven against a specification-compliant fake HTTP KV v2 server in automated tests; always run smoke tests against your live HashiCorp Vault cluster during staging.",
        ],
      },
      {
        title: "3. Next roadmap milestones",
        body: "Upcoming engineering priorities for the platform:",
        bullets: [
          "Distributed Redis/PostgreSQL rate-limiting for multi-instance broker and webhook clusters.",
          "Worker-direct single-use lease consumption from isolated container workers.",
          "Expanded OpenTelemetry / Langfuse trace correlation across nested subgraphs and autonomous routines.",
        ],
      },
    ],
  },
};
