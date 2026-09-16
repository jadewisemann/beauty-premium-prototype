import { describe, expect, it, vi } from 'vitest';
import { applyOpenMakeupRecipe } from '../src/app/open-makeup';
import { DRAFT_LOOKS } from '../src/looks/presets';
import type { Category } from 'open-makeup-sdk';

describe('OpenMakeupSDK recipe bridge', () => {
  it('maps enabled regions and clears disabled ones', async () => {
    const recipe = structuredClone(DRAFT_LOOKS[0]);
    recipe.eye.linerStrength = 0;
    recipe.blush.strength = 1.5;
    const apply = vi.fn(async (category: string) => ({ category: category as Category, color: '', finish: null, pattern: null }));
    const clear = vi.fn();
    const engine = {
      eyeShadowMat: { uniforms: { _transparency: { value: -1 } } },
      blushMat: { uniforms: { _transparency: { value: -1 } } },
    };

    await applyOpenMakeupRecipe({ apply, clear }, recipe, engine);

    expect(apply.mock.calls.map(([category]) => category)).toEqual(['lipstick', 'eyeshadow', 'blush']);
    expect(clear).toHaveBeenCalledWith('eyeline');
    expect(engine.eyeShadowMat.uniforms._transparency.value).toBe(recipe.eye.shadowStrength);
    expect(engine.blushMat.uniforms._transparency.value).toBe(1);
  });
});
