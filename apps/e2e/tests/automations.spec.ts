import path from 'path';
import { test, expect, type Page } from '@playwright/test';

test.use({ storageState: path.resolve(import.meta.dirname, '../.auth/user.json') });

/** Every automation this spec creates, so a failed run's leftovers are still findable. */
const PREFIX = 'E2E Automation';

/** A run that failed mid-flow leaves its row behind; a fresh name never collides with it. */
const uniqueName = (label: string) => `${PREFIX} ${label} ${Date.now().toString().slice(-6)}`;

/** The scratch flow, which every test here needs before it has anything to open. */
async function buildAutomation(page: Page, name: string) {
  await page.goto('/automations/new');
  await expect(page.getByRole('heading', { name: 'Create Automation', level: 1 })).toBeVisible();

  await page.getByLabel('Automation Name').fill(name);

  await page.getByRole('button', { name: 'Add trigger' }).click();
  await page.getByRole('option', { name: /play is pressed/ }).click();

  await page.getByRole('button', { name: 'Add action' }).click();
  await page.getByRole('option', { name: /Send Notification/ }).click();
  await page.getByRole('button', { name: 'Browser toasts' }).click();

  await page.getByRole('button', { name: 'Create Automation' }).click();

  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}$/);
}

/**
 * The row's switch is labelled "Turn <name> on or off", so a cell lookup by name finds
 * two cells. Only the row itself holds the name once.
 */
function rowFor(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name });
}

async function deleteAutomation(page: Page, name: string) {
  await page.goto('/automations');
  await rowFor(page, name).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(rowFor(page, name)).toHaveCount(0);
}

/**
 * Through the API, because a test that failed mid-flow is nowhere near the list. Sweeps
 * the whole prefix, so rows an earlier run abandoned go too.
 */
async function sweepAutomations(page: Page) {
  const listed = await page.request.get(
    `/api/v1/automations?search=${encodeURIComponent(PREFIX)}&pageSize=100`
  );
  // A cleanup that throws would bury whatever the test itself was failing on.
  if (!listed.ok()) return;

  const { data } = (await listed.json()) as { data: { id: string }[] };
  if (data.length === 0) return;

  await page.request.delete('/api/v1/automations/bulk', {
    data: { ids: data.map((automation) => automation.id) },
  });
}

test.describe('Automations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Automations', level: 1 })).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    await sweepAutomations(page);
  });

  test('builds an automation from scratch on the builder page', async ({ page }) => {
    const name = uniqueName('Scratch');

    await buildAutomation(page, name);

    await page.goto('/automations');
    await expect(rowFor(page, name)).toBeVisible();

    await deleteAutomation(page, name);
  });

  test('edits an automation from its detail page', async ({ page }) => {
    const name = uniqueName('Edit');
    const renamed = uniqueName('Edited');

    await buildAutomation(page, name);

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}\/edit$/);
    await expect(page.getByRole('heading', { name: 'Edit Automation', level: 1 })).toBeVisible();

    await page.getByLabel('Automation Name').fill(renamed);
    await page.getByRole('button', { name: 'Update Automation' }).click();

    await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();

    await page.goto('/automations');
    await expect(rowFor(page, renamed)).toBeVisible();

    await deleteAutomation(page, renamed);
  });

  test('filters the list by kind', async ({ page }) => {
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByLabel('Kind').click();
    await page.getByRole('option', { name: 'Policy' }).click();

    await expect(page).toHaveURL(/kind=policy/);
  });
});
