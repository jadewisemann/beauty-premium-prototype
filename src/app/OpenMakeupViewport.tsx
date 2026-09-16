import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { OpenMakeup, type MakeupEngine } from 'open-makeup-sdk';
// @ts-expect-error OpenMakeupSDK's three peer ships without TypeScript declarations.
import { CanvasTexture, Mesh, MeshBasicMaterial, type Scene } from 'three';
import { tintHairMask } from './hair-color';
import { applyOpenMakeup, type MakeupEngineInternals, type MakeupState } from './open-makeup';

const ASSETS_URL = 'https://cdn.jsdelivr.net/npm/open-makeup-sdk@0.1.0/assets';
const MEDIAPIPE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';

interface EngineInternals extends MakeupEngine, MakeupEngineInternals {
  _CameraClass: typeof ExistingVideoCamera;
  scene: Scene;
  videoPlane: Mesh;
  lipsMat?: unknown;
  foundationMat?: unknown;
  eyeLineMat?: unknown;
  faceVideoMesh?: { visible: boolean };
}

export function OpenMakeupViewport({ videoRef, makeup, hair, onReady, onHairReady, onError }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  makeup: MakeupState;
  hair: { color: string; strength: number };
  onReady(ready: boolean): void;
  onHairReady(ready: boolean): void;
  onError(message: string): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sdkRef = useRef<OpenMakeup | null>(null);
  const stateRef = useRef(makeup);
  const hairRef = useRef(hair);
  const callbacksRef = useRef({ onReady, onHairReady, onError });
  stateRef.current = makeup;
  hairRef.current = hair;
  callbacksRef.current = { onReady, onHairReady, onError };

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let cancelled = false;
    let initialized = false;
    const hairWorker = new Worker(new URL('./hair.worker.ts', import.meta.url), { type: 'module' });
    let disposeHair = () => hairWorker.terminate();
    const sdk = new OpenMakeup({ video, renderCanvas: canvas, assetsBaseUrl: ASSETS_URL, mediapipeBaseUrl: MEDIAPIPE_URL });
    const engine = sdk.engine as EngineInternals;

    void (async () => {
      try {
        engine._CameraClass = ExistingVideoCamera;
        await sdk.init();
        initialized = true;
        if (cancelled) return sdk.dispose();
        await waitForMakeup(engine, () => cancelled);
        if (cancelled) return sdk.dispose();
        sdk.resetMorph();
        sdk.setBlur(false);
        sdk.setWireframe(false);
        if (engine.faceVideoMesh) engine.faceVideoMesh.visible = false;
        sdkRef.current = sdk;
        await applyOpenMakeup(sdk, stateRef.current, engine);
        callbacksRef.current.onReady(true);
        disposeHair = addHairColor(engine, video, hairWorker, hairRef, callbacksRef, () => cancelled);
      } catch (error) {
        sdk.dispose();
        if (!cancelled) callbacksRef.current.onError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      callbacksRef.current.onReady(false);
      callbacksRef.current.onHairReady(false);
      disposeHair();
      sdkRef.current = null;
      if (initialized) sdk.dispose();
    };
  }, [videoRef]);

  useEffect(() => {
    if (!sdkRef.current) return;
    void applyOpenMakeup(sdkRef.current, makeup, sdkRef.current.engine as EngineInternals)
      .catch((error) => callbacksRef.current.onError(error instanceof Error ? error.message : String(error)));
  }, [makeup]);

  return <canvas ref={canvasRef} className="makeup-canvas" aria-label="메이크업 미리보기" />;
}

function addHairColor(
  engine: EngineInternals,
  video: HTMLVideoElement,
  worker: Worker,
  hair: RefObject<{ color: string; strength: number }>,
  callbacks: RefObject<{ onReady(ready: boolean): void; onHairReady(ready: boolean): void; onError(message: string): void }>,
  cancelled: () => boolean,
): () => void {
  const input = document.createElement('canvas');
  const maskCanvas = document.createElement('canvas');
  const inputContext = input.getContext('2d');
  const maskContext = maskCanvas.getContext('2d');
  if (!inputContext || !maskContext) throw new Error('헤어: canvas를 만들 수 없습니다.');
  const initialScale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
  input.width = maskCanvas.width = Math.max(1, Math.round(video.videoWidth * initialScale));
  input.height = maskCanvas.height = Math.max(1, Math.round(video.videoHeight * initialScale));

  const texture = new CanvasTexture(maskCanvas);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const plane = new Mesh(engine.videoPlane.geometry, material);
  plane.renderOrder = 20;
  plane.position.z = 20;
  engine.scene.add(plane);

  let frame = 0;
  let busy = false;
  let lastRun = 0;
  let imageData = maskContext.createImageData(maskCanvas.width, maskCanvas.height);
  let ready = false;

  worker.onmessage = ({ data }: MessageEvent<
    | { type: 'mask'; width: number; height: number; mask: Float32Array }
    | { type: 'error'; message: string }
  >) => {
    busy = false;
    if (cancelled()) return;
    if (data.type === 'error') return callbacks.current.onError(`헤어: ${data.message}`);
    if (maskCanvas.width !== data.width || maskCanvas.height !== data.height) {
      maskCanvas.width = data.width;
      maskCanvas.height = data.height;
      imageData = maskContext.createImageData(data.width, data.height);
    }
    tintHairMask(data.mask, imageData.data, hair.current.color, hair.current.strength);
    maskContext.putImageData(imageData, 0, 0);
    texture.needsUpdate = true;
    if (!ready) {
      ready = true;
      callbacks.current.onHairReady(true);
    }
  };

  const draw = (now: number) => {
    if (cancelled()) return;
    if (plane.geometry !== engine.videoPlane.geometry) plane.geometry = engine.videoPlane.geometry;
    if (!busy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastRun >= 66) {
      const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (input.width !== width || input.height !== height) {
        input.width = width;
        input.height = height;
      }
      inputContext.drawImage(video, 0, 0, width, height);
      lastRun = now;
      busy = true;
      void createImageBitmap(input).then((bitmap) => {
        if (cancelled()) return bitmap.close();
        worker.postMessage({ bitmap, timestamp: Math.ceil(now) }, [bitmap]);
      }).catch((error) => {
        busy = false;
        callbacks.current.onError(`헤어: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    engine.scene.remove(plane);
    material.dispose();
    texture.dispose();
    worker.terminate();
  };
}

class ExistingVideoCamera {
  private frame: number | null = null;
  private lastVideoTime = Number.NaN;
  private lastRun = 0;

  constructor(private readonly video: HTMLVideoElement, private readonly options: { onFrame: () => Promise<void> | null }) {}

  async start(): Promise<void> {
    if (this.frame === null) this.frame = requestAnimationFrame(this.tick);
  }

  async stop(): Promise<void> {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly tick = async (now: number): Promise<void> => {
    if (this.frame === null) return;
    if (!this.video.paused && this.video.currentTime !== this.lastVideoTime && now - this.lastRun >= 66) {
      this.lastVideoTime = this.video.currentTime;
      this.lastRun = now;
      await this.options.onFrame();
    }
    if (this.frame !== null) this.frame = requestAnimationFrame(this.tick);
  };
}

async function waitForMakeup(engine: EngineInternals, cancelled: () => boolean): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!cancelled() && performance.now() < deadline) {
    if (engine.foundationMat && engine.lipsMat && engine.blushMat && engine.eyeShadowMat && engine.eyeLineMat && engine.faceVideoMesh) return;
    await new Promise(requestAnimationFrame);
  }
  if (!cancelled()) throw new Error('OpenMakeupSDK initialization timed out');
}
