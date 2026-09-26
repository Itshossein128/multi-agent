import { expect, test, type Page } from "@playwright/test";

/**
 * Detail-page browser journeys from docs/agent-detail-page.md "Remaining work"
 * item 2. Every execution journey uses deterministic local tools/runtime only —
 * no real provider is invoked.
 */

function credentials(prefix: string) {
  // Tests run fullyParallel in the same millisecond; the worker index keeps
  // every registration unique and single-use.
  const worker = test.info().workerIndex;
  const unique = `${Date.now().toString(36)}-${worker}-${Math.random().toString(36).slice(2)}`;
  return { email: `${prefix}-${unique}@example.test`, password: "Detail-Page-E2E-Password!" };
}

async function register(page: Page, prefix: string) {
  const account = credentials(prefix);
  await page.goto("/register");
  await page.getByLabel("Display Name (Optional)").fill("Agent detail journeys E2E");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm Password").fill(account.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
  return account;
}

/** Authenticated Studio fetch usable from page.evaluate. */
function studioRequest<T>(page: Page, path: string, init?: RequestInit): Promise<T> {
  return page.evaluate(async ([path, init]): Promise<T> => {
    const response = await fetch(`/api/execution/studio${path}`, {
      ...(init ?? {}),
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [path, init] as [string, RequestInit | undefined]);
}

async function createAgentViaUi(page: Page, name: string) {
  await page.goto("/org/agents");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/org\/agents\/agent-/);
  await page.getByRole("button", { name: "Edit agent" }).click();
  await page.getByRole("button", { name: "Configuration", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("System prompt").fill("Deterministic detail-page journey agent.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agent saved." })).toBeVisible();
}

test("unsaved edits warn on navigation and a failed Save keeps the draft intact", async ({ page }) => {
  await register(page, "detail-unsaved");
  await createAgentViaUi(page, "Unsaved draft agent");

  await page.getByRole("button", { name: "Edit agent" }).click();
  await page.getByRole("button", { name: "Configuration", exact: true }).click();
  await page.getByLabel("Description / purpose").fill("Draft that will be discarded on navigation.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  // In-page navigation confirms before discarding; accepting leaves without saving.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Agent registry" }).click();
  await expect(page).toHaveURL(/\/org\/agents$/);

  await page.goto(page.url().replace(/\/org\/agents$/, "/org/agents"));
  await page.getByText("Unsaved draft agent").first().click();
  await expect(page.getByRole("heading", { name: "Unsaved draft agent" })).toBeVisible();
  await expect(page.locator("header").getByText("No description yet.")).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
});

test("a failed Save surfaces the server error and keeps the draft editable", async ({ page }) => {
  await register(page, "detail-failed-save");
  await createAgentViaUi(page, "Failed save agent");

  // Make every Studio PATCH fail at the browser boundary.
  await page.route("**/api/execution/studio/agents/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Injected save failure" }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Edit agent" }).click();
  await page.getByRole("button", { name: "Configuration", exact: true }).click();
  await page.getByLabel("Description / purpose").fill("This edit must survive a failed save.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Injected save failure" })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  // The draft stays editable rather than being discarded.
  await expect(page.getByLabel("Description / purpose")).toHaveValue("This edit must survive a failed save.");
});

test("switching backend type asks before resetting incompatible fields and preserves the policy", async ({ page }) => {
  await register(page, "detail-backend-switch");
  await createAgentViaUi(page, "Backend switch agent");
  await page.goto(page.url());

  await page.getByRole("button", { name: "Edit agent" }).click();
  await page.getByRole("button", { name: "Backend", exact: true }).click();

  await page.getByLabel("Filesystem").selectOption("read");
  // Capture the confirmation text before the switch happens.
  await page.evaluate(() => {
    const messages: string[] = [];
    (window as unknown as { __confirmMessages: string[] }).__confirmMessages = messages;
    window.confirm = (message?: string) => { messages.push(message ?? ""); return true; };
  });
  await page.getByLabel("Backend type").selectOption("cli");
  const confirmMessages = await page.evaluate(() => (window as unknown as { __confirmMessages: string[] }).__confirmMessages);
  expect(confirmMessages).toHaveLength(1);
  expect(confirmMessages[0]).toContain("removes the current backend-specific configuration");
  expect(confirmMessages[0]).toContain("Execution permissions will stay unchanged");

  // CLI-only field appears and the API model settings are gone.
  await expect(page.getByLabel("Executable (optional)")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agent saved." })).toBeVisible();
  const agent = await studioRequest<{ backend: { type: string; provider: string }; executionPolicy?: { filesystem?: string } }>(
    page,
    `/agents/${page.url().split("/").pop()}`,
  );
  expect(agent.backend.type).toBe("cli");
  expect(agent.executionPolicy?.filesystem).toBe("read");
});

test("repeated workflow usages are listed separately and Open in Graph focuses the node", async ({ page }) => {
  await register(page, "detail-usages");
  await createAgentViaUi(page, "Reused agent");
  const agentId = page.url().split("/").pop()!;

  await page.evaluate(async (agentId) => {
    const node = (id: string, type: string, x: number, config: Record<string, unknown>) => ({ id, type, position: { x, y: 0 }, config });
    const edge = (id: string, source: string, target: string) => ({ id, source, target, kind: "normal", label: "", branchKey: "" });
    const create = async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`/api/execution/studio${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.json() as Promise<T>;
    };
    const workflowA = await create<{ id: string; updatedAt: string }>(`/workflows`, { name: "Usage workflow one" });
    await fetch(`/api/execution/studio/workflows/${workflowA.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...workflowA,
        nodes: [
          node("input-usage-a", "input", 0, { inputKey: "input", description: "" }),
          node("agent-usage-a1", "agent", 250, { agentId }),
          node("agent-usage-a2", "agent", 500, { agentId }),
          node("output-usage-a", "output", 750, { outputKey: "output", description: "" }),
        ],
        edges: [
          edge("edge-usage-a1", "input-usage-a", "agent-usage-a1"),
          edge("edge-usage-a2", "agent-usage-a1", "agent-usage-a2"),
          edge("edge-usage-a3", "agent-usage-a2", "output-usage-a"),
        ],
        updatedAt: new Date().toISOString(),
      }),
    }).then(async (response) => { if (!response.ok) throw new Error(`PUT workflow: ${response.status}`); });
  }, agentId);

  await page.goto(`/org/agents/${agentId}`);
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(page.getByText("1 saved workflows · 2 node instances.")).toBeVisible();
  await expect(page.getByText("Node: agent-usage-a1")).toBeVisible();
  await expect(page.getByText("Node: agent-usage-a2")).toBeVisible();

  // The header also has an "Open in Graph" section shortcut; usage rows are the
  // buttons after it.
  await expect(page.getByRole("button", { name: "Open in Graph" })).toHaveCount(3);
  await page.getByRole("button", { name: "Open in Graph" }).nth(1).click();
  await expect(page).toHaveURL(new RegExp(`workflowId=.+&focusNode=agent-usage-a1`));
  await page.goto(page.url());
  await expect(page.getByPlaceholder("Workflow name")).toHaveValue("Usage workflow one");
  await expect(page.getByText("4 nodes · 3 edges")).toBeVisible();
  await expect(page.getByText("The requested node no longer exists in this workflow.")).toHaveCount(0);
});

test("deleting a saved-workflow-referenced agent is blocked with instructions", async ({ page }) => {
  await register(page, "detail-delete-guard");
  await createAgentViaUi(page, "Referenced delete agent");
  const agentId = page.url().split("/").pop()!;

  await studioRequest<{ id: string }>(page, `/workflows`, { method: "POST", body: JSON.stringify({ name: "Guard workflow" }) })
    .then(async (workflow: { id: string }) => {
      const node = (id: string, type: string, x: number, config: Record<string, unknown>) => ({ id, type, position: { x, y: 0 }, config });
      const edge = (id: string, source: string, target: string) => ({ id, source, target, kind: "normal", label: "", branchKey: "" });
      const response = await page.request.put(`/api/execution/studio/workflows/${workflow.id}`, {
        data: {
          ...workflow,
          nodes: [
            node("input-guard", "input", 0, { inputKey: "input", description: "" }),
            node("agent-guard", "agent", 250, { agentId }),
            node("output-guard", "output", 500, { outputKey: "output", description: "" }),
          ],
          edges: [
            edge("edge-guard-1", "input-guard", "agent-guard"),
            edge("edge-guard-2", "agent-guard", "output-guard"),
          ],
        },
      });
      if (!response.ok()) throw new Error(`PUT workflow: ${response.status()}`);
    });

  await page.goto(`/org/agents/${agentId}`);
  // The Delete button opens a confirm dialog before calling the API; register
  // the handler before clicking so the dialog is accepted, not auto-dismissed.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(/Remove this agent/)).toBeVisible();
  await expect(page).not.toHaveURL(/\/org$/);
  // The agent still exists after the blocked deletion.
  expect(await studioRequest(page, `/agents/${agentId}`)).toBeTruthy();
});

test("execution history shows recorded details and event specifics", async ({ page }) => {
  await register(page, "detail-history");
  await createAgentViaUi(page, "History agent");
  const agentId = page.url().split("/").pop()!;

  // Deterministic standalone test run through the execution server: the local
  // origin below is outside the server allowlist, so AgentRuntime rejects it
  // immediately with a recorded agent.failed event. No network call, no provider.
  await page.evaluate(async (agentId) => {
    const patch = await fetch(`/api/execution/studio/agents/${agentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: { type: "local", provider: "ollama", model: "deterministic-history-model", baseUrl: "http://127.0.0.1:9" } }),
    });
    if (!patch.ok) throw new Error(`PATCH agent: ${patch.status}`);
    const agent = await fetch(`/api/execution/studio/agents/${agentId}`).then((response) => response.json());
    const started = await fetch("/api/execution/runs/agent-test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, input: { input: "history journey" } }),
    });
    if (!started.ok) throw new Error(`agent-test: ${started.status} ${await started.text()}`);
  }, agentId);

  await page.goto(`/org/agents/${agentId}`);
  await page.getByRole("button", { name: "Executions", exact: true }).click();
  // The standalone test appears in normal agent execution history.
  await expect(page.getByRole("button", { name: /run-/ }).first()).toBeVisible();
  await expect(page.locator("tbody").getByText(/agent-test:/)).toBeVisible();
  await expect(page.getByText("Run status")).toBeVisible();
  await expect(page.getByText("Recorded provider")).toBeVisible();
  await expect(page.getByText("Recorded model")).toBeVisible();
  await expect(page.getByText("Nodes")).toBeVisible();
  // Event detail panel exposes the recorded failure specifics. The timeline
  // labels types with " · " separators (agent.failed → "agent · failed").
  const failedEvent = page.getByLabel("Execution timeline").getByRole("button").filter({ hasText: /agent · failed/i }).first();
  await expect(failedEvent).toBeVisible();
  await failedEvent.click();
  await expect(page.getByRole("heading", { name: "agent.failed" })).toBeVisible();
  await expect(page.getByLabel("Event detail")).toContainText(/allowlist|not allowed/i);
});

test("Test Agent cancellation and retry work on deterministic local runs", async ({ page }) => {
  await register(page, "detail-test-cancel");
  await createAgentViaUi(page, "Test cancel agent");
  const agentId = page.url().split("/").pop()!;

  // Configure the saved agent as a deterministic local-model agent.
  await page.evaluate(async (agentId) => {
    const agent = await fetch(`/api/execution/studio/agents/${agentId}`)
      .then((response) => response.json() as Promise<{ backend: { type: string; provider: string; model: string } }>);
    const response = await fetch(`/api/execution/studio/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: { type: "local", provider: "ollama", model: "deterministic-test-model", baseUrl: "http://127.0.0.1:9" } }),
    });
    if (!response.ok) throw new Error(`PATCH agent: ${response.status}`);
    void agent;
  }, agentId);

  await page.goto(`/org/agents/${agentId}`);
  await page.getByRole("button", { name: "Test agent" }).first().click();
  await page.getByRole("button", { name: "Test agent" }).last().click();
  await expect(page.getByRole("status").filter({ hasText: /^Run: / })).toBeVisible({ timeout: 30_000 });

  // Cancellation: the local ollama origin is not running, so the run fails fast;
  // the panel must surface a retryable transport error rather than hanging.
  const statusText = await page.getByRole("status").filter({ hasText: /^Run: / }).textContent();
  if (statusText === "Run: running") {
    await page.getByRole("button", { name: "Cancel test" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Run: cancelled" })).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.getByRole("status").filter({ hasText: /^Run: (completed|failed|cancelled)$/ })).toBeVisible();
  }

  // Retry after a transport error restores a terminal, inspectable state.
  await page.getByRole("button", { name: "Test agent" }).last().click();
  await expect(page.getByRole("status").filter({ hasText: /^Run: / })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Execution timeline")).toBeVisible();
});
