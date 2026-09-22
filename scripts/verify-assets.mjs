import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const sourceWasmDirectory = join(packageRoot, 'wasm');
const copiedWasmDirectory = join(root, 'public', 'vendor', 'mediapipe');
const manifestPath = join(root, 'public', 'models', 'models.manifest.json');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const requiredModels = new Map([
  ['face-landmarker', {
    localPath: '/models/face_landmarker.task',
    sourceUrl: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    modelCards: [
      'https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf',
      'https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf',
      'https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf',
    ],
  }],
  ['hair-segmenter', {
    localPath: '/models/hair_segmenter.tflite',
    sourceUrl: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite',
    modelCards: ['https://storage.googleapis.com/mediapipe-assets/Model%20Card%20-%20Hair%20Segmentation.pdf'],
  }],
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };
const apacheLicenseUrl = 'https://www.apache.org/licenses/LICENSE-2.0';

if (packageJson.version !== '1.0.1') fail(`Expected @mediapipe/tasks-vision 1.0.1, found ${packageJson.version}`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.package?.name !== packageJson.name || manifest.package?.version !== packageJson.version) fail('Manifest MediaPipe package mismatch');
if (!Array.isArray(manifest.models) || manifest.models.length !== requiredModels.size) fail('Manifest model list mismatch');

for (const model of manifest.models) {
  const required = requiredModels.get(model.id);
  if (!required || model.localPath !== required.localPath || model.sourceUrl !== required.sourceUrl) fail(`Unexpected model entry: ${model.id}`);
  if (!Number.isSafeInteger(model.bytes) || !/^[a-f0-9]{64}$/.test(model.sha256)) fail(`Invalid integrity metadata: ${model.id}`);
  if (!model.input || !model.output) fail(`Invalid model notes: ${model.id}`);
  if (model.license?.spdx !== 'Apache-2.0' || model.license?.licenseUrl !== apacheLicenseUrl || !Array.isArray(model.license?.modelCards) || model.license.modelCards.map(({ url }) => url).join('\0') !== required.modelCards.join('\0') || typeof model.license?.redistributionNotice !== 'string' || !model.license.redistributionNotice.includes('retain applicable Apache-2.0 license and notice information')) fail(`Invalid license metadata: ${model.id}`);
  if (model.id === 'hair-segmenter' && (model.output.hairChannelIndex !== 1 || JSON.stringify(model.output.labels) !== JSON.stringify(['background', 'hair']))) fail('Hair segmentation fallback metadata mismatch');
  const file = join(root, 'public', model.localPath);
  const bytes = await readFile(file);
  if ((await stat(file)).size !== model.bytes) fail(`Size mismatch: ${model.localPath}`);
  if (sha256(bytes) !== model.sha256) fail(`SHA-256 mismatch: ${model.localPath}`);
  requiredModels.delete(model.id);
}
if (requiredModels.size) fail(`Missing model entries: ${[...requiredModels.keys()].join(', ')}`);

const sourceFiles = (await readdir(sourceWasmDirectory)).sort();
const copiedFiles = (await readdir(copiedWasmDirectory)).sort();
if (!manifest.wasm || manifest.wasm.directory !== '/vendor/mediapipe' || JSON.stringify(manifest.wasm.files) !== JSON.stringify(sourceFiles)) fail('Manifest WASM metadata mismatch');
if (sourceFiles.join('\0') !== copiedFiles.join('\0')) fail('Copied WASM filenames do not match installed @mediapipe/tasks-vision 1.0.1');
for (const filename of sourceFiles) {
  const [source, copied] = await Promise.all([readFile(join(sourceWasmDirectory, filename)), readFile(join(copiedWasmDirectory, filename))]);
  if (source.length !== copied.length || sha256(source) !== sha256(copied)) fail(`WASM asset mismatch: ${filename}`);
}
console.log(`Verified ${manifest.models.length} models and ${sourceFiles.length} MediaPipe ${packageJson.version} WASM assets.`);
