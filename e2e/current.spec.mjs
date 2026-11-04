import { test, expect } from '@playwright/test';

test('loads live Aave market data or shows an honest unavailable state', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /give your usdt room to grow/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'USDT supplied' })).toBeVisible();

  await expect.poll(async () => {
    const state = await page.locator('#apy-value').innerText();
    return state.includes('%') || state.includes('Rate unavailable');
  }, { timeout: 20000 }).toBe(true);

  const rateText = await page.locator('#apy-value').innerText();
  if (rateText.includes('Rate unavailable')) {
    await expect(page.locator('#market-error')).toBeVisible();
    await expect(page.locator('#market-error')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: /Review supply/ })).toBeDisabled();
    await expect(page.locator('#apy-value')).not.toContainText(/\d+\.\d+%/);
  } else {
    await expect(page.locator('#market-state')).toContainText(/Market live|Supply unavailable/);
    await expect(page.locator('#freshness')).toContainText(/fetched/);
    await expect(page.locator('#apy-value')).toContainText(/\d/);
  }
  await expect(pageErrors).toEqual([]);
});

test('wallet access fails honestly outside Nimiq Pay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Nimiq Pay wallet' }).click();
  await expect(page.getByRole('status').filter({ hasText: /inside Nimiq Pay/i })).toBeVisible();
  await expect(page.locator('#position-value')).toContainText('Connect your wallet');
  await expect(page.getByRole('button', { name: /Review supply/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Withdraw/ })).toBeDisabled();
});

test('controls, links, keyboard focus, mobile layout and reduced motion remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.getByRole('link', { name: /aave protocol risks/i })).toHaveAttribute('href', 'https://www.aave.com/docs/aave-v3/overview');
  await expect(page.getByRole('link', { name: /framework docs/i })).toHaveAttribute('href', 'https://nimiq.dev/mini-apps');
  const reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  expect(reducedMotion).toBe(true);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBe(375);
});
