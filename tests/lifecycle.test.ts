import { describe, expect, it } from 'vitest';
import { initialRecoveryState, modelTimeout, recordRecoveryAttempt, resetRecovery, staleResultTimeout, visibilitySignal } from '../src/engine/lifecycle';

describe('lifecycle bookkeeping', () => {
  it('detects model and stale-result timeouts at the boundary', () => {
    expect(modelTimeout(100, 199, 100).timedOut).toBe(false);
    expect(modelTimeout(100, 200, 100).timedOut).toBe(true);
    expect(staleResultTimeout(10, 60, 50).timedOut).toBe(true);
  });

  it('emits pause/resume only for visibility transitions', () => {
    expect(visibilitySignal(true, true)).toBeNull();
    expect(visibilitySignal(true, false)).toBe('pause');
    expect(visibilitySignal(false, true)).toBe('resume');
  });

  it('bounds recovery attempts and exponential backoff', () => {
    const config = { maxRecoveryAttempts: 3, recoveryBackoffMs: 100, recoveryBackoffMaxMs: 250 };
    const one = recordRecoveryAttempt(initialRecoveryState(), config);
    const two = recordRecoveryAttempt(one, config);
    const three = recordRecoveryAttempt(two, config);
    expect([one.nextDelayMs, two.nextDelayMs, three.nextDelayMs]).toEqual([100, 200, 250]);
    expect(three.exhausted).toBe(true);
    expect(recordRecoveryAttempt(three, config)).toMatchObject({ attempts: 3, exhausted: true, nextDelayMs: null });
    expect(resetRecovery(three)).toEqual(initialRecoveryState());
  });
});
