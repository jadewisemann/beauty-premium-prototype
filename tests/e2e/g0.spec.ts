import { expect, test } from '@playwright/test';

test('opens a mobile-first live beauty mirror', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('button', { name: '카메라 시작' })).toBeVisible();
  await page.getByRole('button', { name: '카메라 시작' }).click();
  await expect(page.locator('video')).toHaveClass(/visible/);
  await expect(page.getByText('색상 강도')).toBeVisible();
  await expect(page.locator('.stage')).toHaveCSS('position', 'sticky');
  await expect(page.locator('.stage canvas')).toHaveCount(1);
  await expect(page.locator('header > strong')).toHaveAttribute('data-makeup-ready', 'true', { timeout: 15_000 });
  await expect(page.locator('header > strong')).toHaveAttribute('data-hair-ready', 'true', { timeout: 15_000 });
  await expect(page.locator('header > strong')).toHaveText('LIVE');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('main')).toHaveCSS('width', '430px');
});

test('shows a recoverable camera error', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '카메라 시작' }).click();

  await expect(page.getByRole('alert')).toContainText('Permission denied');
  await expect(page.getByRole('button', { name: '다시 시작' })).toBeEnabled();
});
