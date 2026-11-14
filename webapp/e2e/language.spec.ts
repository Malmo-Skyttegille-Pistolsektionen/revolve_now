import { test, expect } from '@playwright/test';
import { openApp, openSettings } from './device';

/**
 * The language setting (D-45) is a browser-side choice: nothing on the
 * device changes, so what this checks is that the choice reaches the page
 * and survives a reload, which is the whole of what a club member sees.
 */
test('switching to Svenska translates the page and sticks across a reload', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'appearance');

  // The radio inputs are visually hidden behind their labels, so the label is
  // what gets clicked - the same way a finger does it.
  const language = page.getByRole('radiogroup', { name: 'Language' });
  await language.getByText('Svenska').click();
  await expect(page.getByRole('link', { name: 'Inställningar' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');

  await page.reload();
  await expect(page.getByRole('link', { name: 'Inställningar' })).toBeVisible();

  await page.getByRole('radiogroup', { name: 'Språk' }).getByText('English').click();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
