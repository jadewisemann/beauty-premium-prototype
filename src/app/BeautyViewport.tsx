import { forwardRef, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { initialEngineConfig } from '../engine/config';
import type { BeautyController } from '../engine/controller';
import type { LookRecipe } from '../engine/contracts';
import { blushEllipses, drawLipMask } from '../engine/masks';
import { BeautyRenderer, type RenderView, type RendererMetrics } from '../engine/renderer';
import { freshnessAtAge } from '../engine/temporal';

interface Props {
  controller: BeautyController;
  videoRef: RefObject<HTMLVideoElement | null>;
  recipe: LookRecipe;
  view: RenderView;
  splitCompare?: boolean;
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
  resolutionScale = 1,
  onRendererError,
  onRendererRecovered,
  onMetrics,
}, forwardedRef) {
  const localCanvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ recipe, view, splitCompare, resolutionScale, onRendererError, onRendererRecovered, onMetrics });
  propsRef.current = { recipe, view, splitCompare, resolutionScale, onRendererError, onRendererRecovered, onMetrics };

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
    let lastFace: unknown = null;
    let lastBlushSize = Number.NaN;
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
        lastBlushSize = Number.NaN;
      }
      const snapshot = controller.getSnapshot();
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
            const mask = createLipMask(snapshot.face.landmarks);
            renderer.uploadLipMask(mask, mask.width, mask.height);
            blush = rendererBlush(snapshot.face.landmarks, propsRef.current.recipe.blush.size);
          } else {
            renderer.uploadLipMask(null);
            blush = null;
          }
          lastFace = snapshot.face;
        }
        if (snapshot.face && lastBlushSize !== propsRef.current.recipe.blush.size) {
          blush = rendererBlush(snapshot.face.landmarks, propsRef.current.recipe.blush.size);
          lastBlushSize = propsRef.current.recipe.blush.size;
        }
        const now = performance.now();
        const faceAge = snapshot.face ? now - snapshot.face.frame.acquiredMs : Number.POSITIVE_INFINITY;
        const hairAge = snapshot.hair ? now - snapshot.hair.frame.acquiredMs : Number.POSITIVE_INFINITY;
        const photo = snapshot.sourceKind === 'photo';
        const metrics = renderer.render({
          view: propsRef.current.view,
          mirror: snapshot.sourceKind === 'camera',
          recipe: propsRef.current.recipe,
          hairFreshness: photo ? (snapshot.hair ? 1 : 0) : freshnessAtAge(hairAge, initialEngineConfig.hairFadeStartMs, initialEngineConfig.hairExpireMs),
          faceFreshness: photo ? (snapshot.face ? 1 : 0) : freshnessAtAge(faceAge, initialEngineConfig.faceFadeStartMs, initialEngineConfig.faceExpireMs),
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

function rendererBlush(landmarks: Float32Array, size: number) {
  const [left, right] = blushEllipses(landmarks, size);
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
