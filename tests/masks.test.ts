import { describe, expect, it } from 'vitest';
import { blushEllipses, closedLoops, drawLipMask } from '../src/engine/masks';

describe('mask geometry', () => {
  it('builds closed loops from unordered edges', () => {
    expect(closedLoops([{ start: 2, end: 3 }, { start: 0, end: 1 }, { start: 3, end: 0 }, { start: 1, end: 2 }])).toHaveLength(1);
    expect(new Set(closedLoops([{ start: 2, end: 3 }, { start: 0, end: 1 }, { start: 3, end: 0 }, { start: 1, end: 2 }])[0])).toEqual(new Set([0, 1, 2, 3]));
  });

  it('draws separate lip contours with even-odd fill', () => {
    const calls: string[] = [];
    const ctx = { beginPath: () => calls.push('begin'), moveTo: () => calls.push('move'), lineTo: () => calls.push('line'), closePath: () => calls.push('close'), fill: (rule?: 'evenodd' | 'nonzero') => calls.push(rule ?? 'fill') };
    const landmarks = Array.from({ length: 8 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }));
    drawLipMask(ctx, landmarks, [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }, { start: 4, end: 5 }, { start: 5, end: 6 }, { start: 6, end: 7 }, { start: 7, end: 4 }]);
    expect(calls.at(-1)).toBe('evenodd');
  });

  it('returns deterministic blush fallbacks', () => {
    const result = blushEllipses(new Float32Array(3), 0.58);
    expect(result[0].center).toEqual({ x: 0.35, y: 0.55 });
    expect(result[1].center).toEqual({ x: 0.65, y: 0.55 });
    expect(Number.isFinite(result[0].radiusX)).toBe(true);
  });

  it('moves lifted blush up and out from the apple placement', () => {
    const landmarks = new Float32Array(478 * 3);
    landmarks[50 * 3] = 0.35; landmarks[50 * 3 + 1] = 0.55;
    landmarks[280 * 3] = 0.65; landmarks[280 * 3 + 1] = 0.55;
    landmarks[1 * 3] = 0.5; landmarks[1 * 3 + 1] = 0.48;
    const apple = blushEllipses(landmarks, 0.58, 'apple');
    const lifted = blushEllipses(landmarks, 0.58, 'lifted');
    expect(lifted[0].center.y).toBeLessThan(apple[0].center.y);
    expect(lifted[0].center.x).toBeLessThan(apple[0].center.x);
    expect(lifted[1].center.x).toBeGreaterThan(apple[1].center.x);
  });
});
