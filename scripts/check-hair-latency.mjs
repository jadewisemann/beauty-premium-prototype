import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Run against the local dev server; supply a consenting portrait fixture path.
const source = `data:image/png;base64,${readFileSync(process.argv[2]).toString('base64')}`;
const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  console.log(await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'GPU unavailable';
  }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('INFO:')) errors.push(m.text()); });
  await page.addInitScript(source => {
    window.hairTimes = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        let sent = 0;
        const post = this.postMessage.bind(this);
        this.postMessage = (...args) => { sent = performance.now(); return post(...args); };
        this.addEventListener('message', e => {
          if (e.data.type === 'mask') window.hairTimes.push(performance.now() - sent);
          if (e.data.bitmap && window.captureMask) {
            window.captureMask = false;
            createImageBitmap(e.data.bitmap).then(bitmap => {
              const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
              const ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
              const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
              let coverage = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 128) coverage++;
              window.maskCoverage = coverage / (c.width * c.height);
              window.maskImage = c.toDataURL();
            });
          }
        });
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const img = new Image(); img.src = source; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 640;
      const ctx = canvas.getContext('2d');
      function draw(t) {
        ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 640, 640);
        ctx.drawImage(img, window.freezeHair ? 0 : Math.sin(t / 500) * 65, 0, 640, 640);
        requestAnimationFrame(draw);
      }
      requestAnimationFrame(draw);
      return canvas.captureStream(30);
    };
  }, source);
  await page.goto(process.env.HAIR_CHECK_URL || 'http://127.0.0.1:4173');
  await page.getByRole('button', { name: '카메라 시작' }).click();
  await page.locator('[data-hair-ready="true"]').waitFor({ timeout: 30000 }).catch(async e => {
    console.error(errors, await page.locator('body').innerText()); throw e;
  });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '#6f4b67' }).click();
  await page.evaluate(() => { window.hairTimes = []; });
  await page.waitForTimeout(6000);
  const samples = await page.evaluate(() => window.hairTimes);
  assert(samples.length > 0, 'No hair results');
  assert.deepEqual(errors, [], 'Browser errors');
  const sorted = samples.toSorted((a,b) => a-b);
  console.log(JSON.stringify({ frames: samples.length, resultsPerSecond: samples.length / 6, workerRoundTripMedianMs: sorted[Math.floor(sorted.length * .5)], workerRoundTripP95Ms: sorted[Math.floor(sorted.length * .95)] }));
  await page.evaluate(() => { window.captureMask = true; });
  await page.waitForTimeout(1000);
  const coverage = await page.evaluate(() => window.maskCoverage);
  if (coverage !== undefined) { console.log({ maskCoverage: coverage }); assert(coverage > .01 && coverage < .9, 'Hair mask must be nonempty and selective'); }
  await page.evaluate(() => { window.freezeHair = true; });
  await page.waitForTimeout(700);
  const capture = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const source = document.querySelector('.makeup-canvas');
    const c = document.createElement('canvas'); c.width = source.width; c.height = source.height;
    const ctx = c.getContext('2d'); ctx.drawImage(source, 0, 0);
    resolve(Array.from(ctx.getImageData(0, 0, c.width, c.height).data));
  })));
  await page.locator('input[type="range"]').fill('0');
  await page.waitForTimeout(300);
  const off = await capture();
  await page.locator('input[type="range"]').fill('1');
  await page.waitForTimeout(300);
  const on = await capture();
  const changed = on.filter((v,i) => Math.abs(v - off[i]) > 5).length / on.length;
  console.log({ changedPixelChannels: changed });
  if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
  if (process.argv[3]) {
    await page.evaluate(() => { const img = document.createElement('img'); img.src = window.maskImage; img.style.cssText = 'position:fixed;inset:0;width:390px;height:390px;z-index:9999'; document.body.append(img); });
    await page.screenshot({ path: process.argv[3].replace('.png', '-mask.png') });
  }
  assert(changed > .005, 'Changing hair strength must change rendered pixels');
} finally { await browser.close(); }
