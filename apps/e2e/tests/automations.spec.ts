import path from 'path';
import { test, expect, type Page } from '@playwright/test';

test.use({ storageState: path.resolve(import.meta.dirname, '../.auth/user.json') });

test.describe('Automation Creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Automations', level: 1 })).toBeVisible();
  });

  test('can create and delete an automation from a template', async ({ page }) => {
    const name = 'E2E Concurrent Stream Limit';

    await page.getByRole('button', { name: 'Add Automation' }).first().click();
    await page.getByRole('menuitem', { name: 'From a Template' }).click();

    await expect(page.getByText('Choose a Template')).toBeVisible();
    await page.getByText('Concurrent Streams').click();

    // A template pre-fills the builder, so it opens in its editing mode.
    await expect(page.getByText('Edit Automation')).toBeVisible();
    const nameInput = page.locator('#automation-name');
    await nameInput.clear();
    await nameInput.fill(name);

    await page.getByRole('button', { name: 'Update Automation' }).click();

    await expect(page.locator('#automation-name')).toBeHidden();
    await expect(page.getByRole('cell', { name })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Delete Automation')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Delete Automation')).toBeHidden();

    await expect(page.getByRole('cell', { name })).toBeHidden();
  });

  test('can create and delete a custom automation', async ({ page }) => {
    const name = 'E2E Test Custom Automation';

    await page.getByRole('button', { name: 'Add Automation' }).first().click();
    await page.getByRole('menuitem', { name: 'Custom Automation' }).click();

    await expect(page.getByText('Create Automation')).toBeVisible();

    await page.locator('#automation-name').fill(name);
    await page.locator('#automation-description').fill('Created by E2E test');

    await page.locator('#automation-severity').click();
    await page.getByRole('option', { name: 'High' }).click();

    // The default condition (concurrent_streams) is already set - leave it as-is
    await page.getByRole('button', { name: 'Create Automation' }).click();

    await expect(page.locator('#automation-name')).toBeHidden();
    await expect(page.getByRole('cell', { name })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Delete Automation')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Delete Automation')).toBeHidden();

    await expect(page.getByRole('cell', { name })).toBeHidden();
  });

  test('builds an automation from scratch on the builder page', async ({ page }) => {
    const name = 'E2E Scratch Automation';

    await page.goto('/automations/new');
    await expect(page.getByRole('heading', { name: 'Create Automation', level: 1 })).toBeVisible();

    await page.getByLabel('Automation Name').fill(name);

    await page.getByRole('button', { name: 'Add trigger' }).click();
    await page.getByRole('option', { name: /A stream starts/ }).click();

    await page.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('option', { name: /Send Notification/ }).click();
    await page.getByRole('button', { name: 'Browser toasts' }).click();

    await page.getByRole('button', { name: 'Create Automation' }).click();

    await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}$/);

    await page.goto('/automations');
    await expect(page.getByRole('cell', { name })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByRole('cell', { name })).toBeHidden();
  });

  test('filters the list by kind', async ({ page }) => {
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByLabel('Kind').click();
    await page.getByRole('option', { name: 'Policy' }).click();

    await expect(page).toHaveURL(/kind=policy/);
  });
});
