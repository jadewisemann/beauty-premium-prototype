import { describe, expect, it } from 'vitest';
import {
  applyMat3,
  createCurrentToReferenceTransform,
  createSourceToDisplayTransform,
  invertMat3,
  multiplyMat3,
  rotateSourceUv,
} from '../src/engine/transforms';

const expectPoint = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
};

describe('source coordinate transforms', () => {
  it('normalises a rotated input before upright source coordinates are used', () => {
    expectPoint(applyMat3(rotateSourceUv(90), { x: 0.2, y: 0.7 }), { x: 0.3, y: 0.2 });
    expectPoint(applyMat3(rotateSourceUv(180), { x: 0.2, y: 0.7 }), { x: 0.8, y: 0.3 });
  });

  it('contains an asymmetric source inside an offset viewport', () => {
    const transform = createSourceToDisplayTransform({
      sourceWidth: 400,
      sourceHeight: 200,
      viewport: { x: 10, y: 20, width: 300, height: 300 },
      fit: 'contain',
    });
    expectPoint(applyMat3(transform, { x: 0.2, y: 0.7 }), { x: 70, y: 200 });
  });

  it('covers by cropping and mirrors only display orientation', () => {
    const transform = createSourceToDisplayTransform({
      sourceWidth: 400,
      sourceHeight: 200,
      viewport: { x: 10, y: 20, width: 300, height: 300 },
      fit: 'cover',
      mirror: true,
    });
    expectPoint(applyMat3(transform, { x: 0.2, y: 0.7 }), { x: 340, y: 230 });
    expectPoint(applyMat3(transform, { x: 0.8, y: 0.7 }), { x: -20, y: 230 });
  });

  it('maps an asymmetric point into the selected four-up viewport', () => {
    const transform = createSourceToDisplayTransform({
      sourceWidth: 100,
      sourceHeight: 200,
      viewport: { x: 320, y: 0, width: 320, height: 180 },
      fit: 'cover',
    });
    expectPoint(applyMat3(transform, { x: 0.2, y: 0.7 }), { x: 384, y: 218 });
  });

  it('round-trips a transformed asymmetric point', () => {
    const transform = createSourceToDisplayTransform({
      sourceWidth: 403,
      sourceHeight: 211,
      viewport: { x: 17, y: 29, width: 311, height: 197 },
      fit: 'cover',
      mirror: true,
    });
    const source = { x: 0.173, y: 0.814 };
    expectPoint(applyMat3(invertMat3(transform), applyMat3(transform, source)), source);
    expectPoint(applyMat3(multiplyMat3(invertMat3(transform), transform), source), source);
  });

  it('reprojects the current face position into a reference frame', () => {
    const referenceToFace = [2, 0, -1, 0, 2, -1, 0, 0, 1] as const;
    const currentToFace = [2, 0, -1.4, 0, 2, -1, 0, 0, 1] as const;
    const currentFaceCenter = { x: 0.7, y: 0.5 };
    expectPoint(applyMat3(createCurrentToReferenceTransform(currentToFace, referenceToFace), currentFaceCenter), { x: 0.5, y: 0.5 });
  });
});
