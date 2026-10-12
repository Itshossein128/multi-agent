import { expect, test, type Page } from "@playwright/test";

const password = "Organization-Routing-E2E-Password!";
async function registerAndCreateOrg(page: Page, suffix: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(`org-routing-${suffix}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/onboarding\/organization/, { timeout: 30_000 });
  await page.getByPlaceholder("Acme Studio").fill(name);
  await page.getByRole("button", { name: /Create organization/i }).click();
  await expect(page).toHaveURL(/\/o\/[^/]+\/projects/, { timeout: 30_000 });
  return page.url().match(/\/o\/([^/]+)/)![1];
}

test("one account switches organizations, preserves URL scope, and clears old data", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const a = await registerAndCreateOrg(page, suffix, `Acme ${suffix}`);
  const second = await page.request.post("/api/organizations", { data: { name: `Beta ${suffix}` } });
  expect(second.status()).toBe(201);
  const b = (await second.json()).slug as string;
  expect(b).not.toBe(a);
  const projectA = `A-only-${suffix}`, projectB = `B-only-${suffix}`;
  const createdA = await page.request.post(`/api/o/${a}/projects`, { data: { name: projectA } });
  expect(createdA.status()).toBe(201);
  const aId = (await createdA.json()).id;
  const createdB = await page.request.post(`/api/o/${b}/projects`, { data: { name: projectB } });
  expect(createdB.status()).toBe(201);
  const bId = (await createdB.json()).id;
  const taskA = `Task-A-only-${suffix}`, taskB = `Task-B-only-${suffix}`;
  for (const [slug, projectId, title] of [[a, aId, taskA], [b, bId, taskB]]) {
    const task = await page.request.post(`/api/o/${slug}/tasks`, { data: { action: "create", projectId, title } });
    expect(task.status()).toBe(200);
  }

  // The session last-org pointer is A; a direct B URL must still use B's data.
  await page.goto(`/o/${b}/projects`);
  await expect(page.getByRole("link", { name: projectB, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: projectA, exact: true })).toHaveCount(0);
  await page.getByLabel("Switch organization").selectOption(a);
  await expect(page).toHaveURL(new RegExp(`/o/${a}/projects`));
  await expect(page.getByRole("link", { name: projectA, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: projectB, exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: projectA, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${a}/projects/${aId}`));
  await page.goto(`/o/${a}/tasks`);
  await expect(page.getByLabel("Switch organization")).toHaveValue(a);
  await expect(page.getByText(taskA, { exact: true })).toBeVisible();
  await expect(page.getByText(taskB, { exact: true })).toHaveCount(0);

  // A second tab cannot change which org the first tab's requests use.
  const tabB = await page.context().newPage();
  await tabB.goto(`/o/${b}/projects`);
  await page.goto(`/o/${a}/projects`);
  await expect(page.getByRole("link", { name: projectA, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: projectB, exact: true })).toHaveCount(0);
  await tabB.close();
  await page.getByLabel("Switch organization").selectOption(b);
  await expect(page.getByRole("link", { name: projectB, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: projectA, exact: true })).toHaveCount(0);
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/o/${b}(/projects)?/?$`));

  const foreignContext = await browser.newContext();
  try {
    const foreign = await foreignContext.newPage();
    await registerAndCreateOrg(foreign, `foreign-${suffix}`, `Foreign ${suffix}`);
    for (const slug of [a, "missing-organization-xyz"]) {
      for (const path of ["projects", "workspaces", "tasks", "dashboard", "execution/studio/agents", "execution/studio/budgets", "execution/runs"]) {
        const denied = await foreign.request.get(`/api/o/${slug}/${path}`);
        expect(denied.status(), `${slug}/${path}`).toBe(404);
        expect(await denied.json()).toEqual({ error: "Not found" });
      }
      const document = await foreign.goto(`/o/${slug}/projects`);
      expect(document?.status()).toBe(404);
      await expect(foreign.getByText(/not found|could not be found/i).first()).toBeVisible();
    }
    expect((await page.request.get(`/api/o/${b}/projects/${aId}`)).status()).toBe(404);
  } finally { await foreignContext.close(); }
});
