import { expect, test, type Page } from "@playwright/test";
import { meanColorChannel, registerAndOpenOrganization } from "./appearance-helpers";

async function meanOf(page: Page, selector: string, property: "backgroundColor" | "color"): Promise<number> {
  const color = await page.locator(selector).first().evaluate((element, prop) => getComputedStyle(element)[prop], property);
  return meanColorChannel(color);
}

test("primary organization screens follow the selected appearance", async ({ page }) => {
  test.setTimeout(240_000);
  const slug = await registerAndOpenOrganization(page);
  await page.getByTestId("appearance-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");

  const paths = ["", "/tasks", "/projects", "/workspaces", "/runs", "/org/agents", "/settings", "/organization"];
  for (const path of paths) {
    await page.goto(`/o/${slug}${path}`);
    await expect(page.locator("header").first()).toBeVisible();
    expect(await meanOf(page, "header", "backgroundColor"), path).toBeGreaterThan(180);
    expect(await meanOf(page, "aside#app-sidebar", "backgroundColor"), path).toBeGreaterThan(180);
    expect(await meanOf(page, "main", "backgroundColor"), path).toBeGreaterThan(180);
    expect(await meanOf(page, "header", "color"), path).toBeLessThan(80);
    expect(await meanOf(page, "aside#app-sidebar", "color"), path).toBeLessThan(80);
    expect(await meanOf(page, "main", "color"), path).toBeLessThan(80);
  }

  await page.goto(`/o/${slug}/projects`);
  await page.getByRole("button", { name: "Launch Agent Task" }).click();
  const dialogMean = await page.getByRole("heading", { name: "Dispatch Agent Workflow Task" }).evaluate((heading) => {
    let node: HTMLElement | null = heading.parentElement;
    while (node) {
      const background = getComputedStyle(node).backgroundColor;
      if (background && background !== "rgba(0, 0, 0, 0)" && background !== "transparent") return background;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
  expect(meanColorChannel(dialogMean)).toBeGreaterThan(180);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByTestId("appearance-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  for (const selector of ["header", "aside#app-sidebar", "main"]) {
    expect(await meanOf(page, selector, "backgroundColor")).toBeLessThan(60);
    expect(await meanOf(page, selector, "color")).toBeGreaterThan(180);
  }
});
