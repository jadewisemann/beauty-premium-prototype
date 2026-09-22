import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { initialEngineConfig } from '../engine/config';
import type { BeautyController } from '../engine/controller';
import type { FaceSnapshot } from '../engine/contracts';
import { blushEllipses, drawEyeMakeupMask, drawLipMask } from '../engine/masks';
import { BeautyRenderer } from '../engine/renderer';
import { freshnessAtAge } from '../engine/temporal';
import { predictSimilarityTransform } from '../engine/transforms';
import { toLookRecipe, type MakeupState } from './open-makeup';

export function MakeupViewport({ controller, videoRef, makeup, hair, onReady, onHairReady, onError }: {
  controller: BeautyController;
  videoRef: RefObject<HTMLVideoElement | null>;
  makeup: MakeupState;
  hair: { color: string; strength: number };
  onReady(ready: boolean): void;
  onHairReady(ready: boolean): void;
  onError(message: string): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ makeup, hair, onError });
  propsRef.current = { makeup, hair, onError };

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    let frame = 0;
    let lastVideoTime = Number.NaN;
    let lastHair: unknown = null;
    let lastFace: FaceSnapshot | null = null;
    let trackedFace: FaceSnapshot | null = null;
    let previousTrackedFace: FaceSnapshot | null = null;
    let blush: ReturnType<typeof faceGeometry> | null = null;
    let renderer: BeautyRenderer;

    try {
      renderer = new BeautyRenderer(canvas, undefined, () => propsRef.current.onError('WebGL 컨텍스트가 손실되었습니다.'));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return;
    }

    const foundationMask = new Image();
    foundationMask.onload = () => renderer.uploadFoundationMask(foundationMask, foundationMask.naturalWidth, foundationMask.naturalHeight);
    foundationMask.onerror = () => propsRef.current.onError('파운데이션 마스크를 불러오지 못했습니다.');
    foundationMask.src = '/makeup/foundation-mask.png';
    onReady(true);
    onHairReady(true);

    const draw = () => {
      const snapshot = controller.getSnapshot();
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        const scale = Math.min(1, initialEngineConfig.liveLongEdge / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        if (video.currentTime !== lastVideoTime) {
          renderer.uploadSource(video, video.videoWidth, video.videoHeight);
          lastVideoTime = video.currentTime;
        }
        if (lastHair !== snapshot.hair) {
          renderer.uploadHair(snapshot.hair);
          lastHair = snapshot.hair;
        }
        if (lastFace !== snapshot.face && snapshot.face) {
          previousTrackedFace = trackedFace?.frame.generation === snapshot.face.frame.generation ? trackedFace : null;
          trackedFace = snapshot.face;
          const lip = createLipMask(snapshot.face.landmarks);
          const eye = createEyeMask(snapshot.face.landmarks);
          renderer.uploadLipMask(lip, lip.width, lip.height);
          renderer.uploadEyeMask(eye, eye.width, eye.height);
          blush = faceGeometry(snapshot.face.landmarks);
          lastFace = snapshot.face;
        }

        const now = performance.now();
        const faceFreshness = trackedFace
          ? freshnessAtAge(now - trackedFace.frame.acquiredMs, initialEngineConfig.faceFadeStartMs, initialEngineConfig.faceExpireMs)
          : 0;
        const hairFreshness = snapshot.hair
          ? freshnessAtAge(now - snapshot.hair.frame.acquiredMs, initialEngineConfig.hairFadeStartMs, initialEngineConfig.hairExpireMs) * faceFreshness
          : 0;
        const currentFacePose = trackedFace && Number.isFinite(trackedFace.fitResidual)
          ? previousTrackedFace && previousTrackedFace.frame.generation === trackedFace.frame.generation
            ? predictSimilarityTransform(
                previousTrackedFace.sourceToFace,
                trackedFace.sourceToFace,
                previousTrackedFace.frame.acquiredMs,
                trackedFace.frame.acquiredMs,
                now,
                1000 / initialEngineConfig.faceMaxHz,
              )
            : trackedFace.sourceToFace
          : null;

        renderer.render({
          view: 'final',
          mirror: false,
          overlayOnly: true,
          recipe: toLookRecipe(propsRef.current.makeup, propsRef.current.hair),
          hairFreshness,
          faceFreshness,
          currentFacePose,
          facePoseAtSource: trackedFace?.sourceToFace ?? null,
          hairPoseAtSource: snapshot.hair?.poseAtSource ?? null,
          blush,
        });
      }
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      foundationMask.src = '';
      renderer.dispose();
      onReady(false);
      onHairReady(false);
    };
  }, [controller, onError, onHairReady, onReady, videoRef]);

  return <canvas ref={canvasRef} className="makeup-canvas" aria-label="메이크업 미리보기" />;
}

function createLipMask(landmarks: Float32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.fillStyle = '#fff';
  context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  drawLipMask(context, landmarks);
  return canvas;
}

function createEyeMask(landmarks: Float32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  drawEyeMakeupMask(context, landmarks);
  return canvas;
}

function faceGeometry(landmarks: Float32Array) {
  const [left, right] = blushEllipses(landmarks, 0.65, 'apple');
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (let index = 0; index < landmarks.length; index += 3) {
    const x = landmarks[index];
    const y = landmarks[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return {
    left: { centerX: left.center.x, centerY: left.center.y, radiusX: left.radiusX, radiusY: left.radiusY },
    right: { centerX: right.center.x, centerY: right.center.y, radiusX: right.radiusX, radiusY: right.radiusY },
    angle: (left.rotation + right.rotation) / 2,
    face: {
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      radiusX: Math.max(0.01, (maxX - minX) * 0.52),
      radiusY: Math.max(0.01, (maxY - minY) * 0.55),
    },
  };
}
