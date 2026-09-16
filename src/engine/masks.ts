import { FaceLandmarker } from '@mediapipe/tasks-vision';

export interface MaskPoint { x: number; y: number }
export interface MaskConnection { start: number; end: number }
export interface BlushEllipse { center: MaskPoint; radiusX: number; radiusY: number; rotation: number }

const point = (landmarks: readonly MaskPoint[] | ArrayLike<number>, index: number): MaskPoint => {
  const value = landmarks[index] as MaskPoint | number | undefined;
  return typeof value === 'object' && value !== null ? value : { x: Number(landmarks[index * 3]) || 0, y: Number(landmarks[index * 3 + 1]) || 0 };
};

/** Orders an unordered set of edges into the closed walks it describes. */
export function closedLoops(edges: readonly MaskConnection[]): number[][] {
  const remaining = edges.map(({ start, end }) => [start, end]);
  const loops: number[][] = [];
  while (remaining.length) {
    const [a, b] = remaining.pop()!;
    const loop = [a, b];
    let current = b;
    while (current !== a) {
      const i = remaining.findIndex(([x, y]) => x === current || y === current);
      if (i < 0) break;
      const [x, y] = remaining.splice(i, 1)[0];
      current = x === current ? y : x;
      loop.push(current);
    }
    if (loop.length > 2 && current === a) loops.push(loop.slice(0, -1));
  }
  return loops;
}

export function lipLoops(landmarks: readonly MaskPoint[] | ArrayLike<number>, edges: readonly MaskConnection[] = FaceLandmarker.FACE_LANDMARKS_LIPS): MaskPoint[][] {
  return closedLoops(edges).map(loop => loop.map(index => point(landmarks, index)));
}

/** Draws outer and inner lip contours with the even-odd rule when supported. */
export function drawLipMask(ctx: { beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void; fill(rule?: 'nonzero' | 'evenodd'): void }, landmarks: readonly MaskPoint[] | ArrayLike<number>, edges?: readonly MaskConnection[]): void {
  const loops = lipLoops(landmarks, edges);
  if (!loops.length) return;
  ctx.beginPath();
  for (const loop of loops) {
    ctx.moveTo(loop[0].x, loop[0].y);
    for (const p of loop.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  }
  try { ctx.fill('evenodd'); } catch { ctx.fill(); }
}

export function blushEllipses(landmarks: readonly MaskPoint[] | ArrayLike<number>, size = 0.58): [BlushEllipse, BlushEllipse] {
  const available = Array.isArray(landmarks) ? landmarks.length : Math.floor(landmarks.length / 3);
  if (available < 281) {
    const radiusX = 0.16 * Math.max(0.1, size);
    return [
      { center: { x: 0.35, y: 0.55 }, radiusX, radiusY: radiusX * 0.62, rotation: 0 },
      { center: { x: 0.65, y: 0.55 }, radiusX, radiusY: radiusX * 0.62, rotation: 0 },
    ];
  }
  const p = (i: number) => point(landmarks, i);
  const left = p(50), right = p(280), nose = p(1);
  const finite = (v: number, fallback: number) => Number.isFinite(v) ? v : fallback;
  const span = Math.max(0.02, Math.abs(right.x - left.x));
  const radiusX = finite(span * 0.16 * Math.max(0.1, size), 0.04);
  const radiusY = radiusX * 0.62;
  const y = finite((left.y + right.y) / 2 + Math.abs(nose.y - (left.y + right.y) / 2) * 0.1, 0.55);
  return [
    { center: { x: finite(left.x, 0.35), y }, radiusX, radiusY, rotation: 0 },
    { center: { x: finite(right.x, 0.65), y }, radiusX, radiusY, rotation: 0 },
  ];
}

export const computeBlushEllipses = blushEllipses;
