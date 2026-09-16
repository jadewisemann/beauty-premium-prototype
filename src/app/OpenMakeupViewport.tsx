import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { OpenMakeup, type MakeupEngine } from 'open-makeup-sdk';
// @ts-expect-error OpenMakeupSDK's three peer ships without TypeScript declarations.
import { CanvasTexture, Color, Mesh, ShaderMaterial, Vector2, type Scene } from 'three';
import { paintHairMask } from './hair-color';
import { applyOpenMakeup, type MakeupEngineInternals, type MakeupState } from './open-makeup';

const ASSETS_URL = 'https://cdn.jsdelivr.net/npm/open-makeup-sdk@0.1.0/assets';
const MEDIAPIPE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619';
const HAIR_INPUT_SIZE = 512;
const HAIR_FRAME_INTERVAL_MS = 33;

interface EngineInternals extends MakeupEngine, MakeupEngineInternals {
  _CameraClass: typeof ExistingVideoCamera;
  scene: Scene;
  videoPlane: Mesh;
  videoTexture: unknown;
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
  const initialScale = Math.min(1, HAIR_INPUT_SIZE / Math.max(video.videoWidth, video.videoHeight));
  input.width = maskCanvas.width = Math.max(1, Math.round(video.videoWidth * initialScale));
  input.height = maskCanvas.height = Math.max(1, Math.round(video.videoHeight * initialScale));

  const texture = new CanvasTexture(maskCanvas);
  const material = new ShaderMaterial({
    uniforms: {
      uSource: { value: engine.videoTexture },
      uMask: { value: texture },
      uMaskTexel: { value: new Vector2(1 / maskCanvas.width, 1 / maskCanvas.height) },
      uTarget: { value: new Color(hair.current.color) },
      uStrength: { value: hair.current.strength },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uSource;
      uniform sampler2D uMask;
      uniform vec2 uMaskTexel;
      uniform vec3 uTarget;
      uniform float uStrength;
      varying vec2 vUv;

      vec3 toLinear(vec3 color) {
        return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
      }

      vec3 toSrgb(vec3 color) {
        return mix(color * 12.92, 1.055 * pow(max(color, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), color));
      }

      float luma(vec3 color) {
        return dot(color, vec3(0.2126, 0.7152, 0.0722));
      }

      float refinedMask(vec2 uv) {
        float centerLuma = luma(toLinear(texture2D(uSource, uv).rgb));
        float weightedMask = 0.0;
        float totalWeight = 0.0;
        for (int y = -2; y <= 2; y++) {
          for (int x = -2; x <= 2; x++) {
            vec2 offset = vec2(float(x), float(y)) * uMaskTexel;
            vec2 sampleUv = clamp(uv + offset, vec2(0.0), vec2(1.0));
            float distanceWeight = exp(-float(x * x + y * y) * 0.25);
            float edgeWeight = exp(-abs(luma(toLinear(texture2D(uSource, sampleUv).rgb)) - centerLuma) * 18.0);
            float weight = distanceWeight * edgeWeight;
            weightedMask += texture2D(uMask, sampleUv).r * weight;
            totalWeight += weight;
          }
        }
        return weightedMask / max(totalWeight, 0.0001);
      }

      void main() {
        float mask = smoothstep(0.30, 0.72, refinedMask(vUv));
        if (mask < 0.01) discard;
        vec3 source = texture2D(uSource, vUv).rgb;
        vec3 sourceLinear = toLinear(source);
        vec3 targetLinear = toLinear(uTarget);
        float sourceLuma = luma(sourceLinear);
        float targetLuma = max(luma(targetLinear), 0.01);
        vec3 tinted = toSrgb(clamp(targetLinear * ((sourceLuma + 0.02) / (targetLuma + 0.02)), 0.0, 1.0));
        float highlightProtection = smoothstep(0.65, 0.98, sourceLuma);
        float visibleTexture = mix(0.55, 1.0, smoothstep(0.01, 0.12, sourceLuma));
        float strength = uStrength * 0.8 * visibleTexture * (1.0 - highlightProtection * 0.5);
        gl_FragColor = vec4(mix(source, tinted, strength), mask * 0.9);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
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
      material.uniforms.uMaskTexel.value.set(1 / data.width, 1 / data.height);
    }
    paintHairMask(data.mask, imageData.data);
    maskContext.putImageData(imageData, 0, 0);
    texture.needsUpdate = true;
    material.uniforms.uTarget.value.set(hair.current.color);
    material.uniforms.uStrength.value = hair.current.strength;
    if (!ready) {
      ready = true;
      callbacks.current.onHairReady(true);
    }
  };

  const draw = (now: number) => {
    if (cancelled()) return;
    if (plane.geometry !== engine.videoPlane.geometry) plane.geometry = engine.videoPlane.geometry;
    if (!busy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastRun >= HAIR_FRAME_INTERVAL_MS) {
      const scale = Math.min(1, HAIR_INPUT_SIZE / Math.max(video.videoWidth, video.videoHeight));
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
