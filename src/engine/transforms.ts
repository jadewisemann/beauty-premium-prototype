import type { Mat3 } from './contracts';

/**
 * Coordinates are upright, unmirrored source UVs: (0,0) is top-left and
 * (1,1) is bottom-right. Matrices are row-major and map column vectors.
 */
export const identityMat3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export interface Point2 {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ContentFit = 'contain' | 'cover';

export interface SourceToDisplayOptions {
  sourceWidth: number;
  sourceHeight: number;
  viewport: Viewport;
  fit: ContentFit;
  /** Camera preview only; source data remains unmirrored. */
  mirror?: boolean;
}

const assertPositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
};

export function applyMat3(matrix: Mat3, point: Point2): Point2 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const w = g * point.x + h * point.y + i;
  if (w === 0) throw new RangeError('Transform maps point to infinity');
  return { x: (a * point.x + b * point.y + c) / w, y: (d * point.x + e * point.y + f) / w };
}

/** Returns a ∘ b: apply b first, then a. */
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const result = Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3) * 3;
    const column = index % 3;
    return a[row] * b[column] + a[row + 1] * b[column + 3] + a[row + 2] * b[column + 6];
  });
  return result as unknown as Mat3;
}

export function invertMat3(matrix: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const determinant = a * A + b * D + c * G;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new RangeError('Transform is not invertible');
  }
  return [A / determinant, B / determinant, C / determinant, D / determinant, E / determinant,
    F / determinant, G / determinant, H / determinant, I / determinant];
}

/** Maps a point in the current source frame onto the same face-local point in a reference frame. */
export function createCurrentToReferenceTransform(currentSourceToFace: Mat3, referenceSourceToFace: Mat3): Mat3 {
  return multiplyMat3(invertMat3(referenceSourceToFace), currentSourceToFace);
}

/** Briefly advances a similarity transform at its latest measured velocity. */
export function predictSimilarityTransform(
  previous: Mat3,
  current: Mat3,
  previousMs: number,
  currentMs: number,
  targetMs: number,
  maxLeadMs: number,
): Mat3 {
  const sampleMs = currentMs - previousMs;
  if (![previousMs, currentMs, targetMs, maxLeadMs].every(Number.isFinite)
    || sampleMs <= 0 || targetMs <= currentMs || maxLeadMs <= 0) return current;
  try {
    const previousPose = invertMat3(previous);
    const currentPose = invertMat3(current);
    const previousScale = Math.hypot(previousPose[0], previousPose[3]);
    const currentScale = Math.hypot(currentPose[0], currentPose[3]);
    const scaleRatio = currentScale / previousScale;
    const rotationDelta = Math.atan2(
      Math.sin(Math.atan2(currentPose[3], currentPose[0]) - Math.atan2(previousPose[3], previousPose[0])),
      Math.cos(Math.atan2(currentPose[3], currentPose[0]) - Math.atan2(previousPose[3], previousPose[0])),
    );
    if (!Number.isFinite(scaleRatio) || scaleRatio < 0.7 || scaleRatio > 1.4
      || Math.hypot(currentPose[2] - previousPose[2], currentPose[5] - previousPose[5]) > 0.2
      || Math.abs(rotationDelta) > Math.PI / 4) return current;
    const factor = Math.min(targetMs - currentMs, maxLeadMs, sampleMs) / sampleMs;
    const predictedPose: Mat3 = [
      currentPose[0] + (currentPose[0] - previousPose[0]) * factor,
      currentPose[1] + (currentPose[1] - previousPose[1]) * factor,
      currentPose[2] + (currentPose[2] - previousPose[2]) * factor,
      currentPose[3] + (currentPose[3] - previousPose[3]) * factor,
      currentPose[4] + (currentPose[4] - previousPose[4]) * factor,
      currentPose[5] + (currentPose[5] - previousPose[5]) * factor,
      currentPose[6], currentPose[7], currentPose[8],
    ];
    return invertMat3(predictedPose);
  } catch {
    return current;
  }
}

/** UV rotation used only while normalising an input before it becomes source S. */
export function rotateSourceUv(clockwiseDegrees: 0 | 90 | 180 | 270): Mat3 {
  switch (clockwiseDegrees) {
    case 0: return identityMat3();
    case 90: return [0, -1, 1, 1, 0, 0, 0, 0, 1];
    case 180: return [-1, 0, 1, 0, -1, 1, 0, 0, 1];
    case 270: return [0, 1, 0, -1, 0, 1, 0, 0, 1];
  }
}

/**
 * Maps source UV directly to display pixels in one viewport. Cover deliberately
 * maps some source UVs outside that viewport; the renderer clips to it.
 */
export function createSourceToDisplayTransform({
  sourceWidth,
  sourceHeight,
  viewport,
  fit,
  mirror = false,
}: SourceToDisplayOptions): Mat3 {
  assertPositive(sourceWidth, 'sourceWidth');
  assertPositive(sourceHeight, 'sourceHeight');
  assertPositive(viewport.width, 'viewport.width');
  assertPositive(viewport.height, 'viewport.height');
  if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)) {
    throw new RangeError('viewport origin must be finite');
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const scale = fit === 'contain'
    ? Math.min(viewport.width / sourceAspect, viewport.height)
    : Math.max(viewport.width / sourceAspect, viewport.height);
  const renderedWidth = sourceAspect * scale;
  const offsetX = viewport.x + (viewport.width - renderedWidth) / 2;
  const offsetY = viewport.y + (viewport.height - scale) / 2;

  return mirror
    ? [-renderedWidth, 0, offsetX + renderedWidth, 0, scale, offsetY, 0, 0, 1]
    : [renderedWidth, 0, offsetX, 0, scale, offsetY, 0, 0, 1];
}
