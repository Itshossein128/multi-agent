import { expect, test, type Page } from "@playwright/test";

function credentials(prefix: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { email: `${prefix}-${unique}@example.test`, password: "Studio-E2E-Password!" };
}

async function register(page: Page, prefix: string) {
  const account = credentials(prefix);
  await page.goto("/register");
  await page.getByLabel("Display Name (Optional)").fill("Studio lifecycle E2E");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm Password").fill(account.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
  return account;
}

test("registration establishes a session; sign-out protects routes; credentials sign back in", async ({ page }) => {
  const account = await register(page, "auth-lifecycle");

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session");
    return response.json() as Promise<{ user?: { email?: string; id?: string; tenantId?: string } }>;
  });
  expect(session.user).toMatchObject({ email: account.email });
  expect(session.user?.id).toBeTruthy();
  expect(session.user?.tenantId).toBeTruthy();

  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/org");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Forg/);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password", { exact: true })).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/org$/);
  await expect(page.getByRole("button", { name: "Sign Out" })).toBeVisible();
});

test("agent registry supports create, persisted configuration, duplicate, and delete", async ({ page }) => {
  await register(page, "agent-lifecycle");
  await page.goto("/org/agents");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/org\/agents\/agent-/);
  const originalUrl = page.url();

  await page.getByRole("button", { name: "Edit agent" }).click();
  await page.getByRole("button", { name: "Configuration", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser configured agent");
  await page.getByLabel("Description / purpose").fill("Configured and persisted through the real browser UI.");
  await page.getByLabel("System prompt").fill("Return deterministic test output only.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Agent saved.");
  await expect(page.getByRole("heading", { name: "Browser configured agent" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Browser configured agent" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "Configured and persisted through the real browser UI." })).toBeVisible();

  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page).not.toHaveURL(originalUrl);
  await expect(page.getByRole("heading", { name: "Browser configured agent (copy)" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/org$/);
  const namesAfterCopyDelete = await page.evaluate(async () => {
    const response = await fetch("/api/execution/studio/agents");
    const agents = await response.json() as Array<{ name: string }>;
    return agents.map((agent) => agent.name);
  });
  expect(namesAfterCopyDelete).toContain("Browser configured agent");
  expect(namesAfterCopyDelete).not.toContain("Browser configured agent (copy)");
});

test("workflow create/edit/validate persists and a local deterministic failure is observable and retryable", async ({ page }) => {
  await register(page, "workflow-lifecycle");
  await page.goto("/org");
  page.once("dialog", (dialog) => dialog.accept("Browser lifecycle workflow"));
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(page).toHaveURL(/\/org\?workflowId=wf-/);
  await expect(page.getByPlaceholder("Workflow name")).toHaveValue("Browser lifecycle workflow");

  const fixture = await page.evaluate(async () => {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`/api/execution/studio${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return response.json() as Promise<T>;
    };
    const workflowId = new URLSearchParams(location.search).get("workflowId");
    if (!workflowId) throw new Error("Workflow id missing from editor URL");
    const workflow = await request<{ id: string; name: string; updatedAt: string }>(`/workflows/${workflowId}`);
    const tool = await request<{ id: string }>("/tools", {
      method: "POST",
      body: JSON.stringify({
        name: "Deterministic rejection",
        category: "function",
      }),
    });
    await request(`/tools/${tool.id}`, {
      method: "PATCH",
      body: JSON.stringify({ configuration: { kind: "reject-run", message: "Expected browser lifecycle failure" } }),
    });
    const node = (id: string, type: string, x: number, config: Record<string, unknown>) => ({ id, type, position: { x, y: 0 }, config });
    const edge = (id: string, source: string, target: string) => ({ id, source, target, kind: "normal", label: "", branchKey: "" });
    const definition = {
      ...workflow,
      nodes: [
        node("input-failure-e2e", "input", 0, { inputKey: "input", description: "" }),
        node("tool-failure-e2e", "tool", 250, { toolId: tool.id }),
        node("output-failure-e2e", "output", 500, { outputKey: "output", description: "" }),
      ],
      edges: [
        edge("edge-failure-e2e-1", "input-failure-e2e", "tool-failure-e2e"),
        edge("edge-failure-e2e-2", "tool-failure-e2e", "output-failure-e2e"),
      ],
      updatedAt: new Date().toISOString(),
    };
    await request(`/workflows/${workflowId}`, { method: "PUT", body: JSON.stringify(definition) });
    return { workflowId };
  });

  await page.reload();
  await expect(page.getByText("Workflow is valid")).toBeVisible();
  await expect(page.getByText("3 nodes · 2 edges")).toBeVisible();
  await page.getByPlaceholder("Workflow name").fill("Browser lifecycle workflow edited");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved ·/)).toBeVisible();
  const persistedName = await page.evaluate(async (workflowId) => {
    const response = await fetch(`/api/execution/studio/workflows/${workflowId}`);
    return ((await response.json()) as { name: string }).name;
  }, fixture.workflowId);
  expect(persistedName).toBe("Browser lifecycle workflow edited");

  page.once("dialog", (dialog) => dialog.accept("safe local failure input"));
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  await expect(page.locator("header").getByText("failed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Execution timeline").getByText("run · failed")).toBeVisible();
  await expect(page.getByLabel("Event detail")).toContainText("Expected browser lifecycle failure");
  await expect(page.getByRole("button", { name: "Retry run" })).toBeVisible();

  await page.getByRole("button", { name: "Retry run" }).click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  await expect(page.locator("header").getByText("failed", { exact: true })).toBeVisible();
});
