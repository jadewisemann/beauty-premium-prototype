import { expect, test } from '@playwright/test';

test('opens a mobile-first live beauty mirror', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('button', { name: '카메라 시작' })).toBeVisible();
  await page.getByRole('button', { name: '카메라 시작' }).click();
  await expect(page.locator('.source-video')).toHaveClass(/visible/);
  await expect(page.getByRole('button', { name: '헤어' })).toBeVisible();
  await expect(page.getByRole('button', { name: '베이스' })).toBeVisible();
  await expect(page.locator('.stage-card')).toHaveCSS('position', 'sticky');
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
