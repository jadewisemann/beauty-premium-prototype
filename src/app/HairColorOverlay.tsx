import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { tintHairMask } from './hair-color';

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  color: string;
  strength: number;
  onReady(ready: boolean): void;
  onError(message: string): void;
}

export function HairColorOverlay({ videoRef, enabled, color, strength, onReady, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef({ enabled, color, strength });
  const callbacksRef = useRef({ onReady, onError });
  settingsRef.current = { enabled, color, strength };
  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    const video = videoRef.current;
    const output = canvasRef.current;
    if (!video || !output) return;
    const input = document.createElement('canvas');
    const inputContext = input.getContext('2d');
    const outputContext = output.getContext('2d');
    if (!inputContext || !outputContext) return;
    let segmenter: ImageSegmenter | null = null;
    let frame = 0;
    let cancelled = false;
    let busy = false;
    let lastRun = 0;
    let imageData: ImageData | null = null;

    void (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe', true);
        const options = {
          baseOptions: { modelAssetPath: '/models/hair_segmenter.tflite', delegate: 'GPU' as const },
          runningMode: 'VIDEO' as const,
          outputConfidenceMasks: true,
          outputCategoryMask: false,
          canvas: document.createElement('canvas'),
        };
        segmenter = await ImageSegmenter.createFromOptions(fileset, options).catch(() => ImageSegmenter.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
        }));
        if (cancelled) return segmenter.close();
        callbacksRef.current.onReady(true);

        const draw = () => {
          if (cancelled) return;
          const now = performance.now();
          if (!busy && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastRun >= 100) {
            const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
            input.width = Math.max(1, Math.round(video.videoWidth * scale));
            input.height = Math.max(1, Math.round(video.videoHeight * scale));
            inputContext.drawImage(video, 0, 0, input.width, input.height);
            busy = true;
            lastRun = now;
            segmenter?.segmentForVideo(input, Math.ceil(now), (result) => {
              try {
                const channel = Math.max(0, segmenter?.getLabels().findIndex((label) => label.toLowerCase() === 'hair') ?? 0);
                const mask = result.confidenceMasks?.[channel];
                if (!mask) return;
                if (output.width !== mask.width || output.height !== mask.height) {
                  output.width = mask.width;
                  output.height = mask.height;
                  imageData = outputContext.createImageData(mask.width, mask.height);
                }
                if (!imageData) return;
                const settings = settingsRef.current;
                if (settings.enabled) {
                  tintHairMask(mask.getAsFloat32Array(), imageData.data, settings.color, settings.strength);
                  outputContext.putImageData(imageData, 0, 0);
                } else {
                  outputContext.clearRect(0, 0, output.width, output.height);
                }
              } finally {
                result.close();
                busy = false;
              }
            });
          }
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
      } catch (error) {
        if (!cancelled) callbacksRef.current.onError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      callbacksRef.current.onReady(false);
      segmenter?.close();
    };
  }, [videoRef]);

  return <canvas ref={canvasRef} className="hair-canvas mirrored" aria-label="헤어 컬러 미리보기" />;
}
