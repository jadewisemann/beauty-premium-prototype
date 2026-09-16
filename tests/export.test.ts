import { describe, expect, it } from 'vitest';
import { canvasToBlob, captureMetadata, downloadBlob, safeFilename } from '../src/engine/export';
import type { FrameMeta } from '../src/engine/contracts';

const frame: FrameMeta = {
  generation: 2, frameId: 7, kind: 'photo', acquiredMs: 10, taskTimestampMs: 11,
  sourceWidth: 100, sourceHeight: 80, sourceToDisplay: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

describe('export helpers', () => {
  it('keeps exact frame identity while isolating metadata', () => {
    const result = captureMetadata(frame, 42);
    expect(result.frame).toEqual(frame);
    expect(result.frame).not.toBe(frame);
    expect(result.capturedAtMs).toBe(42);
  });

  it('makes a safe deterministic filename', () => {
    expect(safeFilename(' My face / 01 ', 'jpg')).toBe('My-face-01.jpg');
    expect(safeFilename('...', 'png')).toBe('becon-capture.png');
  });

  it('exports both canvas APIs without a DOM', async () => {
    const blob = new Blob(['ok']);
    await expect(canvasToBlob({ toBlob: (done) => done(blob) })).resolves.toBe(blob);
    await expect(canvasToBlob({ convertToBlob: async () => blob }, 'image/jpeg', 0.8)).resolves.toBe(blob);
  });

  it('revokes downloaded object URLs even when adapter download throws', () => {
    const events: string[] = [];
    expect(() => downloadBlob(new Blob(), 'x.png', {
      createObjectURL: () => 'blob:x', revokeObjectURL: (url) => events.push(`revoke:${url}`),
      download: () => { events.push('download'); throw new Error('blocked'); },
    })).toThrow('blocked');
    expect(events).toEqual(['download', 'revoke:blob:x']);
  });
});
