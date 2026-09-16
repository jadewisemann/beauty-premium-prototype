import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { OpenMakeup, type MakeupEngine } from 'open-makeup-sdk';
import { applyOpenMakeup, type MakeupEngineInternals, type MakeupState } from './open-makeup';

const ASSETS_URL = 'https://cdn.jsdelivr.net/npm/open-makeup-sdk@0.1.0/assets';
const MEDIAPIPE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  makeup: MakeupState;
  onReady(ready: boolean): void;
  onError(message: string): void;
}

interface EngineInternals extends MakeupEngine, MakeupEngineInternals {
  _FaceMeshClass: unknown;
  _CameraClass: typeof ExistingVideoCamera;
  lipsMat?: unknown;
  foundationMat?: unknown;
  eyeLineMat?: unknown;
  faceVideoMesh?: { visible: boolean };
}

export function OpenMakeupViewport({ videoRef, makeup, onReady, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sdkRef = useRef<OpenMakeup | null>(null);
  const makeupRef = useRef(makeup);
  const callbacksRef = useRef({ onReady, onError });
  makeupRef.current = makeup;
  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let cancelled = false;
    let initialized = false;
    const sdk = new OpenMakeup({ video, renderCanvas: canvas, assetsBaseUrl: ASSETS_URL, mediapipeBaseUrl: MEDIAPIPE_URL });
    const engine = sdk.engine as EngineInternals;

    void (async () => {
      try {
        const { FaceMesh } = await import('@mediapipe/face_mesh');
        engine._FaceMeshClass = FaceMesh;
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
        await applyOpenMakeup(sdk, makeupRef.current, engine);
        callbacksRef.current.onReady(true);
      } catch (error) {
        sdk.dispose();
        if (!cancelled) callbacksRef.current.onError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      callbacksRef.current.onReady(false);
      sdkRef.current = null;
      if (initialized) sdk.dispose();
    };
  }, [videoRef]);

  useEffect(() => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    void applyOpenMakeup(sdk, makeup, sdk.engine as EngineInternals)
      .catch((error) => callbacksRef.current.onError(error instanceof Error ? error.message : String(error)));
  }, [makeup]);

  return <canvas ref={canvasRef} className="makeup-canvas mirrored" aria-label="메이크업 미리보기" />;
}

class ExistingVideoCamera {
  private frame: number | null = null;
  private lastTime = Number.NaN;

  constructor(private readonly video: HTMLVideoElement, private readonly options: { onFrame: () => Promise<void> | null }) {}

  async start(): Promise<void> {
    if (this.frame === null) this.frame = requestAnimationFrame(this.tick);
  }

  async stop(): Promise<void> {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly tick = async (): Promise<void> => {
    if (this.frame === null) return;
    if (!this.video.paused && this.video.currentTime !== this.lastTime) {
      this.lastTime = this.video.currentTime;
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
