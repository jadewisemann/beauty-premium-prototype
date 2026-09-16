import { initialEngineConfig } from './config';
import type { EngineError, EngineErrorCode, EngineState, FaceSnapshot, FrameMeta, HairSnapshot, SourceKind, WorkerResponse } from './contracts';
import { Diagnostics } from './diagnostics';
import { CameraInput, decodePhoto, InputError, type DecodedPhoto } from './input';
import { PerceptionClient, type PerceptionFrame } from './perception';
import { LatestFrameScheduler } from './scheduler';
import { createSourceToDisplayTransform } from './transforms';

export interface ControllerSnapshot {
  state: EngineState;
  generation: number;
  sourceKind: SourceKind | null;
  error: EngineError | null;
  face: FaceSnapshot | null;
  hair: HairSnapshot | null;
  photoBitmap: ImageBitmap | null;
  capturedRecipeRevision: number | null;
}

type StatusListener = () => void;

export class BeautyController {
  readonly diagnostics = new Diagnostics();
  private perception = new PerceptionClient();
  private readonly camera = new CameraInput();
  private readonly listeners = new Set<StatusListener>();
  private snapshot: ControllerSnapshot = {
    state: 'IDLE',
    generation: 0,
    sourceKind: null,
    error: null,
    face: null,
    hair: null,
    photoBitmap: null,
    capturedRecipeRevision: null,
  };
  private scheduler: LatestFrameScheduler<PerceptionFrame> | null = null;
  private photo: DecodedPhoto | null = null;
  private replayUrl: string | null = null;
  private video: HTMLVideoElement | null = null;
  private videoFrameHandle: number | null = null;
  private animationHandle: number | null = null;
  private bitmapCreationPending = false;
  private bitmapCreationSequence = 0;
  private lastVideoTime = -1;
  private lastFaceScheduledMs = Number.NEGATIVE_INFINITY;
  private lastHairCompletedMs = Number.NEGATIVE_INFINITY;
  private activeHairFrameId: number | null = null;
  private taskTimestampMs = 0;
  private frameId = 0;
  private disposed = false;

  constructor() {
    this.bindPerception();
  }

  subscribe = (listener: StatusListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControllerSnapshot => this.snapshot;

  async initialize(): Promise<void> {
    if (this.disposed) return;
    const startedAt = performance.now();
    this.transition('LOADING_MODELS');
    try {
      await withTimeout(this.perception.init(), 15_000, 'Model initialization timed out');
      this.diagnostics.timing('model-load', performance.now() - startedAt);
      this.transition('READY');
    } catch (error) {
      this.fail(error instanceof TaskTimeoutError ? 'TIMEOUT' : 'MODEL_INIT_FAILED', error);
    }
  }

  async startCamera(video: HTMLVideoElement): Promise<void> {
    const generation = this.startNewSource('camera');
    this.transition('REQUESTING_CAMERA');
    try {
      const session = await this.camera.start(video);
      if (generation !== this.snapshot.generation) {
        session.stop();
        return;
      }
      this.video = video;
      this.diagnostics.setCameraSettings(session.settings);
      await this.perception.setMode('VIDEO', generation);
      if (generation !== this.snapshot.generation) return;
      this.scheduler = this.createLiveScheduler('Camera inference timed out');
      this.transition('LIVE');
      this.scheduleLiveFrame();
    } catch (error) {
      this.camera.stop();
      this.fail(error instanceof InputError ? inputErrorCode(error) : 'MODEL_MODE_FAILED', error);
    }
  }

  async selectPhoto(file: File): Promise<void> {
    const generation = this.startNewSource('photo');
    this.transition('DECODING_PHOTO');
    try {
      const photo = await decodePhoto(file);
      if (generation !== this.snapshot.generation) {
        photo.dispose();
        return;
      }
      await this.installPhoto(generation, photo, null);
    } catch (error) {
      this.fail(error instanceof InputError ? inputErrorCode(error) : 'MODEL_INFERENCE_FAILED', error);
    }
  }

  async startReplay(video: HTMLVideoElement, file: File): Promise<void> {
    const generation = this.startNewSource('replay');
    this.transition('DECODING_PHOTO');
    try {
      if (!file.type.startsWith('video/')) throw new Error('Replay file must be a browser-supported video');
      const url = URL.createObjectURL(file);
      this.replayUrl = url;
      this.video = video;
      video.srcObject = null;
      video.src = url;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      await waitForVideo(video);
      await video.play();
      await this.perception.setMode('VIDEO', generation);
      if (generation !== this.snapshot.generation) return;
      this.scheduler = this.createLiveScheduler('Replay inference timed out');
      this.transition('LIVE');
      this.scheduleLiveFrame();
    } catch (error) {
      this.fail('REPLAY_DECODE_FAILED', error);
    }
  }

  async retry(): Promise<void> {
    if (this.snapshot.state !== 'ERROR') return;
    this.stopSource();
    this.snapshot = {
      ...this.snapshot,
      generation: this.snapshot.generation + 1,
      sourceKind: null,
      error: null,
      face: null,
      hair: null,
      photoBitmap: null,
      capturedRecipeRevision: null,
    };
    this.emit();
    this.restartPerception();
    await this.initialize();
  }

  async captureFrame(video: HTMLVideoElement, recipeRevision: number): Promise<void> {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(video);
      const generation = this.startNewSource('photo');
      this.transition('FREEZING');
      const ownedBitmap = bitmap;
      bitmap = null;
      const photo: DecodedPhoto = {
        bitmap: ownedBitmap,
        width: ownedBitmap.width,
        height: ownedBitmap.height,
        objectUrl: null,
        dispose: () => ownedBitmap.close(),
      };
      await this.installPhoto(generation, photo, recipeRevision);
    } catch (error) {
      bitmap?.close();
      this.fail('PHOTO_DECODE_FAILED', error);
    }
  }

  setVisibility(visible: boolean): void {
    if (!visible && this.snapshot.state === 'LIVE') {
      this.cancelLiveFrame();
      this.bitmapCreationSequence += 1;
      this.bitmapCreationPending = false;
      this.transition('PAUSED');
      return;
    }
    if (visible && this.snapshot.state === 'PAUSED' && this.video) {
      const buffer = this.snapshot.hair ? transferableBuffer(this.snapshot.hair.values) : null;
      if (buffer) this.perception.recycle(buffer);
      this.snapshot = { ...this.snapshot, face: null, hair: null };
      this.transition('LIVE');
      this.scheduleLiveFrame();
    }
  }

  reportRendererError(message: string): void {
    this.fail('CONTEXT_LOST', new Error(message));
  }

  async recoverRenderer(): Promise<void> {
    if (this.snapshot.error?.code !== 'CONTEXT_LOST') return;
    this.scheduler?.dispose();
    this.scheduler = null;
    this.cancelLiveFrame();
    this.resetLiveScheduling();
    const previousHair = this.snapshot.hair;
    const buffer = previousHair ? transferableBuffer(previousHair.values) : null;
    if (buffer) this.perception.recycle(buffer);
    const generation = this.snapshot.generation + 1;
    const kind = this.snapshot.sourceKind;
    this.snapshot = { ...this.snapshot, generation, error: null, face: null, hair: null };
    this.emit();
    try {
      if (kind === 'photo' && this.photo) {
        await this.installPhoto(generation, this.photo, this.snapshot.capturedRecipeRevision);
      } else if ((kind === 'camera' || kind === 'replay') && this.video) {
        await withTimeout(this.perception.setMode('VIDEO', generation), 15_000, 'Renderer recovery mode switch timed out');
        this.scheduler = this.createLiveScheduler('Recovered live inference timed out');
        this.transition('LIVE');
        this.scheduleLiveFrame();
      } else {
        this.transition('READY');
      }
    } catch (error) {
      this.fail(error instanceof TaskTimeoutError ? 'TIMEOUT' : 'MODEL_MODE_FAILED', error);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transition('DISPOSING');
    this.stopSource();
    this.perception.dispose();
    this.snapshot = { ...this.snapshot, state: 'IDLE', sourceKind: null };
    this.emit();
    this.listeners.clear();
  }

  private startNewSource(sourceKind: SourceKind): number {
    this.stopSource();
    const generation = this.snapshot.generation + 1;
    this.frameId = 0;
    this.snapshot = {
      state: 'SWITCHING_SOURCE',
      generation,
      sourceKind,
      error: null,
      face: null,
      hair: null,
      photoBitmap: null,
      capturedRecipeRevision: null,
    };
    this.emit();
    return generation;
  }

  private stopSource(): void {
    this.cancelLiveFrame();
    this.scheduler?.dispose();
    this.scheduler = null;
    this.camera.stop();
    if (this.replayUrl && this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.video = null;
    this.photo?.dispose();
    this.photo = null;
    if (this.replayUrl) URL.revokeObjectURL(this.replayUrl);
    this.replayUrl = null;
    this.resetLiveScheduling();
    const hairBuffer = this.snapshot.hair ? transferableBuffer(this.snapshot.hair.values) : null;
    if (hairBuffer) this.perception.recycle(hairBuffer);
  }

  private resetLiveScheduling(): void {
    this.bitmapCreationSequence += 1;
    this.bitmapCreationPending = false;
    this.lastFaceScheduledMs = Number.NEGATIVE_INFINITY;
    this.lastHairCompletedMs = Number.NEGATIVE_INFINITY;
    this.activeHairFrameId = null;
  }

  private async installPhoto(generation: number, photo: DecodedPhoto, capturedRecipeRevision: number | null): Promise<void> {
    this.photo = photo;
    this.snapshot = { ...this.snapshot, photoBitmap: photo.bitmap as ImageBitmap, capturedRecipeRevision };
    await withTimeout(this.perception.setMode('IMAGE', generation), 15_000, 'Photo mode switch timed out');
    if (generation !== this.snapshot.generation) return;
    this.transition('ANALYZING_PHOTO');
    const bitmap = await createAnalysisBitmap(photo.bitmap as ImageBitmap);
    if (generation !== this.snapshot.generation) {
      bitmap.close();
      return;
    }
    const meta = this.createFrameMeta('photo', photo.width, photo.height, false);
    this.scheduler = new LatestFrameScheduler(async (frame) => {
      await withTimeout(this.perception.analyze(frame), 30_000, 'Photo inference timed out');
      if (generation === this.snapshot.generation && this.snapshot.state === 'ANALYZING_PHOTO') this.transition('PHOTO');
    }, (error) => this.handleTaskError(error));
    this.scheduler.submit({ bitmap, meta, runFace: true, runHair: true, close: () => bitmap.close() });
  }

  private scheduleLiveFrame(): void {
    const video = this.video;
    if (!video || this.snapshot.state !== 'LIVE') return;
    const requestVideoFrame = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback'];
    }).requestVideoFrameCallback;
    if (typeof requestVideoFrame === 'function') {
      this.videoFrameHandle = requestVideoFrame.call(video, () => {
        void this.captureLiveFrame();
        this.scheduleLiveFrame();
      });
      return;
    }
    this.animationHandle = requestAnimationFrame(() => {
      if (video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;
        void this.captureLiveFrame();
      }
      this.scheduleLiveFrame();
    });
  }

  private cancelLiveFrame(): void {
    if (this.video && this.videoFrameHandle !== null && 'cancelVideoFrameCallback' in this.video) {
      this.video.cancelVideoFrameCallback(this.videoFrameHandle);
    }
    if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
    this.videoFrameHandle = null;
    this.animationHandle = null;
  }

  private async captureLiveFrame(): Promise<void> {
    const video = this.video;
    const scheduler = this.scheduler;
    if (!video || !scheduler || this.bitmapCreationPending || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const generation = this.snapshot.generation;
    const acquiredMs = performance.now();
    const faceDue = acquiredMs - this.lastFaceScheduledMs >= 1000 / initialEngineConfig.faceMaxHz;
    const hairDue = this.activeHairFrameId === null
      && acquiredMs - this.lastHairCompletedMs >= 1000 / initialEngineConfig.hairMaxHz;
    if (!faceDue && (!hairDue || scheduler.queued >= 2)) return;
    const bitmapCreationSequence = ++this.bitmapCreationSequence;
    this.bitmapCreationPending = true;
    try {
      const scale = Math.min(1, initialEngineConfig.liveLongEdge / Math.max(video.videoWidth, video.videoHeight));
      const bitmap = scale < 1
        ? await createImageBitmap(video, {
            resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
            resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
            resizeQuality: 'medium',
          })
        : await createImageBitmap(video);
      if (bitmapCreationSequence !== this.bitmapCreationSequence
        || this.snapshot.state !== 'LIVE' || this.snapshot.generation !== generation
        || this.video !== video || this.scheduler !== scheduler) {
        bitmap.close();
        return;
      }
      const runHair = this.activeHairFrameId === null
        && performance.now() - this.lastHairCompletedMs >= 1000 / initialEngineConfig.hairMaxHz;
      const runFace = faceDue || runHair;
      if (!runFace) {
        bitmap.close();
        return;
      }
      if (runFace) this.lastFaceScheduledMs = acquiredMs;
      const kind = this.snapshot.sourceKind === 'replay' ? 'replay' : 'camera';
      const meta = this.createFrameMeta(kind, bitmap.width, bitmap.height, kind === 'camera', acquiredMs);
      scheduler.submit({ bitmap, meta, runFace, runHair, close: () => bitmap.close() });
      this.diagnostics.increment('frames-scheduled');
    } catch (error) {
      if (bitmapCreationSequence === this.bitmapCreationSequence) this.diagnostics.error('FRAME_ACQUIRE_FAILED');
      void error;
    } finally {
      if (bitmapCreationSequence === this.bitmapCreationSequence) this.bitmapCreationPending = false;
    }
  }

  private createLiveScheduler(timeoutMessage: string): LatestFrameScheduler<PerceptionFrame> {
    return new LatestFrameScheduler(
      (frame) => {
        if (frame.runHair) this.activeHairFrameId = frame.meta.frameId;
        return withTimeout(this.perception.analyze(frame), 15_000, timeoutMessage);
      },
      (error) => this.handleTaskError(error),
    );
  }

  private createFrameMeta(
    kind: SourceKind,
    sourceWidth: number,
    sourceHeight: number,
    mirror: boolean,
    acquiredMs = performance.now(),
  ): FrameMeta {
    this.taskTimestampMs = Math.max(this.taskTimestampMs + 1, Math.ceil(acquiredMs));
    return {
      generation: this.snapshot.generation,
      frameId: ++this.frameId,
      kind,
      acquiredMs,
      taskTimestampMs: this.taskTimestampMs,
      sourceWidth,
      sourceHeight,
      sourceToDisplay: createSourceToDisplayTransform({
        sourceWidth,
        sourceHeight,
        viewport: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
        fit: 'contain',
        mirror,
      }),
    };
  }

  private handleWorkerMessage(message: WorkerResponse): void {
    if ('generation' in message && message.generation !== this.snapshot.generation) return;
    if (message.type === 'HAIR_RESULT' && message.result.frame.generation !== this.snapshot.generation) {
      const buffer = transferableBuffer(message.result.values);
      if (buffer) this.perception.recycle(buffer);
      return;
    }
    if ((message.type === 'FACE_RESULT' || message.type === 'FRAME_DONE')
      && message.frame.generation !== this.snapshot.generation) {
      return;
    }
    if (message.type === 'FACE_RESULT') {
      this.snapshot = { ...this.snapshot, face: message.result };
      this.diagnostics.increment(message.result ? 'face-results' : 'face-misses');
    } else if (message.type === 'HAIR_RESULT') {
      if (this.snapshot.sourceKind !== 'photo' && !message.result.poseAtSource) {
        const buffer = transferableBuffer(message.result.values);
        if (buffer) this.perception.recycle(buffer);
        this.diagnostics.increment('hair-unanchored-dropped');
        return;
      }
      const previousBuffer = this.snapshot.hair ? transferableBuffer(this.snapshot.hair.values) : null;
      this.snapshot = { ...this.snapshot, hair: message.result };
      this.diagnostics.increment('hair-results');
      this.diagnostics.timing('hair-inference', message.result.inferenceMs);
      this.diagnostics.timing('hair-readback-copy', message.result.readbackAndCopyMs);
      if (previousBuffer) this.perception.recycle(previousBuffer);
    } else if (message.type === 'FRAME_DONE') {
      if (message.frame.frameId === this.activeHairFrameId) {
        this.activeHairFrameId = null;
        this.lastHairCompletedMs = performance.now();
      }
      this.diagnostics.timing('frame-total', performance.now() - message.frame.acquiredMs);
      this.diagnostics.increment('frames-completed');
    } else if (message.type === 'ERROR') {
      this.diagnostics.error(message.code);
      const code: EngineErrorCode = message.code === 'MODEL_MODE_FAILED'
        ? 'MODEL_MODE_FAILED'
        : message.code === 'MODEL_INIT_FAILED' ? 'MODEL_INIT_FAILED' : 'MODEL_INFERENCE_FAILED';
      this.fail(code, new Error(message.message), message.frameId);
    }
  }

  private bindPerception(): void {
    this.perception.subscribe((message) => this.handleWorkerMessage(message));
  }

  private restartPerception(): void {
    this.perception.dispose();
    this.perception = new PerceptionClient();
    this.bindPerception();
  }

  private handleTaskError(error: unknown): void {
    if (error instanceof TaskTimeoutError) {
      this.stopSource();
      this.restartPerception();
      this.snapshot = { ...this.snapshot, generation: this.snapshot.generation + 1 };
      this.fail('TIMEOUT', error);
      return;
    }
    this.fail('MODEL_INFERENCE_FAILED', error);
  }

  private transition(state: EngineState): void {
    this.snapshot = { ...this.snapshot, state };
    this.emit();
  }

  private fail(code: EngineErrorCode, error: unknown, frameId?: number): void {
    if (this.disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    this.diagnostics.error(code);
    this.snapshot = {
      ...this.snapshot,
      state: 'ERROR',
      error: {
        code,
        message,
        generation: this.snapshot.generation,
        ...(frameId === undefined ? {} : { frameId }),
        recoverable: true,
      },
    };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

async function createAnalysisBitmap(source: ImageBitmap): Promise<ImageBitmap> {
  const longEdge = Math.max(source.width, source.height);
  const scale = Math.min(1, initialEngineConfig.photoAnalysisLongEdge / longEdge);
  return createImageBitmap(source, {
    resizeWidth: Math.max(1, Math.round(source.width * scale)),
    resizeHeight: Math.max(1, Math.round(source.height * scale)),
    resizeQuality: 'high',
  });
}

function inputErrorCode(error: unknown): EngineErrorCode {
  if (!(error instanceof InputError)) return 'PHOTO_DECODE_FAILED';
  if (error.code === 'CAMERA_UNAVAILABLE') {
    return error.cause instanceof DOMException && error.cause.name === 'NotAllowedError' ? 'CAMERA_DENIED' : 'CAMERA_UNAVAILABLE';
  }
  if (error.code === 'CAMERA_NO_VIDEO_TRACK') return 'CAMERA_NO_VIDEO_TRACK';
  if (error.code === 'PHOTO_UNSUPPORTED_FORMAT') return 'UNSUPPORTED_PHOTO_FORMAT';
  if (error.code === 'PHOTO_OVERSIZE') return 'PHOTO_OVERSIZE';
  return 'PHOTO_DECODE_FAILED';
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Replay video could not be decoded')); };
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function transferableBuffer(values: Uint8Array): ArrayBuffer | null {
  return values.buffer instanceof ArrayBuffer ? values.buffer : null;
}

class TaskTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new TaskTimeoutError(message)), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}
