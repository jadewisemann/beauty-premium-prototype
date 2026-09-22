import { chromium, webkit } from '@playwright/test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Run against the local dev server; supply a consenting portrait fixture path.
const source = `data:image/png;base64,${readFileSync(process.argv[2]).toString('base64')}`;
const safari = process.env.HAIR_CHECK_BROWSER === 'webkit';
const browser = await (safari ? webkit : chromium).launch({ headless: true, ...(safari ? {} : { args: ['--use-angle=metal'] }) });
try {
  const mobile = process.env.HAIR_CHECK_MOBILE === '1';
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: mobile ? 3 : 1, hasTouch: mobile, isMobile: mobile });
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
    const drawArrays = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      drawArrays.apply(this, args);
      if (this.canvas.matches?.('.makeup-canvas') && window.captureNextHairFrame) {
        queueMicrotask(() => window.captureNextHairFrame?.());
      }
    };
    if (location.search.includes('fallback')) {
      delete HTMLVideoElement.prototype.requestVideoFrameCallback;
      delete HTMLVideoElement.prototype.cancelVideoFrameCallback;
    }
    window.hairTimes = [];
    window.faceTimes = [];
    window.frameTimes = [];
    let previousFrame = performance.now();
    function measureFrame(now) {
      window.frameTimes.push(now - previousFrame); previousFrame = now;
      requestAnimationFrame(measureFrame);
    }
    requestAnimationFrame(measureFrame);
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        let sent = 0;
        const post = this.postMessage.bind(this);
        this.postMessage = (...args) => { sent = performance.now(); return post(...args); };
        this.addEventListener('message', e => {
          if (e.data.type === 'HAIR_RESULT') window.hairTimes.push(performance.now() - sent);
          if (e.data.type === 'FACE_RESULT') window.faceTimes.push(performance.now() - sent);
          if (e.data.type === 'HAIR_RESULT' && window.captureMask) {
            window.captureMask = false;
            const values = e.data.result.values;
            let coverage = 0; for (const value of values) if (value > 128) coverage++;
            window.maskCoverage = coverage / values.length;
          }
        });
      }
    };
    const img = new Image(); img.src = source;
    const fixtureReady = img.decode().then(() => { window.fixtureReady = true; });
    navigator.mediaDevices.getUserMedia = async () => {
      await fixtureReady;
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
  await page.waitForFunction(() => window.fixtureReady);
  await page.getByRole('button', { name: '카메라 시작' }).click();
  await page.locator('[data-hair-ready="true"]').waitFor({ timeout: 30000 }).catch(async e => {
    console.error(errors, await page.locator('body').innerText()); throw e;
  });
  if (mobile) {
    const canvasRatio = await page.locator('.makeup-canvas').evaluate(canvas => {
      const rect = canvas.getBoundingClientRect();
      const coverWidth = Math.max(rect.width, rect.height * canvas.width / canvas.height);
      return canvas.width / coverWidth;
    });
    console.log({ canvasPixelRatio: canvasRatio });
    assert(canvasRatio <= 1.51, 'Mobile render pixel ratio must be capped');
  }
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '#6f4b67' }).click();
  await page.evaluate(() => { window.hairTimes = []; window.faceTimes = []; window.frameTimes = []; });
  await page.waitForTimeout(6000);
  const samples = await page.evaluate(() => window.hairTimes);
  const faceSamples = await page.evaluate(() => window.faceTimes);
  assert(samples.length > 0, 'No hair results');
  assert(faceSamples.length > 0, 'No face results');
  assert.deepEqual(errors, [], 'Browser errors');
  const sorted = samples.toSorted((a,b) => a-b);
  console.log(JSON.stringify({ frames: samples.length, resultsPerSecond: samples.length / 6, workerRoundTripMedianMs: sorted[Math.floor(sorted.length * .5)], workerRoundTripP95Ms: sorted[Math.floor(sorted.length * .95)] }));
  console.log({ faceResultsPerSecond: faceSamples.length / 6 });
  const frameTimes = await page.evaluate(() => window.frameTimes);
  const sortedFrameTimes = frameTimes.toSorted((a,b) => a-b);
  console.log({ animationFrameP95Ms: sortedFrameTimes[Math.floor(sortedFrameTimes.length * .95)] });
  await page.evaluate(() => { window.captureMask = true; });
  await page.waitForTimeout(1000);
  const coverage = await page.evaluate(() => window.maskCoverage);
  if (coverage !== undefined) { console.log({ maskCoverage: coverage }); assert(coverage > .01 && coverage < .9, 'Hair mask must be nonempty and selective'); }
  await page.evaluate(() => { window.freezeHair = true; });
  await page.waitForTimeout(700);
  const capture = () => page.evaluate(() => new Promise((resolve, reject) => {
    const source = document.querySelector('.makeup-canvas');
    const c = document.createElement('canvas'); c.width = source.width; c.height = source.height;
    const ctx = c.getContext('2d');
    const timeout = setTimeout(() => { window.captureNextHairFrame = null; reject(new Error('No rendered frame')); }, 3000);
    window.captureNextHairFrame = () => {
      window.captureNextHairFrame = null;
      clearTimeout(timeout);
      ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      resolve(Array.from(pixels));
    };
  }));
  await page.locator('input[type="range"]').fill('0');
  await page.waitForTimeout(300);
  const off = await capture();
  if (process.argv[3]) await page.screenshot({ path: process.argv[3].replace('.png', '-off.png') });
  await page.locator('input[type="range"]').fill('1');
  await page.waitForTimeout(300);
  const on = await capture();
  assert(off.some((v, i) => i % 4 === 3 && v > 0) && on.some((v, i) => i % 4 === 3 && v > 0), 'Both captures must contain a rendered frame');
  const changed = on.filter((v,i) => Math.abs(v - off[i]) > 5).length / on.length;
  console.log({ changedPixelChannels: changed });
  if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
  assert(changed > .005, 'Changing hair strength must change rendered pixels');
  await page.getByRole('button', { name: '베이스' }).click();
  const foundationOff = await capture();
  await page.locator('.toggle input').check();
  await page.waitForTimeout(300);
  const foundationOn = await capture();
  const foundationChanged = foundationOn.filter((v, i) => Math.abs(v - foundationOff[i]) > 5).length / foundationOn.length;
  console.log({ foundationChangedPixelChannels: foundationChanged });
  if (process.argv[3]) await page.screenshot({ path: process.argv[3].replace('.png', '-foundation.png') });
  assert(foundationChanged > .001, 'Enabling foundation must change rendered pixels');
} finally { await browser.close(); }
