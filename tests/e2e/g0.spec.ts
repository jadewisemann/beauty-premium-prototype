import { test, expect } from '@playwright/test';

test.describe('G0 runtime', () => {
  test.setTimeout(120_000);
  test('loads the perception worker and reaches ready', async ({ page }) => {
    await page.goto('/?debug=1');

    const entry = page.getByRole('dialog', { name: '전면 카메라로 얼굴을 비춰도 될까요?' });
    await expect(entry).toBeVisible();
    await expectReady(page);
    await expect(entry.getByRole('button', { name: '동의하고 카메라 켜기' })).toBeEnabled();
    await expect(entry).toContainText('체험 엔진 준비 완료');
  });

  test('shows a recoverable camera-denied error', async ({ page }) => {
    await page.route('**/face_landmarker.task', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.continue();
    });
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
    await page.goto('/?debug=1');

    await page.getByRole('button', { name: '동의하고 카메라 켜기' }).click();
    await expect(page.getByText('체험 엔진을 준비하고 있어요')).toBeVisible();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('CAMERA_DENIED');
    await expect(alert).toContainText('Camera permission or device request failed');
    await expect(page.getByRole('dialog', { name: '카메라 권한이 필요해요' })).toBeVisible();
    await expect(page.getByRole('button', { name: '카메라 다시 요청' })).toBeEnabled();
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
    await page.goto('/?debug=1');
    await expectReady(page);
    await page.getByRole('button', { name: '동의하고 카메라 켜기' }).click();
    await expect(page.locator('.state-pill')).toHaveText(/라이브|오류/, { timeout: 30_000 });
    if (await page.locator('.state-pill').innerText() === '오류') throw new Error(await page.getByRole('alert').innerText());
    await expect(page.locator('.source-video')).toHaveCSS('opacity', '1');
    await expect(page.locator('.source-video')).toHaveClass(/source-video-mirrored/);
    await expect.poll(async () => Number(await page.getByLabel('진단 정보').locator('div').filter({ hasText: '프레임 완료' }).locator('dd').innerText()), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: '원본', exact: true }).click();
    const preview = page.getByLabel('뷰티 효과 미리보기');
    await expect(preview).toHaveCSS('opacity', '0');
    await expect(preview.evaluate(async (canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext('webgl2')!;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise(requestAnimationFrame);
        const top = new Uint8Array(4);
        const bottom = new Uint8Array(4);
        gl.readPixels(canvas.width / 2, canvas.height * 3 / 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, top);
        gl.readPixels(canvas.width / 2, canvas.height / 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bottom);
        if (top[0] || top[2] || bottom[0] || bottom[2]) return [Array.from(top), Array.from(bottom)];
      }
      return null;
    })).resolves.toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);
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
