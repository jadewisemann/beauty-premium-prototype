export type Landmark = { x: number; y: number };

export interface TemporalFrame {
  generation: number;
  frameId: number;
  acquiredMs: number;
  landmarks: readonly Landmark[];
}

export interface TemporalOptions {
  tauMs?: number;
  fadeStartMs?: number;
  expireMs?: number;
}

export interface TemporalResult {
  landmarks: Landmark[];
  /** Weight to apply to the temporal result; it reaches zero at expiry. */
  freshness: number;
  reset: boolean;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** Render-time freshness: full strength until fadeStart, then never survives expiry. */
export function freshnessAtAge(ageMs: number, fadeStartMs: number, expireMs: number): number {
  if (ageMs <= fadeStartMs) return 1;
  if (ageMs >= expireMs) return 0;
  return clamp((expireMs - ageMs) / Math.max(1e-6, expireMs - fadeStartMs));
}

/** Fits a 2D similarity transform and maps `current` into `reference` space. */
export function alignLandmarks(current: readonly Landmark[], reference: readonly Landmark[]): Landmark[] {
  if (current.length !== reference.length || current.length === 0) return current.map(({ x, y }) => ({ x, y }));
  let cx = 0, cy = 0, rx = 0, ry = 0;
  for (let i = 0; i < current.length; i++) { cx += current[i].x; cy += current[i].y; rx += reference[i].x; ry += reference[i].y; }
  cx /= current.length; cy /= current.length; rx /= current.length; ry /= current.length;
  let a = 0, b = 0, norm = 0;
  for (let i = 0; i < current.length; i++) {
    const x = current[i].x - cx, y = current[i].y - cy;
    const u = reference[i].x - rx, v = reference[i].y - ry;
    a += x * u + y * v; b += x * v - y * u; norm += x * x + y * y;
  }
  if (norm < 1e-12) return current.map(() => ({ x: rx, y: ry }));
  const scaleA = a / norm, scaleB = b / norm;
  return current.map(({ x, y }) => ({ x: rx + scaleA * (x - cx) - scaleB * (y - cy), y: ry + scaleB * (x - cx) + scaleA * (y - cy) }));
}

export class TemporalStabilizer {
  private previous: TemporalFrame | null = null;
  constructor(private readonly options: Required<TemporalOptions> = { tauMs: 100, fadeStartMs: 250, expireMs: 450 }) {}

  reset(): void { this.previous = null; }

  update(frame: TemporalFrame): TemporalResult {
    const prior = this.previous;
    const discontinuity = !!prior && (frame.generation !== prior.generation || frame.frameId <= prior.frameId);
    if (!prior || discontinuity || frame.landmarks.length !== prior.landmarks.length) {
      const landmarks = frame.landmarks.map(({ x, y }) => ({ x, y }));
      this.previous = { ...frame, landmarks };
      return { landmarks, freshness: 1, reset: !!prior };
    }
    const aligned = alignLandmarks(frame.landmarks, prior.landmarks);
    const dt = Math.max(0, frame.acquiredMs - prior.acquiredMs);
    const alpha = 1 - Math.exp(-dt / Math.max(1e-6, this.options.tauMs));
    const landmarks = aligned.map((point, i) => ({ x: prior.landmarks[i].x + (point.x - prior.landmarks[i].x) * alpha, y: prior.landmarks[i].y + (point.y - prior.landmarks[i].y) * alpha }));
    this.previous = { ...frame, landmarks };
    const freshness = clamp((this.options.expireMs - dt) / Math.max(1e-6, this.options.expireMs - this.options.fadeStartMs));
    return { landmarks, freshness, reset: false };
  }
}
