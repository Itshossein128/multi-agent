import { expect, test } from "@playwright/test";
import { meanColorChannel, registerAndOpenOrganization, registerOnly } from "./appearance-helpers";

async function lockedBackgroundMean(page: import("@playwright/test").Page): Promise<number> {
  const color = await page.locator(".appearance-locked").first().evaluate((element) => getComputedStyle(element).backgroundColor);
  return meanColorChannel(color);
}

test("appearance is remembered, shared across views, and ignored on locked pages", async ({ page, browser }) => {
  test.setTimeout(180_000);

  const loggedOut = await browser.newContext();
  const signedOut = await loggedOut.newPage();
  await signedOut.addInitScript(() => {
    localStorage.setItem("agent-studio.appearance.v1", "light");
  });
  for (const path of ["/login", "/register"]) {
    await signedOut.goto(path);
    await expect(signedOut.getByTestId("appearance-toggle")).toHaveCount(0);
    await expect(signedOut.locator(".appearance-locked").first()).toBeVisible();
    expect(await lockedBackgroundMean(signedOut)).toBeLessThan(50);
  }
  await loggedOut.close();

  await registerOnly(page);
  await page.evaluate(() => localStorage.setItem("agent-studio.appearance.v1", "light"));
  await page.goto("/onboarding/organization");
  await expect(page.getByTestId("appearance-toggle")).toHaveCount(0);
  await expect(page.locator(".appearance-locked").first()).toBeVisible();
  expect(await lockedBackgroundMean(page)).toBeLessThan(50);

  const shellContext = await browser.newContext();
  const shell = await shellContext.newPage();
  const slug = await registerAndOpenOrganization(shell);
  await shell.evaluate(() => localStorage.removeItem("agent-studio.appearance.v1"));
  await shell.goto(`/o/${slug}/projects`);
  await expect(shell.locator("html")).toHaveAttribute("data-appearance", "dark");

  await shell.getByTestId("appearance-toggle").click();
  await expect(shell.locator("html")).toHaveAttribute("data-appearance", "light");
  await shell.reload();
  await expect(shell.locator("html")).toHaveAttribute("data-appearance", "light");

  const second = await shell.context().newPage();
  await second.goto(`/o/${slug}/projects`);
  await expect(second.locator("html")).toHaveAttribute("data-appearance", "light");
  await second.getByTestId("appearance-toggle").click();
  await expect(second.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(shell.locator("html")).toHaveAttribute("data-appearance", "dark");
  await second.close();

  await shell.evaluate(() => localStorage.setItem("agent-studio.appearance.v1", "blue"));
  await shell.reload();
  await expect(shell.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(shell.getByTestId("appearance-toggle")).toBeVisible();
  await shell.getByTestId("appearance-toggle").click();
  await expect(shell.locator("html")).toHaveAttribute("data-appearance", "light");

  await shell.goto("/invitations");
  await expect(shell.getByTestId("appearance-toggle")).toHaveCount(0);
  await expect(shell.locator(".appearance-locked").first()).toBeVisible();
  expect(await lockedBackgroundMean(shell)).toBeLessThan(50);
  await shellContext.close();
});
