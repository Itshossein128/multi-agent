import { expect, test } from "@playwright/test";
import { registerAndOpenOrganization } from "./appearance-helpers";

test("appearance control is named, keyboard operable, and visible when narrow", async ({ page }) => {
  test.setTimeout(120_000);
  const slug = await registerAndOpenOrganization(page);
  await page.goto(`/o/${slug}/projects`);

  const darkToggle = page.getByRole("button", { name: "Dark appearance, switch to light" });
  await expect(darkToggle).toBeVisible();
  await expect(darkToggle).toHaveText(/Dark/);
  await expect(darkToggle).toHaveAttribute("aria-pressed", "false");
  await expect(darkToggle.locator("svg")).toHaveAttribute("aria-hidden", "true");

  await darkToggle.focus();
  await page.keyboard.press("Enter");
  const lightToggle = page.getByRole("button", { name: "Light appearance, switch to dark" });
  await expect(lightToggle).toBeVisible();
  await expect(lightToggle).toHaveText(/Light/);
  await expect(lightToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");

  await lightToggle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(page.getByRole("button", { name: "Dark appearance, switch to light" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = page.getByRole("button", { name: "Dark appearance, switch to light" });
  await expect(narrow).toBeVisible();
  await expect(narrow).toHaveText(/Dark/);
  await narrow.click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await expect(page.getByRole("button", { name: "Light appearance, switch to dark" })).toBeVisible();
});
