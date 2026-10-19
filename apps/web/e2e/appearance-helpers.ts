import { expect, type Page } from "@playwright/test";

async function openRegister(page: Page) {
  await page.goto("/register");
  // Wait until the client handler is live. A click before that submits the form as a navigation.
  const reveal = page.getByRole("button", { name: "Show password" });
  await expect(reveal).toBeVisible();
  await reveal.click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
}

export async function registerAndOpenOrganization(page: Page): Promise<string> {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "Appearance-E2E-Password!";
  await openRegister(page);
  await page.getByLabel("Email").fill(`appearance-${suffix}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/onboarding\/organization/, { timeout: 30_000 });
  await page.getByPlaceholder("Acme Studio").fill(`Appearance ${suffix}`);
  await page.getByRole("button", { name: /Create organization/i }).click();
  await expect(page).toHaveURL(/\/o\/[^/]+\/projects/, { timeout: 30_000 });
  const slug = page.url().match(/\/o\/([^/]+)/)?.[1];
  if (!slug) throw new Error(`Organization slug missing from ${page.url()}`);
  return slug;
}

export async function registerOnly(page: Page): Promise<void> {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "Appearance-E2E-Password!";
  await openRegister(page);
  await page.getByLabel("Email").fill(`appearance-onboard-${suffix}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/onboarding\/organization/, { timeout: 30_000 });
}

/** Mean RGB channel of a computed color. Chrome may return rgb, oklch, oklab, or lab. */
export function meanColorChannel(color: string): number {
  const rgb = color.match(/rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/);
  if (rgb) return (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 3;
  const oklch = color.match(/oklch\(\s*([\d.]+)%/);
  if (oklch) return (Number(oklch[1]) / 100) * 255;
  const oklab = color.match(/oklab\(\s*([\d.]+)/);
  if (oklab) return Number(oklab[1]) * 255;
  const lab = color.match(/\blab\(\s*([\d.]+)/);
  if (lab) return (Number(lab[1]) / 100) * 255;
  throw new Error(`Could not parse color: ${color}`);
}

export async function meanStyle(page: Page, selector: string, property: "backgroundColor" | "color"): Promise<number> {
  const color = await page.locator(selector).first().evaluate((element, prop) => {
    return getComputedStyle(element)[prop];
  }, property);
  return meanColorChannel(color);
}
