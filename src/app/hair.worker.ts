import { DrawingUtils, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const scope = self as unknown as Worker;
const canvas = new OffscreenCanvas(512, 512);
// Absolute URLs keep Vite from treating the static WASM loader as a source import.
const wasmBaseUrl = new URL('/vendor/mediapipe', self.location.origin).href;
const segmenterPromise = FilesetResolver.forVisionTasks(wasmBaseUrl, true).then(async (fileset) => {
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/hair_segmenter.tflite', delegate: 'GPU' },
    canvas,
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  const hairIndex = Math.max(0, segmenter.getLabels().findIndex((label) => label.toLowerCase() === 'hair'));
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('헤어 GPU WebGL2를 사용할 수 없습니다.');
  return { segmenter, hairIndex, drawing: new DrawingUtils(gl) };
});
// Report initialization failures even before a video frame is submitted.
void segmenterPromise.catch(error => scope.postMessage({ type: 'error', message: String(error) }));

scope.onmessage = async ({ data }: MessageEvent<{ bitmap: ImageBitmap; timestamp: number }>) => {
  try {
    const { segmenter, hairIndex, drawing } = await segmenterPromise;
    segmenter.segmentForVideo(data.bitmap, data.timestamp, result => {
      const mask = result.confidenceMasks?.[hairIndex];
      if (!mask) throw new Error('hair mask가 없습니다.');
      drawing.drawConfidenceMask(mask, [0, 0, 0, 255], [255, 255, 255, 255]);
      const bitmap = canvas.transferToImageBitmap();
      scope.postMessage({ type: 'mask', bitmap }, [bitmap]);
    });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    data.bitmap.close();
  }
};
