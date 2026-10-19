import { expect, test } from "@playwright/test";
import { meanStyle, registerAndOpenOrganization } from "./appearance-helpers";

test("header toggle switches appearance without navigation or losing input", async ({ page }) => {
  test.setTimeout(120_000);
  const slug = await registerAndOpenOrganization(page);
  await page.evaluate(() => localStorage.removeItem("agent-studio.appearance.v1"));
  await page.goto(`/o/${slug}/projects`);

  const toggle = page.locator("header").getByTestId("appearance-toggle");
  await expect(toggle).toBeVisible();
  const initial = await page.locator("html").getAttribute("data-appearance");
  expect(initial === null || initial === "dark").toBe(true);
  expect(await meanStyle(page, "body", "backgroundColor")).toBeLessThan(50);

  const url = page.url();
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  expect(page.url()).toBe(url);
  expect(await meanStyle(page, "body", "backgroundColor")).toBeGreaterThan(200);

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  expect(await meanStyle(page, "body", "backgroundColor")).toBeLessThan(50);

  await page.getByRole("button", { name: "Launch Agent Task" }).click();
  const field = page.getByPlaceholder(/Describe your requirement/);
  await field.fill("unique sentence for theme switch");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("unique sentence for theme switch");
  await expect(page.getByRole("heading", { name: "Dispatch Agent Workflow Task" })).toBeVisible();
  expect(page.url()).toBe(url);
});
