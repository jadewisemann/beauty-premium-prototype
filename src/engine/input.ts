export const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'user' },
    width: { ideal: 960, max: 960 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  },
} as const;

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 24_000_000;

export type InputErrorCode = 'CAMERA_UNAVAILABLE' | 'CAMERA_NO_VIDEO_TRACK' | 'PHOTO_UNSUPPORTED_FORMAT' | 'PHOTO_OVERSIZE' | 'PHOTO_DECODE_FAILED';

export class InputError extends Error {
  constructor(public readonly code: InputErrorCode, message: string = code, public readonly cause?: unknown) {
    super(message);
    this.name = 'InputError';
  }
}

type VideoTarget = Pick<HTMLVideoElement, 'srcObject' | 'play' | 'removeEventListener' | 'addEventListener'>;
type Bitmap = Pick<ImageBitmap, 'width' | 'height' | 'close'>;

export interface CameraDependencies {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export interface CameraSession {
  stream: MediaStream;
  settings: MediaTrackSettings;
  stop(): void;
}

export class CameraInput {
  private session: CameraSession | null = null;

  constructor(private readonly dependencies: CameraDependencies = {}) {}

  async start(video: VideoTarget): Promise<CameraSession> {
    this.stop();
    const getUserMedia = this.dependencies.getUserMedia ?? globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices);
    if (!getUserMedia) throw new InputError('CAMERA_UNAVAILABLE');

    let stream: MediaStream;
    try {
      stream = await getUserMedia(CAMERA_CONSTRAINTS);
    } catch (cause) {
      const detail = cause instanceof DOMException ? `${cause.name}: ${cause.message}` : String(cause);
      throw new InputError('CAMERA_UNAVAILABLE', `Camera permission or device request failed (${detail})`, cause);
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopTracks(stream);
      throw new InputError('CAMERA_NO_VIDEO_TRACK');
    }

    let stopped = false;
    const onLoadedMetadata = () => { void video.play().catch(() => undefined); };
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    const session: CameraSession = {
      stream,
      settings: track.getSettings(),
      stop: () => {
        if (stopped) return;
        stopped = true;
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        if (video.srcObject === stream) video.srcObject = null;
        stopTracks(stream);
        if (this.session === session) this.session = null;
      },
    };
    this.session = session;
    return session;
  }

  stop(): void { this.session?.stop(); }
}

export interface PhotoDependencies {
  createImageBitmap?: (source: ImageBitmapSource) => Promise<Bitmap>;
  createObjectURL?: (object: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

export interface DecodedPhoto {
  bitmap: Bitmap;
  width: number;
  height: number;
  objectUrl: string | null;
  dispose(): void;
}

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function decodePhoto(file: File, dependencies: PhotoDependencies = {}): Promise<DecodedPhoto> {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) throw new InputError('PHOTO_UNSUPPORTED_FORMAT');
  if (file.size > MAX_PHOTO_BYTES) throw new InputError('PHOTO_OVERSIZE');
  const createImageBitmap = dependencies.createImageBitmap ?? globalThis.createImageBitmap;
  if (!createImageBitmap) throw new InputError('PHOTO_DECODE_FAILED', 'Image decoding is unavailable');
  const createObjectURL = dependencies.createObjectURL ?? globalThis.URL?.createObjectURL?.bind(globalThis.URL);
  const revokeObjectURL = dependencies.revokeObjectURL ?? globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
  const objectUrl = createObjectURL?.(file) ?? null;
  let bitmap: Bitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_PHOTO_PIXELS) {
      throw new InputError('PHOTO_OVERSIZE', 'Decoded image exceeds the 24MP limit');
    }
  } catch (cause) {
    bitmap?.close();
    if (objectUrl) revokeObjectURL?.(objectUrl);
    if (cause instanceof InputError) throw cause;
    throw new InputError('PHOTO_DECODE_FAILED', 'Unable to decode photo', cause);
  }
  let disposed = false;
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    objectUrl,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      bitmap.close();
      if (objectUrl) revokeObjectURL?.(objectUrl);
    },
  };
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
