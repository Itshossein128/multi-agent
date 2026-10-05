import { expect, test } from "@playwright/test";

test("organization goals and budgets work through the authenticated browser proxy", async ({ page }) => {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(`organization-budget-${suffix}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("Organization-Budget-E2E-Password!");
  await page.getByLabel("Confirm Password").fill("Organization-Budget-E2E-Password!");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/org/agents");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page).toHaveURL(/\/org\/agents\/agent-/);
  const agentId = page.url().split("/").pop()!;

  await page.goto("/organization");
  await expect(page.getByRole("heading", { name: "Organization and goals" })).toBeVisible();
  await page.getByLabel(/role$/).selectOption("ceo");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel(/role$/)).toHaveValue("ceo");
  await page.getByLabel("Goal title").fill("Launch plan");
  await page.getByLabel("Goal description").fill("Prepare a concrete launch plan.");
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Launch plan" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Launch plan" })).toBeVisible();

  await page.goto("/budgets");
  await expect(page.getByRole("heading", { name: "Cost budgets" })).toBeVisible();
  await page.getByLabel("Monthly USD").fill("10");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("$0.00 spent · $0.00 reserved / $10.00")).toBeVisible();
  await page.reload();
  await expect(page.getByText("$0.00 spent · $0.00 reserved / $10.00")).toBeVisible();

  const result = await page.evaluate(async (agentId) => {
    const [organization, budgets] = await Promise.all([
      fetch("/api/execution/studio/organization"),
      fetch("/api/execution/studio/budgets"),
    ]);
    const org = await organization.json();
    const budget = await budgets.json();
    return { orgStatus: organization.status, budgetStatus: budgets.status, ceo: org.reportingLines?.some((line: { agentId: string; role: string }) => line.agentId === agentId && line.role === "ceo"), goal: org.goals?.some((goal: { title: string }) => goal.title === "Launch plan"), companyBudget: budget.budgets?.some((row: { scope: string; limitUsd: number }) => row.scope === "company" && row.limitUsd === 10) };
  }, agentId);
  expect(result).toEqual({ orgStatus: 200, budgetStatus: 200, ceo: true, goal: true, companyBudget: true });
});
