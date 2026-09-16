import { expect, it, vi } from 'vitest';
import { applyOpenMakeup, type MakeupState } from '../src/app/open-makeup';
import type { Category } from 'open-makeup-sdk';

it('applies enabled makeup layers and clears disabled layers', async () => {
  const state: MakeupState = {
    foundation: { enabled: true, color: '#d9a57f', finish: 'matte' },
    lipstick: { enabled: false, color: '#ce4b62', finish: 'glossy' },
    blush: { enabled: true, color: '#e26d7a', finish: 'matte' },
    eyeshadow: { enabled: true, color: '#5c382e', finish: 'matte' },
    eyeline: { enabled: false, color: '#1a1110' },
  };
  const apply = vi.fn(async (category: string) => ({ category: category as Category, color: '', finish: null, pattern: null }));
  const clear = vi.fn();

  await applyOpenMakeup({ apply, clear }, state);

  expect(apply.mock.calls.map(([category]) => category)).toEqual(['foundation', 'blush', 'eyeshadow']);
  expect(clear.mock.calls.map(([category]) => category)).toEqual(['lipstick', 'eyeline']);
});
