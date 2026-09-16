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
