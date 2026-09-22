import { expect, it } from 'vitest';
import { toLookRecipe, type MakeupState } from '../src/app/open-makeup';

it('maps UI makeup state to the in-house renderer recipe', () => {
  const state: MakeupState = {
    foundation: { enabled: true, color: '#d9a57f', finish: 'matte' },
    lipstick: { enabled: false, color: '#ce4b62', finish: 'glossy' },
    blush: { enabled: true, color: '#e26d7a', finish: 'matte' },
    eyeshadow: { enabled: true, color: '#5c382e', finish: 'matte' },
    eyeline: { enabled: false, color: '#1a1110' },
  };
  const recipe = toLookRecipe(state, { color: '#8a4a32', strength: 0.65 });

  expect(recipe.foundation.enabled).toBe(true);
  expect(recipe.lip.enabled).toBe(false);
  expect(recipe.blush.enabled).toBe(true);
  expect(recipe.eye.shadowStrength).toBe(0.65);
  expect(recipe.eye.linerStrength).toBe(0);
  expect(recipe.hair.targetColor).toBe('#8a4a32');
});
