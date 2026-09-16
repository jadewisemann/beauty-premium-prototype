import type { Finish, OpenMakeup } from 'open-makeup-sdk';

export interface MakeupState {
  foundation: { enabled: boolean; color: string; finish: Finish };
  lipstick: { enabled: boolean; color: string; finish: Finish };
  blush: { enabled: boolean; color: string; finish: Finish };
  eyeshadow: { enabled: boolean; color: string; finish: Finish };
  eyeline: { enabled: boolean; color: string };
}

export interface MakeupEngineInternals {
  blushMat?: { uniforms: { _transparency?: { value: number } } };
  eyeShadowMat?: { uniforms: { _transparency?: { value: number } } };
}

type MakeupApi = Pick<OpenMakeup, 'apply' | 'clear'>;

export async function applyOpenMakeup(makeup: MakeupApi, state: MakeupState, engine?: MakeupEngineInternals): Promise<void> {
  await setLayer(makeup, 'foundation', state.foundation);
  await setLayer(makeup, 'lipstick', state.lipstick);
  await setLayer(makeup, 'blush', state.blush);
  await setLayer(makeup, 'eyeshadow', state.eyeshadow);
  await setLayer(makeup, 'eyeline', state.eyeline);
  if (engine?.blushMat?.uniforms._transparency) engine.blushMat.uniforms._transparency.value = 0.7;
  if (engine?.eyeShadowMat?.uniforms._transparency) engine.eyeShadowMat.uniforms._transparency.value = 0.65;
}

async function setLayer(makeup: MakeupApi, category: string, layer: { enabled: boolean; color: string; finish?: Finish }): Promise<void> {
  if (layer.enabled) await makeup.apply(category, { color: layer.color, ...(layer.finish ? { finish: layer.finish } : {}) });
  else makeup.clear(category);
}
