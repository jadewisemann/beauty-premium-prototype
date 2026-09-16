import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { FaceSnapshot, FrameMeta, HairSnapshot, Mat3, PerceptionRole, WorkerRequest, WorkerResponse } from './contracts';
import { identityMat3 } from './transforms';

interface AssetManifest {
  schemaVersion: 1;
  wasm: { directory: string };
  models: Array<{
    id: 'face-landmarker' | 'hair-segmenter';
    localPath: string;
    output: string | { labels?: string[]; hairChannelIndex?: number };
  }>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  close(): void;
}

const scope = globalThis as unknown as WorkerScope;
let faceLandmarker: FaceLandmarker | null = null;
let hairSegmenter: ImageSegmenter | null = null;
let manifest: AssetManifest | null = null;
let role: PerceptionRole | null = null;
let currentGeneration = 0;
let mode: 'IMAGE' | 'VIDEO' = 'IMAGE';
const recycledBuffers: ArrayBuffer[] = [];
let filesetSequence = 0;

scope.onmessage = (event) => {
  void handle(event.data);
};

async function handle(message: WorkerRequest): Promise<void> {
  switch (message.type) {
    case 'INIT':
      await initialize(message.assetManifest, message.role);
      return;
    case 'SET_MODE':
      await setMode(message.mode, message.generation, message.requestId);
      return;
    case 'FRAME':
      runFrame(message);
      return;
    case 'RECYCLE_BUFFER':
      if (message.buffer.byteLength) recycledBuffers.push(message.buffer);
      return;
    case 'DISPOSE':
      dispose();
      scope.close();
  }
}

async function initialize(manifestUrl: string, nextRole: PerceptionRole): Promise<void> {
  const startedAt = performance.now();
  try {
    role = nextRole;
    const response = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Asset manifest ${response.status}`);
    manifest = await response.json() as AssetManifest;
    if (manifest.schemaVersion !== 1) throw new Error('Unsupported asset manifest schema');
    await createTask('GPU').catch(async () => {
      disposeTask();
      await createTask('CPU');
    });
    post({ type: 'READY' });
  } catch (error) {
    postError('MODEL_INIT_FAILED', error, 0);
  } finally {
    void startedAt;
  }
}

async function createTask(delegate: 'GPU' | 'CPU'): Promise<void> {
  if (!manifest || !role) throw new Error('Worker configuration missing');
  const modelId = role === 'face' ? 'face-landmarker' : 'hair-segmenter';
  const model = manifest.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Required ${role} model missing from manifest`);
  const fileset = await workerFileset(manifest.wasm.directory, role);
  const canvas = delegate === 'GPU' && 'OffscreenCanvas' in globalThis ? new OffscreenCanvas(1, 1) : undefined;
  if (delegate === 'GPU' && !canvas) throw new Error('OffscreenCanvas unavailable');
  if (role === 'face') {
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model.localPath, delegate },
      runningMode: mode,
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      ...(canvas ? { canvas } : {}),
    });
    return;
  }
  hairSegmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model.localPath, delegate },
    runningMode: mode,
    outputConfidenceMasks: true,
    outputCategoryMask: false,
    ...(canvas ? { canvas } : {}),
  });
  resolveHairChannel();
}

async function workerFileset(directory: string, task: string) {
  const fileset = await FilesetResolver.forVisionTasks(directory, true);
  const separator = fileset.wasmLoaderPath.includes('?') ? '&' : '?';
  return { ...fileset, wasmLoaderPath: `${fileset.wasmLoaderPath}${separator}task=${task}-${++filesetSequence}` };
}

async function setMode(nextMode: 'IMAGE' | 'VIDEO', generation: number, requestId: number): Promise<void> {
  currentGeneration = generation;
  try {
    if (!role || (role === 'face' ? !faceLandmarker : !hairSegmenter)) throw new Error('Model is not initialized');
    if (mode !== nextMode) {
      if (role === 'face') await faceLandmarker?.setOptions({ runningMode: nextMode });
      else await hairSegmenter?.setOptions({ runningMode: nextMode });
      mode = nextMode;
    }
    post({ type: 'MODE_READY', requestId, generation });
  } catch (error) {
    postError('MODEL_MODE_FAILED', error, generation);
  }
}

function runFrame(message: Extract<WorkerRequest, { type: 'FRAME' }>): void {
  const { bitmap, meta } = message;
  try {
    if (!role) throw new Error('Worker role is not initialized');
    if (meta.generation !== currentGeneration) return;
    if (role === 'face') runFace(bitmap, meta);
    else runHair(bitmap, meta, message.poseAtSource ?? null);
  } catch (error) {
    postError('MODEL_INFERENCE_FAILED', error, meta.generation, meta.frameId);
  } finally {
    bitmap.close();
    post({ type: 'FRAME_DONE', frame: meta });
  }
}

function runFace(bitmap: ImageBitmap, frame: FrameMeta): void {
  if (!faceLandmarker) throw new Error('Face landmarker is not initialized');
  const result = mode === 'VIDEO'
    ? faceLandmarker.detectForVideo(bitmap, frame.taskTimestampMs)
    : faceLandmarker.detect(bitmap);
  const snapshot = toFaceSnapshot(result.faceLandmarks[0], frame);
  post({ type: 'FACE_RESULT', result: snapshot, frame }, snapshot ? [snapshot.landmarks.buffer] : []);
}

function runHair(bitmap: ImageBitmap, frame: FrameMeta, poseAtSource: Mat3 | null): void {
  if (!hairSegmenter) throw new Error('Hair segmenter is not initialized');
  const inferenceStarted = performance.now();
  const callback = (result: ReturnType<ImageSegmenter['segment']>) => {
    const copyStarted = performance.now();
    try {
      const channel = resolveHairChannel();
      const mask = result.confidenceMasks?.[channel];
      if (!mask) throw new Error(`Hair confidence channel ${channel} missing`);
      const source = mask.getAsFloat32Array();
      if (source.length !== mask.width * mask.height) throw new Error('Unexpected hair mask dimensions');
      const values = acquireBuffer(source.length);
      for (let index = 0; index < source.length; index += 1) {
        const value = source[index];
        if (!Number.isFinite(value)) throw new Error('Hair mask contains a non-finite value');
        values[index] = Math.round(Math.min(1, Math.max(0, value)) * 255);
      }
      const snapshot: HairSnapshot = {
        frame,
        width: mask.width,
        height: mask.height,
        sourceToMask: identityMat3(),
        meaning: 'confidence',
        values,
        poseAtSource,
        inferenceMs: copyStarted - inferenceStarted,
        readbackAndCopyMs: performance.now() - copyStarted,
      };
      post({ type: 'HAIR_RESULT', result: snapshot }, [values.buffer]);
    } finally {
      result.close();
    }
  };
  if (mode === 'VIDEO') hairSegmenter.segmentForVideo(bitmap, frame.taskTimestampMs, callback);
  else hairSegmenter.segment(bitmap, callback);
}

function resolveHairChannel(): number {
  if (!hairSegmenter || !manifest) throw new Error('Hair metadata unavailable');
  const labels = hairSegmenter.getLabels().map((label) => label.toLowerCase());
  const labelledIndex = labels.indexOf('hair');
  if (labelledIndex >= 0) return labelledIndex;
  const output = manifest.models.find((model) => model.id === 'hair-segmenter')?.output;
  if (typeof output !== 'object' || output.labels?.[output.hairChannelIndex ?? -1] !== 'hair') {
    throw new Error('Hair channel cannot be verified');
  }
  return output.hairChannelIndex as number;
}

function toFaceSnapshot(
  landmarks: Array<{ x: number; y: number; z: number }> | undefined,
  frame: FrameMeta,
): FaceSnapshot | null {
  if (!landmarks?.length) return null;
  const values = new Float32Array(landmarks.length * 3);
  landmarks.forEach((landmark, index) => {
    values[index * 3] = landmark.x;
    values[index * 3 + 1] = landmark.y;
    values[index * 3 + 2] = landmark.z;
  });
  const { matrix, residual } = fitFaceFrame(landmarks);
  return { frame, landmarks: values, sourceToFace: matrix, fitResidual: residual };
}

function fitFaceFrame(landmarks: Array<{ x: number; y: number }>): { matrix: Mat3; residual: number } {
  const a = landmarks[33];
  const b = landmarks[263];
  const nose = landmarks[1];
  if (!a || !b || !nose) return { matrix: identityMat3(), residual: Number.POSITIVE_INFINITY };
  const centerX = (a.x + b.x) / 2;
  const centerY = (a.y + b.y) / 2;
  const axisX = b.x - a.x;
  const axisY = b.y - a.y;
  const lengthSquared = axisX * axisX + axisY * axisY;
  if (lengthSquared < 1e-8) return { matrix: identityMat3(), residual: Number.POSITIVE_INFINITY };
  const matrix: Mat3 = [
    axisX / lengthSquared, axisY / lengthSquared, -(axisX * centerX + axisY * centerY) / lengthSquared,
    -axisY / lengthSquared, axisX / lengthSquared, (axisY * centerX - axisX * centerY) / lengthSquared,
    0, 0, 1,
  ];
  const noseLocalX = matrix[0] * nose.x + matrix[1] * nose.y + matrix[2];
  return { matrix, residual: Math.abs(noseLocalX) };
}

function acquireBuffer(length: number): Uint8Array {
  const reusableIndex = recycledBuffers.findIndex((buffer) => buffer.byteLength === length);
  if (reusableIndex < 0) return new Uint8Array(length);
  return new Uint8Array(recycledBuffers.splice(reusableIndex, 1)[0]);
}

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function postError(code: string, error: unknown, generation: number, frameId?: number): void {
  post({
    type: 'ERROR',
    code,
    message: error instanceof Error ? error.message : String(error),
    generation,
    ...(frameId === undefined ? {} : { frameId }),
  });
}

function disposeTask(): void {
  faceLandmarker?.close();
  hairSegmenter?.close();
  faceLandmarker = null;
  hairSegmenter = null;
}

function dispose(): void {
  disposeTask();
  recycledBuffers.length = 0;
}
