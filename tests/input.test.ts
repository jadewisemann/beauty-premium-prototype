import { describe, expect, it, vi } from 'vitest';
import { CAMERA_CONSTRAINTS, CameraInput, decodePhoto, InputError, MAX_PHOTO_BYTES } from '../src/engine/input';

const video = () => ({ srcObject: null as MediaProvider | null, play: vi.fn(() => Promise.resolve()), addEventListener: vi.fn(), removeEventListener: vi.fn() });
type MediaProvider = MediaStream;

function stream(settings: MediaTrackSettings = { width: 640, height: 480 }) {
  const track = { getSettings: vi.fn(() => settings), stop: vi.fn() };
  return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream & { getTracks(): typeof track[] };
}

describe('CameraInput', () => {
  it('uses ideal front-camera constraints, reports settings, and stops cleanly', async () => {
    const media = stream({ width: 720, height: 1280, frameRate: 29.97 });
    const getUserMedia = vi.fn(async () => media);
    const target = video();
    const input = new CameraInput({ getUserMedia });
    const session = await input.start(target);

    expect(getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(session.settings).toEqual({ width: 720, height: 1280, frameRate: 29.97 });
    expect(target.srcObject).toBe(media);
    session.stop();
    session.stop();
    expect(media.getTracks()[0].stop).toHaveBeenCalledTimes(1);
    expect(target.removeEventListener).toHaveBeenCalled();
    expect(target.srcObject).toBeNull();
  });

  it('normalizes camera request failures', async () => {
    const input = new CameraInput({ getUserMedia: async () => { throw new Error('denied'); } });
    await expect(input.start(video())).rejects.toMatchObject({ code: 'CAMERA_UNAVAILABLE' } satisfies Partial<InputError>);
  });
});

describe('decodePhoto', () => {
  const file = (type = 'image/jpeg', size = 1) => new File(['x'], 'photo', { type });

  it('rejects unsupported types and oversized input before decoding', async () => {
    await expect(decodePhoto(file('image/heic'))).rejects.toMatchObject({ code: 'PHOTO_UNSUPPORTED_FORMAT' });
    const big = new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' });
    await expect(decodePhoto(big)).rejects.toMatchObject({ code: 'PHOTO_OVERSIZE' });
  });

  it('disposes decoded bitmaps and object URLs', async () => {
    const bitmap = { width: 100, height: 200, close: vi.fn() };
    const createObjectURL = vi.fn(() => 'blob:photo');
    const revokeObjectURL = vi.fn();
    const photo = await decodePhoto(file(), { createImageBitmap: async () => bitmap, createObjectURL, revokeObjectURL });
    expect(photo.width).toBe(100);
    photo.dispose();
    photo.dispose();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('closes and revokes a decoded oversized bitmap', async () => {
    const bitmap = { width: 6000, height: 5000, close: vi.fn() };
    const revokeObjectURL = vi.fn();
    await expect(decodePhoto(file(), { createImageBitmap: async () => bitmap, createObjectURL: () => 'blob:large', revokeObjectURL })).rejects.toMatchObject({ code: 'PHOTO_OVERSIZE' });
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:large');
  });
});
