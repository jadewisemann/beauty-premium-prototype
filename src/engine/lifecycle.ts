/** Pure timing and recovery bookkeeping. The controller owns timers and DOM signals. */
export interface LifecycleConfig {
  modelTimeoutMs: number;
  staleResultTimeoutMs: number;
  maxRecoveryAttempts: number;
  recoveryBackoffMs: number;
  recoveryBackoffMaxMs?: number;
}

export interface TimeoutCheck {
  timedOut: boolean;
  elapsedMs: number;
}

export type VisibilitySignal = 'pause' | 'resume' | null;

export interface RecoveryState {
  attempts: number;
  nextDelayMs: number | null;
  exhausted: boolean;
}

const elapsed = (startedMs: number, nowMs: number) => Math.max(0, nowMs - startedMs);

export function modelTimeout(startedMs: number, nowMs: number, timeoutMs: number): TimeoutCheck {
  const elapsedMs = elapsed(startedMs, nowMs);
  return { elapsedMs, timedOut: elapsedMs >= Math.max(0, timeoutMs) };
}

export function staleResultTimeout(taskTimestampMs: number, nowMs: number, timeoutMs: number): TimeoutCheck {
  const elapsedMs = elapsed(taskTimestampMs, nowMs);
  return { elapsedMs, timedOut: elapsedMs >= Math.max(0, timeoutMs) };
}

/** Returns a signal only when visibility changes, making repeated events harmless. */
export function visibilitySignal(wasVisible: boolean, isVisible: boolean): VisibilitySignal {
  if (wasVisible === isVisible) return null;
  return isVisible ? 'resume' : 'pause';
}

export function initialRecoveryState(): RecoveryState {
  return { attempts: 0, nextDelayMs: null, exhausted: false };
}

export function recordRecoveryAttempt(
  state: RecoveryState,
  config: Pick<LifecycleConfig, 'maxRecoveryAttempts' | 'recoveryBackoffMs' | 'recoveryBackoffMaxMs'>,
): RecoveryState {
  const max = Math.max(0, Math.floor(config.maxRecoveryAttempts));
  if (state.exhausted || state.attempts >= max) return { ...state, exhausted: true, nextDelayMs: null };
  const attempts = state.attempts + 1;
  const cap = Math.max(0, config.recoveryBackoffMaxMs ?? Number.POSITIVE_INFINITY);
  const nextDelayMs = Math.min(cap, Math.max(0, config.recoveryBackoffMs) * 2 ** (attempts - 1));
  return { attempts, nextDelayMs, exhausted: attempts >= max };
}

export function resetRecovery(state: RecoveryState = initialRecoveryState()): RecoveryState {
  return { ...state, attempts: 0, nextDelayMs: null, exhausted: false };
}
