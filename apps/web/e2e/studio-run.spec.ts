import { expect, test } from "@playwright/test";

test("authenticated browser starts, approves, observes, and reloads a real workflow run", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `phase45-${unique}@example.test`;
  const password = "Phase45-Hardening!";

  await page.goto("/register");
  await page.getByLabel("Display Name (Optional)").fill("Phase 4/5 E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).not.toHaveURL(/\/register/);

  const fixture = await page.evaluate(async (name) => {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`/api/execution/studio${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return response.json() as Promise<T>;
    };
    const tool = await request<{ id: string }>("/tools", { method: "POST", body: JSON.stringify({ name: `${name} echo`, category: "function" }) });
    const workflow = await request<{ id: string; name: string; updatedAt: string }>("/workflows", { method: "POST", body: JSON.stringify({ name }) });
    const node = (id: string, type: string, x: number, config: Record<string, unknown>) => ({ id, type, position: { x, y: 0 }, config });
    const edge = (id: string, source: string, target: string) => ({ id, source, target, kind: "normal", label: "", branchKey: "" });
    const definition = {
      ...workflow,
      nodes: [
        node("input-e2e", "input", 0, { inputKey: "input", description: "" }),
        node("tool-e2e", "tool", 250, { toolId: tool.id }),
        node("approval-e2e", "approval", 500, { message: "Approve browser E2E delivery?", approvalType: "manual", timeoutSeconds: 300 }),
        node("output-e2e", "output", 750, { outputKey: "output", description: "" }),
      ],
      edges: [
        edge("edge-e2e-1", "input-e2e", "tool-e2e"),
        edge("edge-e2e-2", "tool-e2e", "approval-e2e"),
        edge("edge-e2e-3", "approval-e2e", "output-e2e"),
      ],
      updatedAt: new Date().toISOString(),
    };
    await request(`/workflows/${workflow.id}`, { method: "PUT", body: JSON.stringify(definition) });
    localStorage.setItem("agent-studio.active-workflow.v1", workflow.id);
    localStorage.setItem("agent-studio.workspace-imported.v1", "1");
    return { workflowId: workflow.id };
  }, `Phase 4/5 Browser ${unique}`);

  await page.goto("/org");
  await expect(page.getByPlaceholder("Workflow name")).toHaveValue(new RegExp(unique));
  page.once("dialog", (dialog) => dialog.accept("browser e2e input"));
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  await expect(page.getByText("Approve browser E2E delivery?")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator("header").getByText("completed", { exact: true })).toBeVisible();
  await page.getByLabel("Execution timeline").getByRole("button").filter({ hasText: /run.*completed/i }).click();
  await expect(page.getByRole("heading", { name: "run.completed" })).toBeVisible();
  await expect(page.getByLabel("Execution timeline").getByText(/node.*completed/i).first()).toBeVisible();

  const completedUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(completedUrl);
  await expect(page.locator("header").getByText("completed", { exact: true })).toBeVisible();
  await page.getByLabel("Execution timeline").getByRole("button").filter({ hasText: /run.*completed/i }).click();
  await expect(page.getByRole("heading", { name: "run.completed" })).toBeVisible();
  expect(fixture.workflowId).toBeTruthy();
});
