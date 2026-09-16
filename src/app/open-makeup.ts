import type { Finish, OpenMakeup } from 'open-makeup-sdk';
import type { LookRecipe } from '../engine/contracts';

interface UniformValue { value: number }
export interface MakeupEngineInternals {
  blushMat?: { uniforms: { _transparency?: UniformValue } };
  eyeShadowMat?: { uniforms: { _transparency?: UniformValue } };
}

type MakeupApi = Pick<OpenMakeup, 'apply' | 'clear'>;

export async function applyOpenMakeupRecipe(makeup: MakeupApi, recipe: LookRecipe, engine?: MakeupEngineInternals): Promise<void> {
  await toggle(makeup, 'lipstick', recipe.lip.enabled && recipe.lip.strength > 0, {
    color: recipe.lip.targetColor,
    finish: lipFinish(recipe.lip.material),
  });
  await toggle(makeup, 'eyeshadow', recipe.eye.enabled && recipe.eye.shadowStrength > 0, {
    color: recipe.eye.targetColor,
    finish: 'matte',
  });
  await toggle(makeup, 'eyeline', recipe.eye.enabled && recipe.eye.linerStrength > 0, {
    color: recipe.eye.targetColor,
  });
  await toggle(makeup, 'blush', recipe.blush.enabled && recipe.blush.strength > 0, {
    color: recipe.blush.targetColor,
    finish: 'matte',
  });

  setUniform(engine?.eyeShadowMat?.uniforms._transparency, recipe.eye.shadowStrength);
  setUniform(engine?.blushMat?.uniforms._transparency, recipe.blush.strength);
  // ponytail: OpenMakeupSDK 0.1.0 has no lipstick/eyeliner intensity or blush placement API; remove this binary fallback when upstream exposes them.
}

async function toggle(makeup: MakeupApi, category: string, enabled: boolean, options: Parameters<MakeupApi['apply']>[1]): Promise<void> {
  if (enabled) await makeup.apply(category, options);
  else makeup.clear(category);
}

function lipFinish(material: LookRecipe['lip']['material']): Finish {
  return { tint: 'matte', satin: 'shimmer', matte: 'matte', gloss: 'glossy' }[material] as Finish;
}

function setUniform(uniform: UniformValue | undefined, value: number): void {
  if (uniform) uniform.value = Math.max(0, Math.min(1, value));
}
