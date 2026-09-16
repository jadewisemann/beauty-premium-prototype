import { test, expect } from '@playwright/test';

test.describe('G0 runtime', () => {
  test.setTimeout(120_000);
  test('loads the perception worker and reaches ready', async ({ page }) => {
    await page.goto('/');

    await expectReady(page);
    await expect(page.getByRole('button', { name: '카메라', exact: true })).toBeEnabled();
    await expect(page.getByLabel('입력 선택').getByText('사진', { exact: true })).toBeVisible();
  });

  test('shows a recoverable camera-denied error', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException('Permission denied by test', 'NotAllowedError');
          },
        },
      });
    });
    await page.goto('/');
    await expectReady(page);

    await page.getByRole('button', { name: '카메라', exact: true }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('CAMERA_DENIED');
    await expect(alert).toContainText('Camera permission or device request failed');
    await expect(page.getByRole('button', { name: '카메라', exact: true })).toBeEnabled();
  });

  test('runs the bounded live camera path with a browser fixture stream', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext('2d')!;
          const paint = () => {
            context.fillStyle = '#ff0000';
            context.fillRect(0, 0, canvas.width, canvas.height / 2);
            context.fillStyle = '#0000ff';
            context.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);
            requestAnimationFrame(paint);
          };
          paint();
          return canvas.captureStream(30);
        },
      });
    });
    await page.goto('/');
    await expectReady(page);
    await page.getByRole('button', { name: '카메라', exact: true }).click();
    await expect(page.locator('.state-pill')).toHaveText(/라이브|오류/, { timeout: 30_000 });
    if (await page.locator('.state-pill').innerText() === '오류') throw new Error(await page.getByRole('alert').innerText());
    await page.getByRole('button', { name: '원본', exact: true }).click();
    const preview = page.getByLabel('뷰티 효과 미리보기');
    await expect.poll(async () => {
      const screenshot = await preview.screenshot();
      return page.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const copy = document.createElement('canvas');
        copy.width = image.width;
        copy.height = image.height;
        const context = copy.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const top = context.getImageData(image.width / 2, image.height / 4, 1, 1).data;
        const bottom = context.getImageData(image.width / 2, image.height * 3 / 4, 1, 1).data;
        return [Array.from(top), Array.from(bottom)];
      }, `data:image/png;base64,${screenshot.toString('base64')}`);
    }, { timeout: 10_000 }).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);
    await expect.poll(async () => Number(await page.getByLabel('진단 정보').locator('div').filter({ hasText: '프레임 완료' }).locator('dd').innerText()), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: '촬영' })).toBeEnabled();
    await page.getByRole('button', { name: '촬영' }).click();
    await expect(page.locator('.state-pill')).toHaveText(/^(사진|오류)$/, { timeout: 45_000 });
    if (await page.locator('.state-pill').innerText() === '오류') throw new Error(await page.getByRole('alert').innerText());
    await expect(page.getByRole('button', { name: '결과 저장' })).toBeVisible();
  });
});

async function expectReady(page: import('@playwright/test').Page) {
  const state = page.locator('.state-pill');
  await expect(state).toHaveText(/준비됨|오류/, { timeout: 45_000 });
  if (await state.innerText() === '오류') {
    throw new Error(`Initialization failed: ${await page.getByRole('alert').innerText()}`);
  }
}
