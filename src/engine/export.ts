import type { FrameMeta } from './contracts';

export type ExportFormat = 'image/png' | 'image/jpeg';

/** Immutable metadata attached to an export; the frame identity is never regenerated. */
export interface CaptureMetadata {
  frame: FrameMeta;
  capturedAtMs: number;
}

export function captureMetadata(frame: FrameMeta, capturedAtMs = performance.now()): CaptureMetadata {
  return { frame: { ...frame, sourceToDisplay: [...frame.sourceToDisplay] as FrameMeta['sourceToDisplay'] }, capturedAtMs };
}

export const createCaptureMetadata = captureMetadata;

export function safeFilename(value: string, extension: 'png' | 'jpg' = 'png'): string {
  const stem = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'becon-capture';
  return `${stem}.${extension}`;
}

export function canvasToBlob(
  canvas: Pick<HTMLCanvasElement, 'toBlob'> | { convertToBlob: (options?: ImageEncodeOptions) => Promise<Blob> },
  type: ExportFormat = 'image/png',
  quality?: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, ...(quality === undefined ? {} : { quality }) });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas export failed')), type, quality));
}

export async function exportCanvas(
  canvas: Pick<HTMLCanvasElement, 'toBlob'> | { convertToBlob: (options?: ImageEncodeOptions) => Promise<Blob> },
  format: 'png' | 'jpg' = 'png',
  quality?: number,
): Promise<{ blob: Blob; filename: string }> {
  const type: ExportFormat = format === 'jpg' ? 'image/jpeg' : 'image/png';
  return { blob: await canvasToBlob(canvas, type, quality), filename: safeFilename('becon-capture', format) };
}

export interface DownloadAdapter {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  download(url: string, filename: string): void;
}

export function downloadBlob(blob: Blob, filename: string, adapter: DownloadAdapter = browserDownloadAdapter): void {
  const url = adapter.createObjectURL(blob);
  try { adapter.download(url, filename); } finally { adapter.revokeObjectURL(url); }
}

const browserDownloadAdapter: DownloadAdapter = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  download: (url, filename) => { const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); },
};
