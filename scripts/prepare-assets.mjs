import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const wasmSource = join(packageRoot, 'wasm');
const wasmDestination = join(root, 'public', 'vendor', 'mediapipe');
const modelsDirectory = join(root, 'public', 'models');
const manifestPath = join(modelsDirectory, 'models.manifest.json');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

if (packageJson.version !== '1.0.1') throw new Error(`Expected @mediapipe/tasks-vision 1.0.1, found ${packageJson.version}`);

const models = [
  {
    id: 'face-landmarker',
    filename: 'face_landmarker.task',
    sourceUrl: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    input: 'Image or video frame.',
    output: 'Face landmarks; blendshapes and facial transformation matrices when enabled.',
    license: {
      spdx: 'Apache-2.0',
      licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
      modelCards: [
        { component: 'BlazeFace short-range', url: 'https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf' },
        { component: 'FaceMesh V2', url: 'https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf' },
        { component: 'Blendshape V2', url: 'https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf' },
      ],
      redistributionNotice: 'The FaceLandmarker bundle contains the listed component models. When distributing this bundled asset, retain applicable Apache-2.0 license and notice information.',
    },
  },
  {
    id: 'hair-segmenter',
    filename: 'hair_segmenter.tflite',
    sourceUrl: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite',
    input: 'Image.',
    output: { type: 'confidence-mask', labels: ['background', 'hair'], hairChannelIndex: 1 },
    license: {
      spdx: 'Apache-2.0',
      licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
      modelCards: [
        { component: 'Hair Segmenter', url: 'https://storage.googleapis.com/mediapipe-assets/Model%20Card%20-%20Hair%20Segmentation.pdf' },
      ],
      redistributionNotice: 'When distributing this bundled asset, retain applicable Apache-2.0 license and notice information.',
    },
  },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Download was empty: ${url}`);
  const temporaryPath = `${destination}.download`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, destination);
  return bytes;
}

await mkdir(wasmDestination, { recursive: true });
await cp(wasmSource, wasmDestination, { recursive: true, force: true });
await mkdir(modelsDirectory, { recursive: true });

const manifestModels = [];
for (const model of models) {
  const path = join(modelsDirectory, model.filename);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = await download(model.sourceUrl, path);
  }
  manifestModels.push({
    id: model.id,
    localPath: `/models/${model.filename}`,
    sourceUrl: model.sourceUrl,
    bytes: (await stat(path)).size,
    sha256: sha256(bytes),
    input: model.input,
    output: model.output,
    license: model.license,
  });
}

await writeFile(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  package: { name: packageJson.name, version: packageJson.version },
  wasm: { directory: '/vendor/mediapipe', files: (await readdir(wasmSource)).sort() },
  models: manifestModels,
}, null, 2)}\n`);
console.log(`Prepared ${manifestModels.length} models and MediaPipe ${packageJson.version} WASM assets.`);
