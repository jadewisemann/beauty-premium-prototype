import { forwardRef, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { initialEngineConfig } from '../engine/config';
import type { BeautyController } from '../engine/controller';
import type { FaceSnapshot, LookRecipe } from '../engine/contracts';
import { blushEllipses, drawEyeMakeupMask, drawLipMask } from '../engine/masks';
import { BeautyRenderer, type RenderView, type RendererMetrics } from '../engine/renderer';
import { freshnessAtAge } from '../engine/temporal';
import { predictSimilarityTransform } from '../engine/transforms';

interface Props {
  controller: BeautyController;
  videoRef: RefObject<HTMLVideoElement | null>;
  recipe: LookRecipe;
  view: RenderView;
  splitCompare?: boolean;
  makeupEnabled?: boolean;
  resolutionScale?: number;
  onRendererError?: (message: string) => void;
  onRendererRecovered?: () => void;
  onMetrics?: (metrics: RendererMetrics) => void;
}

export const BeautyViewport = forwardRef<HTMLCanvasElement, Props>(function BeautyViewport({
  controller,
  videoRef,
  recipe,
  view,
  splitCompare = false,
  makeupEnabled = true,
  resolutionScale = 1,
  onRendererError,
  onRendererRecovered,
  onMetrics,
}, forwardedRef) {
  const localCanvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ recipe, view, splitCompare, makeupEnabled, resolutionScale, onRendererError, onRendererRecovered, onMetrics });
  propsRef.current = { recipe, view, splitCompare, makeupEnabled, resolutionScale, onRendererError, onRendererRecovered, onMetrics };

  useEffect(() => {
    const canvas = localCanvasRef.current;
    if (!canvas) return;
    const targetCanvas = canvas;
    if (typeof forwardedRef === 'function') forwardedRef(canvas);
    else if (forwardedRef) forwardedRef.current = canvas;
    let frame = 0;
    let renderer: BeautyRenderer;
    let recreateRenderer = false;
    let lastPhoto: ImageBitmap | null = null;
    let lastVideoGeneration = -1;
    let lastVideoTime = Number.NaN;
    let resizedPhoto: ImageBitmap | null = null;
    let resizedPhotoSource: ImageBitmap | null = null;
    let resizedPhotoSize = '';
    let resizePending = '';
    let lastHair: unknown = null;
    let lastFace: FaceSnapshot | null = null;
    let trackedFace: FaceSnapshot | null = null;
    let previousTrackedFace: FaceSnapshot | null = null;
    let trackingGeneration = -1;
    let lastBlushSize: number | string = Number.NaN;
    let blush: ReturnType<typeof rendererBlush> | null = null;
    let lastMetricsAt = 0;
    try {
      renderer = createRenderer();
    } catch (error) {
      propsRef.current.onRendererError?.(error instanceof Error ? error.message : String(error));
      return;
    }

    const draw = () => {
      if (recreateRenderer) {
        renderer.dispose();
        renderer = createRenderer();
        recreateRenderer = false;
        lastPhoto = null;
        lastHair = null;
        lastFace = null;
        trackedFace = null;
        previousTrackedFace = null;
        trackingGeneration = -1;
        lastBlushSize = Number.NaN;
      }
      const snapshot = controller.getSnapshot();
      if (snapshot.generation !== trackingGeneration) {
        trackedFace = null;
        previousTrackedFace = null;
        renderer.uploadLipMask(null);
        renderer.uploadEyeMask(null);
        blush = null;
        trackingGeneration = snapshot.generation;
      }
      const video = videoRef.current;
      const source = snapshot.sourceKind === 'photo' ? snapshot.photoBitmap : video;
      const width = snapshot.sourceKind === 'photo' ? snapshot.photoBitmap?.width : video?.videoWidth;
      const height = snapshot.sourceKind === 'photo' ? snapshot.photoBitmap?.height : video?.videoHeight;
      if (source && width && height && (snapshot.sourceKind === 'photo' || (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA))) {
        if (snapshot.sourceKind !== 'photo' && video) {
          if (snapshot.generation === lastVideoGeneration && video.currentTime === lastVideoTime) {
            frame = requestAnimationFrame(draw);
            return;
          }
          lastVideoGeneration = snapshot.generation;
          lastVideoTime = video.currentTime;
        }
        const limit = snapshot.sourceKind === 'photo' ? initialEngineConfig.exportLongEdgeMax : initialEngineConfig.liveLongEdge;
        const scale = Math.min(1, limit / Math.max(width, height)) * propsRef.current.resolutionScale;
        const renderWidth = Math.max(1, Math.round(width * scale));
        const renderHeight = Math.max(1, Math.round(height * scale));
        if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
          canvas.width = renderWidth;
          canvas.height = renderHeight;
          lastPhoto = null;
        }
        let sourceReady = true;
        if (snapshot.sourceKind === 'photo' && snapshot.photoBitmap) {
          const sizeKey = `${snapshot.generation}:${renderWidth}x${renderHeight}`;
          if (resizedPhotoSource !== snapshot.photoBitmap || resizedPhotoSize !== sizeKey) {
            sourceReady = false;
            if (resizePending !== sizeKey) {
              resizePending = sizeKey;
              const expectedSource = snapshot.photoBitmap;
              void createImageBitmap(expectedSource, { resizeWidth: renderWidth, resizeHeight: renderHeight, resizeQuality: 'high' })
                .then((bitmap) => {
                  if (controller.getSnapshot().photoBitmap !== expectedSource || resizePending !== sizeKey) {
                    bitmap.close();
                    return;
                  }
                  resizedPhoto?.close();
                  resizedPhoto = bitmap;
                  resizedPhotoSource = expectedSource;
                  resizedPhotoSize = sizeKey;
                  resizePending = '';
                  lastPhoto = null;
                })
                .catch((error) => {
                  resizePending = '';
                  propsRef.current.onRendererError?.(error instanceof Error ? error.message : String(error));
                });
            }
          } else if (resizedPhoto && lastPhoto !== snapshot.photoBitmap) {
            renderer.uploadSource(resizedPhoto, renderWidth, renderHeight);
            lastPhoto = snapshot.photoBitmap;
          }
          sourceReady = Boolean(resizedPhoto && resizedPhotoSource === snapshot.photoBitmap && resizedPhotoSize === sizeKey);
        } else {
          renderer.uploadSource(source, width, height);
          lastPhoto = null;
        }
        if (!sourceReady) {
          frame = requestAnimationFrame(draw);
          return;
        }
        if (lastHair !== snapshot.hair) {
          renderer.uploadHair(snapshot.hair);
          lastHair = snapshot.hair;
        }
        if (lastFace !== snapshot.face) {
          if (snapshot.face) {
            previousTrackedFace = trackedFace?.frame.generation === snapshot.face.frame.generation ? trackedFace : null;
            trackedFace = snapshot.face;
            const mask = createLipMask(snapshot.face.landmarks);
            renderer.uploadLipMask(mask, mask.width, mask.height);
            const eyeMask = createEyeMask(snapshot.face.landmarks);
            renderer.uploadEyeMask(eyeMask, eyeMask.width, eyeMask.height);
            blush = rendererBlush(snapshot.face.landmarks, propsRef.current.recipe.blush.size, propsRef.current.recipe.blush.placement);
          } else if (snapshot.sourceKind === 'photo') {
            renderer.uploadLipMask(null);
            renderer.uploadEyeMask(null);
            blush = null;
          }
          lastFace = snapshot.face;
        }
        const blushKey = `${propsRef.current.recipe.blush.size}:${propsRef.current.recipe.blush.placement}`;
        const blushFace = snapshot.sourceKind === 'photo' ? snapshot.face : trackedFace;
        if (blushFace && lastBlushSize !== blushKey) {
          blush = rendererBlush(blushFace.landmarks, propsRef.current.recipe.blush.size, propsRef.current.recipe.blush.placement);
          lastBlushSize = blushKey;
        }
        const now = performance.now();
        const trackedFaceAge = trackedFace ? now - trackedFace.frame.acquiredMs : Number.POSITIVE_INFINITY;
        const hairAge = snapshot.hair ? now - snapshot.hair.frame.acquiredMs : Number.POSITIVE_INFINITY;
        const photo = snapshot.sourceKind === 'photo';
        const trackingFreshness = photo
          ? (trackedFace ? 1 : 0)
          : freshnessAtAge(trackedFaceAge, initialEngineConfig.faceFadeStartMs, initialEngineConfig.faceExpireMs);
        const currentFacePose = trackedFace && Number.isFinite(trackedFace.fitResidual)
          ? (!photo
              && previousTrackedFace
              && previousTrackedFace.frame.generation === trackedFace.frame.generation
              && Number.isFinite(previousTrackedFace.fitResidual)
            ? predictSimilarityTransform(
                previousTrackedFace.sourceToFace,
                trackedFace.sourceToFace,
                previousTrackedFace.frame.acquiredMs,
                trackedFace.frame.acquiredMs,
                now,
                1000 / initialEngineConfig.faceMaxHz,
              )
            : trackedFace.sourceToFace)
          : null;
        const facePoseAtSource = trackedFace && Number.isFinite(trackedFace.fitResidual)
          ? trackedFace.sourceToFace
          : null;
        const overlayOnly = !photo;
        canvas.style.opacity = overlayOnly && propsRef.current.view === 'original' ? '0' : '1';
        const metrics = renderer.render({
          view: propsRef.current.view,
          mirror: snapshot.sourceKind === 'camera',
          overlayOnly,
          recipe: propsRef.current.recipe,
          makeupEnabled: propsRef.current.makeupEnabled,
          hairFreshness: photo
            ? (snapshot.hair ? 1 : 0)
            : freshnessAtAge(hairAge, initialEngineConfig.hairFadeStartMs, initialEngineConfig.hairExpireMs) * trackingFreshness,
          faceFreshness: trackingFreshness,
          currentFacePose,
          facePoseAtSource,
          hairPoseAtSource: snapshot.hair?.poseAtSource ?? null,
          blush,
          splitCompare: propsRef.current.splitCompare,
        });
        if (now - lastMetricsAt > 500) {
          propsRef.current.onMetrics?.(metrics);
          lastMetricsAt = now;
        }
      }
      frame = requestAnimationFrame(draw);
    };

    function createRenderer(): BeautyRenderer {
      return new BeautyRenderer(
        targetCanvas,
        () => {
          recreateRenderer = true;
          propsRef.current.onRendererRecovered?.();
          void controller.recoverRenderer();
        },
        () => propsRef.current.onRendererError?.('WebGL 컨텍스트가 손실되었습니다. 복구를 기다리는 중입니다.'),
      );
    }
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
      resizedPhoto?.close();
      if (typeof forwardedRef !== 'function' && forwardedRef) forwardedRef.current = null;
    };
  }, [controller, forwardedRef, videoRef]);

  return <canvas ref={localCanvasRef} className="beauty-canvas" aria-label="뷰티 효과 미리보기" />;
});

function createLipMask(landmarks: Float32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#fff';
  context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  drawLipMask(context, landmarks);
  context.resetTransform();
  return canvas;
}

function createEyeMask(landmarks: Float32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  drawEyeMakeupMask(context, landmarks);
  context.resetTransform();
  return canvas;
}

function rendererBlush(landmarks: Float32Array, size: number, placement: LookRecipe['blush']['placement']) {
  const [left, right] = blushEllipses(landmarks, size, placement);
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
