/** Shared engine contracts. Source coordinates are upright, unmirrored UVs. */
export type Region = 'hair' | 'lip' | 'blush';
export type SourceKind = 'camera' | 'photo' | 'replay';

/** A row-major homogeneous 2D transform. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export interface FrameMeta {
  generation: number;
  frameId: number;
  kind: SourceKind;
  /** Main-thread clock, not sensor exposure time. */
  acquiredMs: number;
  taskTimestampMs: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceToDisplay: Mat3;
}

export interface FaceSnapshot {
  frame: FrameMeta;
  /** x, y, z triples in upright, unmirrored source coordinates. */
  landmarks: Float32Array;
  /** Fitted local frame; it is not a metric-depth transform. */
  sourceToFace: Mat3;
  fitResidual: number;
}

export interface HairSnapshot {
  frame: FrameMeta;
  width: number;
  height: number;
  sourceToMask: Mat3;
  meaning: 'confidence';
  /** Continuous 0..255 confidence values, never category/class IDs. */
  values: Uint8Array;
  poseAtSource: Mat3 | null;
  inferenceMs: number;
  readbackAndCopyMs: number;
}

export interface HairRecipe {
  enabled: boolean;
  targetColor: string;
  strength: number;
  chromaMix: number;
  liftStops: number;
  detailKeep: number;
  detailLimit: number;
  highlightProtect: number;
  edgeStrength: number;
}

export interface LipRecipe {
  enabled: boolean;
  material: 'tint' | 'satin';
  targetColor: string;
  strength: number;
}

export interface BlushRecipe {
  enabled: boolean;
  targetColor: string;
  strength: number;
  size: number;
}

export interface LookRecipe {
  schemaVersion: 1;
  id: string;
  revision: number;
  label: string;
  mode: 'natural' | 'expressive';
  hair: HairRecipe;
  lip: LipRecipe;
  blush: BlushRecipe;
}

export type WorkerRequest =
  | { type: 'INIT'; assetManifest: string }
  | { type: 'SET_MODE'; requestId: number; mode: 'IMAGE' | 'VIDEO'; generation: number }
  | { type: 'FRAME'; meta: FrameMeta; bitmap: ImageBitmap; runFace: boolean; runHair: boolean }
  | { type: 'RECYCLE_BUFFER'; buffer: ArrayBuffer }
  | { type: 'DISPOSE' };

export type WorkerResponse =
  | { type: 'READY' }
  | { type: 'MODE_READY'; requestId: number; generation: number }
  | { type: 'FACE_RESULT'; result: FaceSnapshot | null; frame: FrameMeta }
  | { type: 'HAIR_RESULT'; result: HairSnapshot }
  | { type: 'FRAME_DONE'; frame: FrameMeta }
  | { type: 'ERROR'; code: string; message: string; generation: number; frameId?: number };

/** The controller state machine specified for G0 input and analysis. */
export type EngineState =
  | 'IDLE'
  | 'LOADING_MODELS'
  | 'READY'
  | 'REQUESTING_CAMERA'
  | 'LIVE'
  | 'DECODING_PHOTO'
  | 'ANALYZING_PHOTO'
  | 'PHOTO'
  | 'FREEZING'
  | 'EXPORTING'
  | 'SWITCHING_SOURCE'
  | 'PAUSED'
  | 'ERROR'
  | 'DISPOSING';

export type EngineErrorCode =
  | 'ASSET_LOAD_FAILED'
  | 'CAMERA_DENIED'
  | 'CAMERA_UNAVAILABLE'
  | 'CAMERA_NO_VIDEO_TRACK'
  | 'PHOTO_DECODE_FAILED'
  | 'PHOTO_OVERSIZE'
  | 'REPLAY_DECODE_FAILED'
  | 'UNSUPPORTED_PHOTO_FORMAT'
  | 'MODEL_INIT_FAILED'
  | 'MODEL_MODE_FAILED'
  | 'MODEL_INFERENCE_FAILED'
  | 'INVALID_MODEL_OUTPUT'
  | 'WORKER_FAILED'
  | 'TIMEOUT'
  | 'CONTEXT_LOST';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
  generation: number;
  frameId?: number;
  recoverable: boolean;
}
