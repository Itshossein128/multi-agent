import { expect, test } from "@playwright/test";

/**
 * US1: org URL routing, switch, and cache isolation.
 * Requires web + server + Postgres (same as other e2e specs).
 */
test.describe("organization URL routing", () => {
  test("org switch, deep link, non-member 404, and stale cache not reused", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const password = "Organization-Routing-E2E-Password!";

    async function registerAndCreateOrg(
      target: typeof page,
      email: string,
      orgName: string,
    ): Promise<string> {
      await target.goto("/register");
      await target.getByLabel("Email").fill(email);
      await target.getByLabel("Password", { exact: true }).fill(password);
      await target.getByLabel("Confirm Password").fill(password);
      await target.getByRole("button", { name: "Sign up" }).click();
      // Registration signs in and `/` redirects to org creation when the user has no memberships.
      await expect(target).toHaveURL(/\/onboarding\/organization/, { timeout: 30_000 });
      await target.getByPlaceholder("Acme Studio").fill(orgName);
      await target.getByRole("button", { name: /Create organization/i }).click();
      await expect(target).toHaveURL(new RegExp(`/o/[^/]+(/projects)?`), { timeout: 30_000 });
      const slug = target.url().match(/\/o\/([^/]+)/)?.[1];
      expect(slug).toBeTruthy();
      return slug!;
    }

    // User A: register → create org A
    const orgASlug = await registerAndCreateOrg(
      page,
      `org-routing-a-${suffix}@example.test`,
      `Acme ${suffix}`,
    );

    await page.goto(`/o/${orgASlug}/projects`);
    await expect(page).toHaveURL(new RegExp(`/o/${orgASlug}/projects`));

    // Deep link same-org stays under slug
    await page.goto(`/o/${orgASlug}/tasks`);
    await expect(page).toHaveURL(new RegExp(`/o/${orgASlug}/tasks`));

    // Non-member slug → not found (no existence disclosure)
    await page.goto("/o/definitely-not-a-member-org-xyz/projects");
    await expect(page.getByText(/not found|could not be found/i)).toBeVisible();

    // Fresh context for user B (avoids NextAuth cookie/session races after clearCookies).
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
      const orgBSlug = await registerAndCreateOrg(
        pageB,
        `org-routing-b-${suffix}@example.test`,
        `Beta ${suffix}`,
      );
      expect(orgBSlug).not.toBe(orgASlug);

      // Stale: visiting other user's org slug must 404
      await pageB.goto(`/o/${orgASlug}/projects`);
      await expect(pageB.getByText(/not found|could not be found/i)).toBeVisible();

      // Land on B projects without A data
      await pageB.goto(`/o/${orgBSlug}/projects`);
      await expect(pageB).toHaveURL(new RegExp(`/o/${orgBSlug}/projects`));
      await expect(pageB.getByText(/not found|could not be found/i)).toHaveCount(0);
    } finally {
      await contextB.close();
    }
  });
});
