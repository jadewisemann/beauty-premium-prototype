export type DiagnosticEventName =
  | 'model-load'
  | 'face-inference'
  | 'hair-inference'
  | 'hair-readback-copy'
  | 'frame-total';

export interface DiagnosticError {
  code: string;
  at: number;
}

export interface DiagnosticsSnapshot {
  startedAt: string;
  environment: {
    userAgent: string;
    secureContext: boolean;
  };
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<string, { count: number; latestMs: number; meanMs: number; maxMs: number }>;
  errors: DiagnosticError[];
  cameraSettings?: MediaTrackSettings;
}

interface TimingAccumulator {
  count: number;
  sumMs: number;
  latestMs: number;
  maxMs: number;
}

export class Diagnostics {
  private readonly startedAt = new Date().toISOString();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly timings = new Map<DiagnosticEventName, TimingAccumulator>();
  private readonly errors: DiagnosticError[] = [];
  private cameraSettings?: MediaTrackSettings;

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    if (Number.isFinite(value)) this.gauges.set(name, Math.round(value * 100) / 100);
  }

  timing(name: DiagnosticEventName, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const current = this.timings.get(name) ?? { count: 0, sumMs: 0, latestMs: 0, maxMs: 0 };
    current.count += 1;
    current.sumMs += durationMs;
    current.latestMs = durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    this.timings.set(name, current);
  }

  error(code: string): void {
    this.errors.push({ code, at: performance.now() });
    if (this.errors.length > 50) this.errors.shift();
  }

  setCameraSettings(settings: MediaTrackSettings): void {
    this.cameraSettings = { ...settings };
  }

  snapshot(): DiagnosticsSnapshot {
    return {
      startedAt: this.startedAt,
      environment: {
        userAgent: globalThis.navigator?.userAgent ?? 'unavailable',
        secureContext: globalThis.isSecureContext ?? false,
      },
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      timings: Object.fromEntries([...this.timings].map(([name, value]) => [name, {
        count: value.count,
        latestMs: round(value.latestMs),
        meanMs: round(value.sumMs / value.count),
        maxMs: round(value.maxMs),
      }])),
      errors: [...this.errors],
      ...(this.cameraSettings ? { cameraSettings: this.cameraSettings } : {}),
    };
  }

  download(filename = 'becon-diagnostics.json'): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.snapshot(), null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
