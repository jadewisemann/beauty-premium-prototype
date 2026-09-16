import path from 'node:path';
import { expect, test } from '@playwright/test';

const fixture = path.resolve('tests/fixtures/face_model.png');

test('analyzes a real photo, edits, compares, and exports', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('.state-pill')).toHaveText(/준비됨|오류/, { timeout: 45_000 });
  if (await page.locator('.state-pill').innerText() === '오류') throw new Error(await page.getByRole('alert').innerText());

  await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles(fixture);
  await expect(page.locator('.state-pill')).toHaveText(/^(사진|오류)$/, { timeout: 45_000 });
  if (await page.locator('.state-pill').innerText() === '오류') throw new Error(await page.getByRole('alert').innerText());

  const diagnostics = page.getByLabel('진단 정보');
  await expect(diagnostics.locator('div').filter({ hasText: '얼굴 점' }).locator('dd')).toHaveText(/\d+/, { timeout: 30_000 });
  await expect(diagnostics.locator('div').filter({ hasText: '헤어 마스크' }).locator('dd')).toHaveText(/\d+×\d+/, { timeout: 30_000 });
  await expect(page.getByLabel('뷰티 효과 미리보기')).toBeVisible();

  const completedMetric = diagnostics.locator('div').filter({ hasText: '프레임 완료' }).locator('dd');
  const completedBeforeEdits = await completedMetric.innerText();
  await page.getByRole('button', { name: /Copper Glow/ }).click();
  await page.getByRole('button', { name: /Rose Brown/ }).click();
  await page.getByRole('button', { name: /Copper Glow/ }).click();
  await page.waitForTimeout(600);
  await expect(completedMetric).toHaveText(completedBeforeEdits);
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeEnabled();
  await page.getByRole('button', { name: '2분할' }).click();
  await expect(page.getByText('원본', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '4분할' }).click();
  await expect(page.locator('.grid-look')).toHaveCount(4);
  await page.getByRole('button', { name: '4분할' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '결과 저장' }).click();
  await expect((await download).suggestedFilename()).toMatch(/\.jpg$/);
  await expect.poll(() => page.getByLabel('뷰티 효과 미리보기').evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([640, 640]);
  await page.getByRole('button', { name: 'PNG' }).click();
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '결과 저장' }).click();
  await expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/);

  const canLoseContext = await page.evaluate(() => Boolean(
    (document.querySelector('.beauty-canvas') as HTMLCanvasElement | null)
      ?.getContext('webgl2')
      ?.getExtension('WEBGL_lose_context'),
  ));
  expect(canLoseContext).toBe(true);
  await page.evaluate(() => {
    const gl = (document.querySelector('.beauty-canvas') as HTMLCanvasElement).getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_lose_context')!;
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 300);
  });
  await expect(page.locator('.state-pill')).toHaveText('오류', { timeout: 5_000 });
  await expect(page.locator('.state-pill')).toHaveText('사진', { timeout: 45_000 });
});
