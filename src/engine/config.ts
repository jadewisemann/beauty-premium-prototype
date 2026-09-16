export interface EngineConfig {
  liveLongEdge: number;
  photoAnalysisLongEdge: number;
  exportLongEdgeMax: number;
  faceMaxHz: number;
  hairMaxHz: number;
  maskWorkingLongEdge: number;
  faceFadeStartMs: number;
  faceExpireMs: number;
  hairFadeStartMs: number;
  hairExpireMs: number;
  stationaryTauMs: number;
  movingTauMs: number;
  maxHistoryWeight: number;
  diagnosticsHz: number;
  undoLimit: number;
  jpegQuality: number;
}

/** Initial, deliberately conservative G0 operating values from the specification. */
export const initialEngineConfig = {
  liveLongEdge: 960,
  photoAnalysisLongEdge: 1536,
  exportLongEdgeMax: 2048,
  faceMaxHz: 20,
  hairMaxHz: 8,
  maskWorkingLongEdge: 256,
  faceFadeStartMs: 150,
  faceExpireMs: 300,
  hairFadeStartMs: 250,
  hairExpireMs: 450,
  stationaryTauMs: 100,
  movingTauMs: 40,
  maxHistoryWeight: 0.8,
  diagnosticsHz: 2,
  undoLimit: 20,
  jpegQuality: 0.92,
} as const satisfies EngineConfig;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const positiveInt = (value: unknown, fallback: number): number =>
  Math.max(1, Math.round(finite(value, fallback)));

/**
 * Keeps externally supplied tuning values safe without inventing a schema layer.
 * Unknown keys are intentionally ignored.
 */
export function normalizeEngineConfig(candidate: Partial<EngineConfig> = {}): EngineConfig {
  const base = initialEngineConfig;
  const faceFadeStartMs = positiveInt(candidate.faceFadeStartMs, base.faceFadeStartMs);
  const hairFadeStartMs = positiveInt(candidate.hairFadeStartMs, base.hairFadeStartMs);

  return {
    liveLongEdge: positiveInt(candidate.liveLongEdge, base.liveLongEdge),
    photoAnalysisLongEdge: positiveInt(candidate.photoAnalysisLongEdge, base.photoAnalysisLongEdge),
    exportLongEdgeMax: positiveInt(candidate.exportLongEdgeMax, base.exportLongEdgeMax),
    faceMaxHz: positiveInt(candidate.faceMaxHz, base.faceMaxHz),
    hairMaxHz: positiveInt(candidate.hairMaxHz, base.hairMaxHz),
    maskWorkingLongEdge: positiveInt(candidate.maskWorkingLongEdge, base.maskWorkingLongEdge),
    faceFadeStartMs,
    faceExpireMs: Math.max(faceFadeStartMs, positiveInt(candidate.faceExpireMs, base.faceExpireMs)),
    hairFadeStartMs,
    hairExpireMs: Math.max(hairFadeStartMs, positiveInt(candidate.hairExpireMs, base.hairExpireMs)),
    stationaryTauMs: positiveInt(candidate.stationaryTauMs, base.stationaryTauMs),
    movingTauMs: positiveInt(candidate.movingTauMs, base.movingTauMs),
    maxHistoryWeight: clamp(finite(candidate.maxHistoryWeight, base.maxHistoryWeight), 0, 1),
    diagnosticsHz: positiveInt(candidate.diagnosticsHz, base.diagnosticsHz),
    undoLimit: positiveInt(candidate.undoLimit, base.undoLimit),
    jpegQuality: clamp(finite(candidate.jpegQuality, base.jpegQuality), 0, 1),
  };
}
