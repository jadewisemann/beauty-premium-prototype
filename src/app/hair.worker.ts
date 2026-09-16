import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const scope = self as unknown as Worker;
const segmenterPromise = FilesetResolver.forVisionTasks('/vendor/mediapipe', true).then(async (fileset) => {
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/hair_segmenter.tflite', delegate: 'CPU' },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  const hairIndex = Math.max(0, segmenter.getLabels().findIndex((label) => label.toLowerCase() === 'hair'));
  return { segmenter, hairIndex };
});

scope.onmessage = async ({ data }: MessageEvent<{ bitmap: ImageBitmap; timestamp: number }>) => {
  try {
    const { segmenter, hairIndex } = await segmenterPromise;
    const result = segmenter.segmentForVideo(data.bitmap, data.timestamp);
    try {
      const mask = result.confidenceMasks?.[hairIndex];
      if (!mask) throw new Error('hair mask가 없습니다.');
      const pixels = new Float32Array(mask.getAsFloat32Array());
      scope.postMessage({ type: 'mask', width: mask.width, height: mask.height, mask: pixels }, [pixels.buffer]);
    } finally {
      result.close();
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    data.bitmap.close();
  }
};
