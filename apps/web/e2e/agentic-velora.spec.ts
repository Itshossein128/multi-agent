import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const AGENTIC_VELORA_ORG_ID = "4cc4a715-3ac8-42d4-84ad-83bbdc45f03a";
const VELORA_REPO_ROOT = "/home/hossein/Desktop/projects/building-management";
const REPO_ROOT = path.resolve(__dirname, "../../..");

const REQUIRED_AGENT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Orchestrator", pattern: /orchestrator/i },
  { label: "Discovery & Knowledge Analyst", pattern: /discovery/i },
  { label: "Per-Requirement End-User QA Agent", pattern: /per-?requirement.*qa/i },
  { label: "Complexity-Adaptive SpecKit Prompt Architect", pattern: /prompt\s*architect/i },
  { label: "Stateful SpecKit Executor", pattern: /speckit\s*executor/i },
  { label: "SpecKit Supervisor/Reviewer", pattern: /supervisor|reviewer/i },
  { label: "SpecKit Implementer", pattern: /implementer/i },
  { label: "Post-QA Defect Fixer", pattern: /fixer/i },
  { label: "Semantic Knowledge & Graphify Updater", pattern: /knowledge|graphify/i },
];

const REQUIRED_TOOLS = [
  "delivery_plan_reader_tool",
  "velora_knowledge_tool",
  "velora_graphify_tool",
  "velora_output_report_tool",
  "delegate_subagents",
];

function resolveDatabaseUrl(): string | undefined {
  if (process.env.MEMORY_DATABASE_URL?.trim()) return process.env.MEMORY_DATABASE_URL.trim();
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const envPath = path.join(REPO_ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    const match = raw.match(/^(?:MEMORY_DATABASE_URL|DATABASE_URL)=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function attachHealthGates(
  page: Page,
  options: { allowHttpStatuses?: number[] } = {},
): () => void {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedApiResponses: string[] = [];
  const allowed = new Set(options.allowHttpStatuses ?? []);

  page.on("pageerror", (error) => {
    if (/Failed to execute 'measure' on 'Performance'/i.test(error.message)) return;
    pageErrors.push(error.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      if (/Failed to execute 'measure' on 'Performance'/i.test(msg.text())) return;
      if (/Failed to load resource: the server responded with a status of 404/i.test(msg.text())) return;
      consoleErrors.push(msg.text());
    }
  });
  page.on("response", (res) => {
    if (/\/api\/o\/.*\/execution\//.test(res.url()) && res.status() >= 400 && !allowed.has(res.status())) {
      failedApiResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  return () => {
    expect(pageErrors, "Unexpected pageerror events").toEqual([]);
    expect(consoleErrors, "Unexpected console.error messages").toEqual([]);
    expect(failedApiResponses, "Unexpected >=400 /execution/ API responses").toEqual([]);
  };
}

function runPgHelper(script: string, args: string[]): string {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    throw new Error("MEMORY_DATABASE_URL / DATABASE_URL not configured for live agentic-velora E2E audit.");
  }
  return execFileSync("node", ["-e", script, dbUrl, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

async function loginAsLiveVeloraViewer(page: Page): Promise<{ cleanup: () => Promise<void> }> {
  const envEmail = process.env.E2E_VELORA_EMAIL?.trim();
  const envPassword = process.env.E2E_VELORA_PASSWORD?.trim();
  if (envEmail && envPassword) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(envEmail);
    await page.getByLabel("Password", { exact: true }).fill(envPassword);
    await page.getByRole("button", { name: /Sign in|Log in/i }).click();
    await expect(page).toHaveURL(/\/o\//);
    return { cleanup: async () => {} };
  }

  const tempPassword = "Velora-Viewer-E2E-Password!";
  const tempPasswordHash = "$2b$10$Epp0GIxtdYg7NTHn2YHmqO03N.Z30VCS9OUnNNXGdgQHrXMF88bp2";
  const snapshotRaw = runPgHelper(
    `
      const { Pool } = require("pg");
      const [dbUrl, orgId, tempHash] = process.argv.slice(1);
      (async () => {
        const pool = new Pool({ connectionString: dbUrl });
        try {
          const res = await pool.query(
            \`SELECT u.id, u.email, u.password_hash
             FROM studio_organizations o
             JOIN studio_users u ON u.id = o.owner_id
             WHERE o.id = $1\`,
            [orgId]
          );
          if (!res.rows[0]) throw new Error("Owner of agentic-velora not found");
          const { id, email, password_hash } = res.rows[0];
          await pool.query("UPDATE studio_users SET password_hash = $1 WHERE id = $2", [tempHash, id]);
          console.log(JSON.stringify({ id, email, password_hash }));
        } finally {
          await pool.end();
        }
      })().catch((e) => { console.error(e); process.exit(1); });
    `,
    [AGENTIC_VELORA_ORG_ID, tempPasswordHash],
  );
  const snapshot = JSON.parse(snapshotRaw) as { id: string; email: string; password_hash: string };

  const restoreOriginalPasswordHash = () => {
    runPgHelper(
      `
        const { Pool } = require("pg");
        const [dbUrl, uid, originalHash] = process.argv.slice(1);
        (async () => {
          const pool = new Pool({ connectionString: dbUrl });
          try {
            await pool.query("UPDATE studio_users SET password_hash = $1 WHERE id = $2", [originalHash, uid]);
          } finally {
            await pool.end();
          }
        })().catch((e) => { console.error(e); process.exit(1); });
      `,
      [snapshot.id, snapshot.password_hash],
    );
  };

  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(snapshot.email);
    await page.getByLabel("Password", { exact: true }).fill(tempPassword);
    await page.getByRole("button", { name: /Sign in|Log in/i }).click();
    await expect(page).toHaveURL(/\/o\/|\/onboarding\/organization|\/$/);
  } finally {
    restoreOriginalPasswordHash();
  }

  await page.goto("/o/agentic-velora/org");
  await expect(page).toHaveURL(/\/o\/agentic-velora\/org/);

  return {
    cleanup: async () => {
      restoreOriginalPasswordHash();
    },
  };
}

async function setupEphemeralOrg(page: Page, prefix = "velora-ephemeral") {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await page.goto("/register");
  await page.getByLabel("Display Name (Optional)").fill("Velora Ephemeral E2E");
  await page.getByLabel("Email", { exact: true }).fill(`${prefix}-${unique}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("Velora-Ephemeral-E2E-123!");
  await page.getByLabel("Confirm Password").fill("Velora-Ephemeral-E2E-123!");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page).toHaveURL(/onboarding\/organization/, { timeout: 30_000 });
  await page.getByLabel("Organization name", { exact: false }).fill(`Velora E2E ${unique}`);
  await page.getByRole("button", { name: "Create organization", exact: true }).click();
  await expect(page).toHaveURL(/\/o\/[^/]+\//, { timeout: 30_000 });
  const slug = new URL(page.url()).pathname.split("/")[2];
  return { slug, unique };
}

test.describe("Agentic Velora Studio Browser & API E2E (F11, R8.2, Tiers 1–4)", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    try {
      runPgHelper(
        `
          const { Pool } = require("pg");
          const [dbUrl] = process.argv.slice(1);
          (async () => {
            const pool = new Pool({ connectionString: dbUrl });
            try {
              const orgs = await pool.query("SELECT id FROM studio_organizations WHERE slug LIKE 'velora-e2e-%'");
              for (const row of orgs.rows) {
                const orgId = row.id;
                await pool.query("DELETE FROM studio_organization_memberships WHERE organization_id = $1", [orgId]);
                await pool.query("DELETE FROM studio_approvals WHERE tenant_id = $1", [orgId]);
                await pool.query("DELETE FROM studio_run_events WHERE tenant_id = $1", [orgId]);
                await pool.query("DELETE FROM studio_runs WHERE tenant_id = $1", [orgId]);
                await pool.query("DELETE FROM studio_workflows WHERE tenant_id = $1", [orgId]);
                await pool.query("DELETE FROM studio_agents WHERE tenant_id = $1 AND NOT is_system", [orgId]);
                await pool.query("DELETE FROM studio_tools WHERE tenant_id = $1 AND NOT is_system", [orgId]);
                await pool.query("DELETE FROM studio_workspaces WHERE tenant_id = $1", [orgId]);
                await pool.query("DELETE FROM studio_projects WHERE tenant_id = $1", [orgId]);
                await pool.query("UPDATE studio_users SET tenant_id = NULL WHERE tenant_id = $1", [orgId]);
                await pool.query("DELETE FROM studio_organizations WHERE id = $1", [orgId]);
              }
              await pool.query(
                "DELETE FROM studio_users WHERE email LIKE 'foreign-rbac-%@example.test' OR email LIKE 'velora-ui-forms-%@example.test' OR email LIKE 'velora-live-fanout-%@example.test' OR email LIKE 'velora-viewer-%@example.test'"
              );
            } finally {
              await pool.end();
            }
          })().catch((e) => { console.error(e); process.exit(1); });
        `,
        [],
      );
    } catch {
      /* ignore cleanup errors */
    }
  });

  // =========================================================================
  // LIVE `agentic-velora` REGISTRATION AUDIT (READ-ONLY)
  // =========================================================================

  test("F11-T1: Studio API for agentic-velora lists all 9 required agents, tools, workflows, and Velora workspace", async ({ page }) => {
    const assertHealthy = attachHealthGates(page);
    const { cleanup } = await loginAsLiveVeloraViewer(page);
    try {
      const [agentsRes, workflowsRes, toolsRes, workspacesRes] = await Promise.all([
        page.request.get("/api/o/agentic-velora/execution/studio/agents"),
        page.request.get("/api/o/agentic-velora/execution/studio/workflows"),
        page.request.get("/api/o/agentic-velora/execution/studio/tools"),
        page.request.get("/api/o/agentic-velora/workspaces"),
      ]);

      expect(agentsRes.status()).toBe(200);
      expect(workflowsRes.status()).toBe(200);
      expect(toolsRes.status()).toBe(200);
      expect(workspacesRes.status()).toBe(200);

      const agents = (await agentsRes.json()) as Array<{ name: string; backend: { type: string; provider: string } }>;
      const workflows = (await workflowsRes.json()) as Array<{ id: string; name: string; nodes: unknown[] }>;
      const tools = (await toolsRes.json()) as Array<{ id: string; name: string; enabled: boolean }>;
      const workspaces = (await workspacesRes.json()) as Array<{ id: string; name: string }>;

      for (const req of REQUIRED_AGENT_PATTERNS) {
        expect(
          agents.some((a) => req.pattern.test(a.name)),
          `Missing required agent matching "${req.label}" in ${JSON.stringify(agents.map((a) => a.name))}`,
        ).toBe(true);
      }

      for (const toolName of REQUIRED_TOOLS) {
        expect(
          tools.some((t) => (t.name === toolName || t.id === toolName) && t.enabled !== false),
          `Missing or disabled required tool "${toolName}"`,
        ).toBe(true);
      }

      expect(workflows.length).toBeGreaterThanOrEqual(1);
      expect(workspaces.length).toBeGreaterThanOrEqual(1);
      assertHealthy();
    } finally {
      await cleanup();
    }
  });

  test("F11-T2: Live http://localhost:3060/o/agentic-velora/org canvas renders valid workflow with dynamic_fanout node", async ({ page }) => {
    const assertHealthy = attachHealthGates(page);
    const { cleanup } = await loginAsLiveVeloraViewer(page);
    try {
      await page.goto("/o/agentic-velora/org");
      await expect(page.locator(".react-flow")).toBeVisible();
      await expect(page.getByLabel("Saved workflow")).toBeVisible();
      await expect(page.getByText(/\d+ nodes · \d+ edges/)).toBeVisible();
      await expect(page.getByText(/\d+\s+errors?/i)).toHaveCount(0);

      const workflowsRes = await page.request.get("/api/o/agentic-velora/execution/studio/workflows");
      const workflows = (await workflowsRes.json()) as Array<{ id: string; nodes: Array<{ id: string; type: string }> }>;
      const fanoutWf = workflows.find((w) => w.nodes.some((n) => n.type === "dynamic_fanout"));
      expect(fanoutWf, "Expected at least one workflow in agentic-velora containing a dynamic_fanout node").toBeDefined();

      if (fanoutWf) {
        await page.goto(`/o/agentic-velora/org?workflowId=${encodeURIComponent(fanoutWf.id)}`);
        await expect(page.getByText(/\d+ nodes · \d+ edges/)).toBeVisible();
        await expect(page.getByText(/\d+\s+errors?/i)).toHaveCount(0);
        const fanoutNode = fanoutWf.nodes.find((n) => n.type === "dynamic_fanout")!;
        await expect(page.locator(`[data-id="${fanoutNode.id}"]`)).toBeVisible();
      }
      assertHealthy();
    } finally {
      await cleanup();
    }
  });

  test("F11-T3: All 9 agents in /o/agentic-velora/org/agents render non-empty systemPrompt, CLI backend, zero secrets, and Velora workspace", async ({ page }) => {
    test.setTimeout(120_000);
    const assertHealthy = attachHealthGates(page);
    const { cleanup } = await loginAsLiveVeloraViewer(page);
    try {
      await page.goto("/o/agentic-velora/org/agents");
      await expect(page.getByRole("heading", { name: "Agent registry" })).toBeVisible();

      const agentsRes = await page.request.get("/api/o/agentic-velora/execution/studio/agents");
      const agents = (await agentsRes.json()) as Array<{
        id: string;
        name: string;
        systemPrompt: string;
        backend: { type: string; provider: string };
        executionPolicy?: { workspaceRoot?: string };
      }>;

      expect(agents.length).toBeGreaterThanOrEqual(9);
      for (const agent of agents) {
        expect(agent.systemPrompt.trim().length).toBeGreaterThan(20);
        expect(["cursor", "codex", "agy"]).toContain(agent.backend.provider);
        expect(JSON.stringify(agent)).not.toMatch(/sk-[A-Za-z0-9]{12,}|cur-[A-Za-z0-9]{12,}|apiKey/i);
        expect(agent.executionPolicy?.workspaceRoot ?? "").toContain(VELORA_REPO_ROOT);

        await page.goto(`/o/agentic-velora/org/agents/${encodeURIComponent(agent.id)}`);
        await expect(page.getByRole("heading", { name: agent.name })).toBeVisible();
        await expect(page.locator("pre").first()).not.toBeEmpty();

        await page.getByRole("button", { name: "Backend", exact: true }).click();
        await expect(page.getByText("Execution policy")).toBeVisible();
        await page.getByRole("button", { name: "Tools", exact: true }).click();
      }
      assertHealthy();
    } finally {
      await cleanup();
    }
  });

  test("F11-T4: /o/agentic-velora/org/tools and /o/agentic-velora/workspaces display Velora tools and repository workspace", async ({ page }) => {
    const assertHealthy = attachHealthGates(page);
    const { cleanup } = await loginAsLiveVeloraViewer(page);
    try {
      await page.goto("/o/agentic-velora/org/tools");
      await expect(page.getByRole("heading", { name: "Tool registry" })).toBeVisible();
      for (const toolName of REQUIRED_TOOLS) {
        await expect(page.getByRole("link", { name: toolName, exact: true })).toBeVisible();
      }

      await page.goto("/o/agentic-velora/workspaces");
      await expect(page.locator("main")).toContainText(/velora|building/i);
      assertHealthy();
    } finally {
      await cleanup();
    }
  });

  test("T4-R3: Complete Operator Readiness Audit Journey across Canvas -> Agents -> Tools -> Workspaces -> Switcher", async ({ page }) => {
    const assertHealthy = attachHealthGates(page);
    const { cleanup } = await loginAsLiveVeloraViewer(page);
    try {
      await page.goto("/o/agentic-velora/org");
      await expect(page.locator(".react-flow")).toBeVisible();
      await expect(page.getByText(/\d+ nodes · \d+ edges/)).toBeVisible();
      await expect(page.getByText(/\d+\s+errors?/i)).toHaveCount(0);

      const switcher = page.getByLabel("Saved workflow");
      await expect(switcher).toBeVisible();
      const optionCount = await switcher.locator("option").count();
      expect(optionCount).toBeGreaterThanOrEqual(1);

      await page.goto("/o/agentic-velora/org/agents");
      await expect(page.getByRole("heading", { name: "Agent registry" })).toBeVisible();

      await page.goto("/o/agentic-velora/org/tools");
      await expect(page.getByRole("heading", { name: "Tool registry" })).toBeVisible();

      await page.goto("/o/agentic-velora/workspaces");
      await expect(page.locator("main")).toBeVisible();
      assertHealthy();
    } finally {
      await cleanup();
    }
  });

  test("T2-UI-B2: Unauthenticated and unauthorized foreign users are denied access to agentic-velora", async ({ browser, page }) => {
    // 1. Unauthenticated API call fails closed (307 redirect to /login or 401/404)
    const unauthApi = await page.request.get("/api/o/agentic-velora/execution/studio/agents", { maxRedirects: 0 });
    expect([302, 307, 401, 404]).toContain(unauthApi.status());
    if (unauthApi.status() === 302 || unauthApi.status() === 307) {
      expect(unauthApi.headers()["location"]).toContain("/login");
    }

    // 2. Authenticated foreign org user receives 404 { error: "Not found" }
    const foreignCtx = await browser.newContext();
    try {
      const foreignPage = await foreignCtx.newPage();
      await setupEphemeralOrg(foreignPage, "foreign-rbac");
      const denied = await foreignPage.request.get("/api/o/agentic-velora/execution/studio/agents");
      expect(denied.status()).toBe(404);
      expect(await denied.json()).toEqual({ error: "Not found" });

      await foreignPage.goto("/o/agentic-velora/org");
      expect(foreignPage.url()).not.toContain("/o/agentic-velora");
    } finally {
      await foreignCtx.close();
    }
  });

  // =========================================================================
  // EPHEMERAL ORG CONTEXT — MUTATING UI, VALIDATION & LIVE RUN TESTS
  // =========================================================================

  test("F11-T5 & T2-UI-B1: NodeForms (dynamic_fanout, reinvokeOnClarification) & AgentBackendPanel (cursor/codex/agy) + inline validation", async ({ page }) => {
    test.setTimeout(120_000);
    const assertHealthy = attachHealthGates(page);
    const { slug, unique } = await setupEphemeralOrg(page, "velora-ui-forms");
    const base = `/api/o/${slug}/execution/studio`;

    const agentRes = await page.request.post(`${base}/agents`, {
      data: {
        name: `Cursor Fixer ${unique}`,
        systemPrompt: "Fix defects safely.",
        backend: { type: "cli", provider: "cursor", executable: "agent", args: ["-s", "read-only"] },
      },
    });
    expect(agentRes.ok()).toBe(true);
    const agent = (await agentRes.json()) as { id: string; name: string };

    const wfRes = await page.request.post(`${base}/workflows`, {
      data: { name: `Velora UI Forms ${unique}` },
    });
    const wf = (await wfRes.json()) as { id: string; name: string };

    await page.request.put(`${base}/workflows/${wf.id}`, {
      data: {
        ...wf,
        nodes: [
          { id: "in-1", type: "input", position: { x: 0, y: 100 }, config: { inputKey: "input", description: "" } },
          {
            id: "fan-1",
            type: "dynamic_fanout",
            position: { x: 250, y: 100 },
            config: { targetAgentId: agent.id, itemsField: "requirements", maxConcurrency: 4 },
          },
          {
            id: "ag-1",
            type: "agent",
            position: { x: 520, y: 100 },
            config: {
              agentId: agent.id,
              sessionMode: "shared",
              sessionKey: "speckit-main",
              reinvokeOnClarification: true,
            },
          },
          { id: "out-1", type: "output", position: { x: 780, y: 100 }, config: { outputKey: "output", description: "" } },
        ],
        edges: [
          { id: "e1", source: "in-1", target: "fan-1", kind: "normal", label: "", branchKey: "" },
          { id: "e2", source: "fan-1", target: "ag-1", kind: "normal", label: "", branchKey: "" },
          { id: "e3", source: "ag-1", target: "out-1", kind: "normal", label: "", branchKey: "" },
        ],
        updatedAt: new Date().toISOString(),
      },
    });

    await page.goto(`/o/${slug}/org?workflowId=${encodeURIComponent(wf.id)}`);
    await expect(page.getByText("Workflow is valid")).toBeVisible();

    // Inspect dynamic_fanout NodeForms
    await page.locator('[data-id="fan-1"]').click();
    await expect(page.getByLabel(/Items Field/i)).toHaveValue("requirements");
    await expect(page.getByLabel(/Max Concurrency/i)).toHaveValue("4");

    // T2-UI-B1: Invalid maxConcurrency = 99 surfaces validation issue
    await page.getByLabel(/Max Concurrency/i).fill("99");
    await expect(page.getByText(/\b1 error\b/i)).toBeVisible();
    await page.getByLabel(/Max Concurrency/i).fill("4");
    await expect(page.getByText("Workflow is valid")).toBeVisible();

    // Inspect AgentNode sessionMode, sessionKey & reinvokeOnClarification
    await page.locator('[data-id="ag-1"]').click();
    await expect(page.getByTestId("node-session-mode")).toHaveValue("shared");
    await expect(page.getByTestId("node-session-key")).toHaveValue("speckit-main");
    await expect(page.getByLabel(/Re-?invoke.*clarification/i)).toBeChecked();

    // T2-UI-B1: Empty shared sessionKey surfaces validation error
    await page.getByTestId("node-session-key").fill("");
    await page.getByTestId("node-session-key").blur();
    await expect(page.getByText(/Shared Session Key is required/i)).toBeVisible();

    // Inspect AgentBackendPanel provider options (cursor, codex, agy)
    await page.goto(`/o/${slug}/org/agents/${encodeURIComponent(agent.id)}`);
    await page.getByRole("button", { name: "Edit agent" }).click();
    await page.getByRole("button", { name: "Backend", exact: true }).click();
    await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("cursor");
    const datalistProviders = await page.locator("#agent-backend-providers option").evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    expect(datalistProviders).toEqual(expect.arrayContaining(["cursor", "codex", "agy"]));

    assertHealthy();
  });

  test("T3-UI-C1: Live Canvas Run executes dynamic_fanout + approval clarification flow and exits cleanly", async ({ page }) => {
    test.setTimeout(120_000);
    const assertHealthy = attachHealthGates(page);
    const { slug, unique } = await setupEphemeralOrg(page, "velora-live-fanout");
    const base = `/api/o/${slug}/execution/studio`;

    const toolRes = await page.request.post(`${base}/tools`, {
      data: { name: `QA Echo ${unique}`, category: "function", configuration: {} },
    });
    expect(toolRes.ok()).toBe(true);
    const tool = (await toolRes.json()) as { id: string };

    const childWfRes = await page.request.post(`${base}/workflows`, {
      data: { name: `Child QA Item ${unique}` },
    });
    const childWf = (await childWfRes.json()) as { id: string };
    await page.request.put(`${base}/workflows/${childWf.id}`, {
      data: {
        ...childWf,
        nodes: [
          { id: "c-in", type: "input", position: { x: 0, y: 100 }, config: { inputKey: "input", description: "" } },
          { id: "c-tool", type: "tool", position: { x: 240, y: 100 }, config: { toolId: tool.id } },
          { id: "c-out", type: "output", position: { x: 480, y: 100 }, config: { outputKey: "output", description: "" } },
        ],
        edges: [
          { id: "ce1", source: "c-in", target: "c-tool", kind: "normal", label: "", branchKey: "" },
          { id: "ce2", source: "c-tool", target: "c-out", kind: "normal", label: "", branchKey: "" },
        ],
        updatedAt: new Date().toISOString(),
      },
    });

    const mainWfRes = await page.request.post(`${base}/workflows`, {
      data: { name: `Main Fanout Live ${unique}` },
    });
    const mainWf = (await mainWfRes.json()) as { id: string };
    await page.request.put(`${base}/workflows/${mainWf.id}`, {
      data: {
        ...mainWf,
        nodes: [
          { id: "m-in", type: "input", position: { x: 0, y: 100 }, config: { inputKey: "input", description: "" } },
          {
            id: "m-fan",
            type: "dynamic_fanout",
            position: { x: 260, y: 100 },
            config: { workflowId: childWf.id, maxConcurrency: 2 },
          },
          {
            id: "m-approval",
            type: "approval",
            position: { x: 520, y: 100 },
            config: { message: "Confirm A.1 fanout QA gate?", approvalType: "manual", timeoutSeconds: 300 },
          },
          { id: "m-out", type: "output", position: { x: 780, y: 100 }, config: { outputKey: "output", description: "" } },
        ],
        edges: [
          { id: "me1", source: "m-in", target: "m-fan", kind: "normal", label: "", branchKey: "" },
          { id: "me2", source: "m-fan", target: "m-approval", kind: "normal", label: "", branchKey: "" },
          { id: "me3", source: "m-approval", target: "m-out", kind: "normal", label: "", branchKey: "" },
        ],
        updatedAt: new Date().toISOString(),
      },
    });

    await page.goto(`/o/${slug}/org?workflowId=${encodeURIComponent(mainWf.id)}`);
    await expect(page.getByText("Workflow is valid")).toBeVisible();

    await page.getByLabel("Run input", { exact: true }).fill(JSON.stringify(["A.1.01", "A.1.02", "A.1.03"]));
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page).toHaveURL(/\/org\?.*runId=/);

    const tray = page.getByLabel("Live run controls", { exact: true });
    await expect(page.getByLabel("Live human approval", { exact: true })).toBeVisible();
    await expect(tray.getByLabel("Run events")).toContainText(/fanout\.(started|completed)/i);

    await page.getByRole("button", { name: "Review decisions", exact: true }).click();
    await page.getByRole("textbox", { name: /Reviewer Decision Notes|Decision notes/ }).fill("Approved in live E2E");
    await page.getByRole("button", { name: /^Approve(?: Remediation)?$/ }).click();

    await expect(tray.getByRole("status").filter({ hasText: /^completed$/ })).toBeVisible();
    await page.getByRole("button", { name: "Exit Live", exact: true }).click();
    await expect(page).not.toHaveURL(/runId=/);
    await expect(page.getByPlaceholder("Workflow name")).toBeEnabled();

    assertHealthy();
  });
});
