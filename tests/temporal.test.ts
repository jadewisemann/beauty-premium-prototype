import { describe, expect, it } from 'vitest';
import { alignLandmarks, TemporalStabilizer } from '../src/engine/temporal';

describe('temporal stabilization', () => {
  it('removes translation, rotation and scale before smoothing', () => {
    const reference = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    const current = [{ x: 5, y: 2 }, { x: 5, y: 4 }, { x: 3, y: 2 }];
    const result = alignLandmarks(current, reference);
    result.forEach((p, i) => { expect(p.x).toBeCloseTo(reference[i].x); expect(p.y).toBeCloseTo(reference[i].y); });
  });

  it('decays stale frames and resets on generation or frame discontinuity', () => {
    const s = new TemporalStabilizer({ tauMs: 100, fadeStartMs: 250, expireMs: 450 });
    const base = { generation: 1, frameId: 1, acquiredMs: 0, landmarks: [{ x: 0, y: 0 }] };
    expect(s.update(base).freshness).toBe(1);
    expect(s.update({ ...base, frameId: 2, acquiredMs: 300 }).freshness).toBeCloseTo(0.75);
    expect(s.update({ ...base, generation: 2, frameId: 1, acquiredMs: 301 }).reset).toBe(true);
    expect(s.update({ ...base, generation: 2, frameId: 1, acquiredMs: 302 }).reset).toBe(true);
  });
});
