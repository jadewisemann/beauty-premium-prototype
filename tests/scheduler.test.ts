import { describe, expect, it, vi } from 'vitest';
import { LatestFrameScheduler } from '../src/engine/scheduler';

describe('LatestFrameScheduler', () => {
  it('keeps one active frame and replaces the pending frame', async () => {
    const releases: Array<() => void> = [];
    const seen: number[] = [];
    const run = vi.fn(async (frame: { id: number; close(): void }) => {
      seen.push(frame.id);
      await new Promise<void>((resolve) => releases.push(resolve));
      frame.close();
    });
    const scheduler = new LatestFrameScheduler(run);
    const frames = [1, 2, 3].map((id) => ({ id, close: vi.fn() }));

    frames.forEach((frame) => scheduler.submit(frame));
    expect(scheduler.queued).toBe(2);
    expect(frames[1].close).toHaveBeenCalledOnce();
    releases.shift()?.();
    await vi.waitFor(() => expect(seen).toEqual([1, 3]));
    releases.shift()?.();
    await vi.waitFor(() => expect(scheduler.queued).toBe(0));
    expect(frames[0].close).toHaveBeenCalledOnce();
    expect(frames[2].close).toHaveBeenCalledOnce();
  });

  it('closes pending and future frames after disposal', async () => {
    let release = () => {};
    const scheduler = new LatestFrameScheduler(async (frame: { close(): void }) => {
      await new Promise<void>((resolve) => { release = resolve; });
      frame.close();
    });
    const active = { close: vi.fn() };
    const pending = { close: vi.fn() };
    const after = { close: vi.fn() };
    scheduler.submit(active);
    scheduler.submit(pending);
    scheduler.dispose();
    scheduler.submit(after);
    expect(pending.close).toHaveBeenCalledOnce();
    expect(after.close).toHaveBeenCalledOnce();
    release();
    await vi.waitFor(() => expect(active.close).toHaveBeenCalledOnce());
  });
});
