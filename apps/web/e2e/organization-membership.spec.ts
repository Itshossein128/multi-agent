import { expect, test, type Page } from '@playwright/test';
const password = 'US2-Membership-E2E-Password!';
async function register(page: Page, email: string) {
  await page.goto('/register'); await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByLabel('Confirm Password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/onboarding\/organization/, { timeout: 30000 });
}
test('owner invites a zero-membership user; acceptance, role update and removal apply to live session', async ({ page, browser }) => {
  test.setTimeout(180000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await register(page, `owner-${suffix}@example.test`);
  await page.getByPlaceholder('Acme Studio').fill(`Members ${suffix}`);
  await page.getByRole('button', { name: /Create organization/i }).click();
  await expect(page).toHaveURL(/\/o\/[^/]+\/projects/, { timeout: 30000 });
  const slug = page.url().match(/\/o\/([^/]+)/)![1];
  const inviteeContext = await browser.newContext();
  try {
    const invitee = await inviteeContext.newPage(); const email = `invitee-${suffix}@example.test`;
    await register(invitee, email);
    await page.goto(`/o/${slug}/settings`); await page.getByLabel('Registered user email').fill(email);
    await page.getByLabel('Invitation role').selectOption('viewer'); await page.getByRole('button', { name: 'Invite member' }).click();
    await expect(page.getByRole('cell', { name: 'invited', exact: true })).toBeVisible();
    await invitee.goto('/invitations'); await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(invitee).toHaveURL(new RegExp(`/o/${slug}/projects`), { timeout: 30000 });
    expect((await invitee.request.post(`/api/o/${slug}/projects`, { data: { name: 'Viewer cannot write' } })).status()).toBe(403);
    await invitee.goto(`/o/${slug}/settings`);
    await expect(invitee.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
    await page.reload();
    const select = page.getByLabel(/^Role for /); await expect(select).toHaveCount(1);
    const userId = (await select.getAttribute('aria-label'))!.slice('Role for '.length);
    await select.selectOption('member');
    await expect(page.getByLabel(`Role for ${userId}`)).toHaveValue('member');
    expect((await invitee.request.post(`/api/o/${slug}/projects`, { data: { name: 'Member project' } })).status()).toBe(201);
    const memberRow = page.getByRole('row').filter({ hasText: userId });
    await memberRow.getByRole('button', { name: 'Suspend' }).click();
    await expect(memberRow.getByRole('cell', { name: 'suspended', exact: true })).toBeVisible();
    expect((await invitee.request.get(`/api/o/${slug}/projects`)).status()).toBe(404);
    await memberRow.getByRole('button', { name: 'Restore' }).click();
    await expect(memberRow.getByRole('cell', { name: 'active', exact: true })).toBeVisible();
    expect((await invitee.request.get(`/api/o/${slug}/projects`)).status()).toBe(200);
    await memberRow.getByRole('button', { name: 'Remove' }).click();
    await expect(memberRow.getByRole('cell', { name: 'removed', exact: true })).toBeVisible();
    const denied = await invitee.request.get(`/api/o/${slug}/projects`); expect(denied.status()).toBe(404); expect(await denied.json()).toEqual({ error: 'Not found' });
    const document = await invitee.goto(`/o/${slug}/settings`); expect(document?.status()).toBe(404);
  } finally { await inviteeContext.close(); }
});
