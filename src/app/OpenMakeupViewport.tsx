import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { OpenMakeup, type MakeupEngine } from 'open-makeup-sdk';
import type { LookRecipe } from '../engine/contracts';
import { applyOpenMakeupRecipe, type MakeupEngineInternals } from './open-makeup';

const ASSETS_URL = 'https://cdn.jsdelivr.net/npm/open-makeup-sdk@0.1.0/assets';
const MEDIAPIPE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';

interface Props {
  generation: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  recipe: LookRecipe;
  mirrored: boolean;
  visible: boolean;
  splitCompare: boolean;
  onReady(ready: boolean): void;
  onError(message: string): void;
}

interface EngineInternals extends MakeupEngine, MakeupEngineInternals {
  _FaceMeshClass: unknown;
  _CameraClass: typeof ExistingVideoCamera;
  lipsMat?: unknown;
  eyeLineMat?: unknown;
  faceVideoMesh?: { visible: boolean };
}

export function OpenMakeupViewport({ generation, videoRef, recipe, mirrored, visible, splitCompare, onReady, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const makeupRef = useRef<OpenMakeup | null>(null);
  const recipeRef = useRef(recipe);
  const callbacksRef = useRef({ onReady, onError });
  recipeRef.current = recipe;
  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let cancelled = false;
    let initialized = false;
    const makeup = new OpenMakeup({
      video,
      renderCanvas: canvas,
      assetsBaseUrl: ASSETS_URL,
      mediapipeBaseUrl: MEDIAPIPE_URL,
    });
    const engine = makeup.engine as EngineInternals;

    void (async () => {
      try {
        const { FaceMesh } = await import('@mediapipe/face_mesh');
        engine._FaceMeshClass = FaceMesh;
        engine._CameraClass = ExistingVideoCamera;
        await makeup.init();
        initialized = true;
        if (cancelled) {
          makeup.dispose();
          return;
        }
        await waitForMaterials(engine, () => cancelled);
        if (cancelled) {
          makeup.dispose();
          return;
        }
        makeup.resetMorph();
        makeup.setBlur(false);
        makeup.setWireframe(false);
        if (engine.faceVideoMesh) engine.faceVideoMesh.visible = false;
        makeupRef.current = makeup;
        await applyOpenMakeupRecipe(makeup, recipeRef.current, engine);
        callbacksRef.current.onReady(true);
      } catch (error) {
        makeup.dispose();
        if (!cancelled) callbacksRef.current.onError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      callbacksRef.current.onReady(false);
      makeupRef.current = null;
      if (initialized) makeup.dispose();
    };
  }, [generation, videoRef]);

  useEffect(() => {
    const makeup = makeupRef.current;
    if (!makeup) return;
    void applyOpenMakeupRecipe(makeup, recipe, makeup.engine as EngineInternals)
      .catch((error) => callbacksRef.current.onError(error instanceof Error ? error.message : String(error)));
  }, [recipe]);

  return (
    <canvas
      ref={canvasRef}
      className={`open-makeup-canvas ${mirrored ? 'open-makeup-canvas-mirrored' : ''} ${splitCompare ? 'open-makeup-canvas-split' : ''}`}
      style={{ opacity: visible ? 1 : 0 }}
      aria-label="OpenMakeupSDK 메이크업 미리보기"
    />
  );
}

class ExistingVideoCamera {
  private frame: number | null = null;
  private lastVideoTime = Number.NaN;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: { onFrame: () => Promise<void> | null },
  ) {}

  async start(): Promise<void> {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  async stop(): Promise<void> {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly tick = async (): Promise<void> => {
    if (this.frame === null) return;
    if (!this.video.paused && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      await this.options.onFrame();
    }
    if (this.frame !== null) this.frame = requestAnimationFrame(this.tick);
  };
}

async function waitForMaterials(engine: EngineInternals, cancelled: () => boolean): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!cancelled() && performance.now() < deadline) {
    if (engine.lipsMat && engine.eyeShadowMat && engine.eyeLineMat && engine.blushMat && engine.faceVideoMesh) return;
    await new Promise(requestAnimationFrame);
  }
  if (!cancelled()) throw new Error('OpenMakeupSDK makeup materials timed out');
}
