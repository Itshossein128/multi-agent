import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, failing = false) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto("/register");
  await page.getByLabel("Display Name (Optional)").fill("Canvas Live E2E");
  await page.getByLabel("Email", { exact: true }).fill(`canvas-live-${unique}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("Canvas-Live-E2E-Local!");
  await page.getByLabel("Confirm Password").fill("Canvas-Live-E2E-Local!");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page).toHaveURL(/onboarding\/organization/);
  await page.getByLabel("Organization name", { exact: false }).fill(`Canvas E2E ${unique}`);
  await page.getByRole("button", { name: "Create organization", exact: true }).click();
  await expect(page).toHaveURL(/\/o\//);
  const slug = new URL(page.url()).pathname.split("/")[2];
  const base = `/api/o/${slug}/execution/studio`;
  const create = async (path: string, body: unknown, method = "POST") => {
    const response = await page.request.fetch(`${base}${path}`, { method, data: body });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const tool = await create("/tools", { name: `Canvas echo ${unique}`, category: "function", configuration: failing ? { kind: "reject-run", message: "Expected canvas smoke failure" } : {} });
  const workflow = await create("/workflows", { name: `Canvas live ${unique}` });
  const node = (id: string, type: string, x: number, config: unknown) => ({ id, type, position: { x, y: 100 }, config });
  const edge = (id: string, source: string, target: string) => ({ id, source, target, kind: "normal", label: "", branchKey: "" });
  await create(`/workflows/${workflow.id}`, {
    ...workflow,
    nodes: [node("input-e2e", "input", 0, { inputKey: "input", description: "" }), node("tool-e2e", "tool", 270, { toolId: tool.id }), ...(!failing ? [node("approval-e2e", "approval", 540, { message: "Approve canvas E2E delivery?", approvalType: "manual", timeoutSeconds: 300 })] : []), node("output-e2e", "output", 810, { outputKey: "output", description: "" })],
    edges: [edge("e1", "input-e2e", "tool-e2e"), ...(!failing ? [edge("e2", "tool-e2e", "approval-e2e"), edge("e3", "approval-e2e", "output-e2e")] : [edge("e2", "tool-e2e", "output-e2e")])],
    updatedAt: new Date().toISOString(),
  }, "PUT");
  await page.goto(`/o/${slug}/org?workflowId=${workflow.id}`);
  await expect(page.getByPlaceholder("Workflow name")).toHaveValue(workflow.name);
  return { slug, workflowId: workflow.id, workflowName: workflow.name };
}

async function start(page: Page) {
  await page.getByLabel("Run input", { exact: true }).fill("browser E2E input");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page).toHaveURL(/\/org\?.*runId=/);
  return new URL(page.url()).searchParams.get("runId")!;
}

test("run, inspect, approve, reload, bookmark and exit preserve the canvas experience", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { slug, workflowId } = await setup(page);
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const runId = await start(page);
  const tray = page.getByLabel("Live run controls", { exact: true });
  const canvas = page.locator(".react-flow");
  await expect(page.getByLabel("Live human approval", { exact: true })).toBeVisible();
  await expect(page.locator('[data-id="approval-e2e"] [data-live-status="waiting_human"]')).toBeVisible();
  await expect(page.locator(".workflow-live-edge").first()).toBeVisible();
  await page.evaluate(() => { (window as unknown as { canvasSmokeHost: Element | null }).canvasSmokeHost = document.querySelector(".react-flow"); });
  await page.locator('[data-id="tool-e2e"]').click();
  const inspector = page.getByLabel("Node execution inspector", { exact: true });
  await expect(inspector.getByRole("heading", { name: "Tools", exact: true })).toBeVisible();
  await expect(inspector.locator("details")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await expect(canvas).toBeVisible();
  await tray.getByRole("button", { name: "Tool", exact: true }).click();
  await expect(tray.getByLabel("Run events").locator("li")).toHaveCount(2);
  await tray.getByRole("button", { name: "Collapse run timeline", exact: true }).click();
  await expect(tray.getByLabel("Run events")).toHaveCount(0);
  await tray.getByRole("button", { name: "Expand run timeline", exact: true }).click();
  await page.getByRole("button", { name: "Review decisions", exact: true }).click();
  await page.getByRole("textbox", { name: /Reviewer Decision Notes|Decision notes/ }).fill("Verified in the visual canvas");
  await page.getByRole("button", { name: /^Approve(?: Remediation)?$/ }).click();
  await expect(tray.getByRole("status").filter({ hasText: /^completed$/ })).toBeVisible();
  await expect(page.getByLabel("Live human approval", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { canvasSmokeHost: Element | null }).canvasSmokeHost === document.querySelector(".react-flow"))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("live-completed.png") });
  await page.reload();
  await expect(tray.getByRole("status").filter({ hasText: /^completed$/ })).toBeVisible();
  await page.goto(`/o/${slug}/runs/${encodeURIComponent(runId)}`);
  await expect(page.getByRole("heading", { name: "Workflow execution" })).toBeVisible();
  await expect(page.getByLabel("Execution timeline")).toBeVisible();
  await page.getByRole("link", { name: "Open on canvas", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe(`/o/${slug}/org`);
  expect(new URL(page.url()).searchParams.get("workflowId")).toBe(workflowId);
  expect(new URL(page.url()).searchParams.get("runId")).toBe(runId);
  await expect(tray).toBeVisible();
  await page.getByRole("button", { name: "Exit Live", exact: true }).click();
  await expect(page).not.toHaveURL(/runId=/);
  await expect(page.getByPlaceholder("Workflow name")).toBeEnabled();
  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});

test("Cancel remains server-owned and failed Retry attaches the new run", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.url().includes("/execution/") && response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });
  const { slug, workflowId, workflowName } = await setup(page);
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await start(page);
  const tray = page.getByLabel("Live run controls", { exact: true });
  await expect(page.getByLabel("Live human approval", { exact: true })).toBeVisible();
  await tray.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(tray.getByRole("status").filter({ hasText: /^cancelled$/ })).toBeVisible();
  // Use a server-defined data-only function failure, with no external providers.
  const tools = await (await page.request.get(`/api/o/${slug}/execution/studio/tools`)).json();
  const tool = tools.find((item: { name: string }) => item.name.startsWith("Canvas echo"));
  const updated = await page.request.patch(`/api/o/${slug}/execution/studio/tools/${tool.id}`, { data: { configuration: { kind: "reject-run", message: "Expected canvas smoke failure" } } });
  expect(updated.ok()).toBe(true);
  await page.getByRole("button", { name: "Exit Live", exact: true }).click();
  await page.goto(`/o/${slug}/org?workflowId=${workflowId}`);
  await expect(page.getByPlaceholder("Workflow name")).toHaveValue(workflowName);
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  const first = await start(page);
  await expect(tray.getByRole("status").filter({ hasText: /^failed$/ })).toBeVisible();
  await tray.getByRole("button", { name: "Error", exact: true }).click();
  await expect(tray.getByLabel("Run events").getByText("node.failed", { exact: true }).first()).toBeVisible();
  await tray.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("runId")).not.toBe(first);
  await expect(tray.getByRole("status").filter({ hasText: /^failed$/ })).toBeVisible();
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
