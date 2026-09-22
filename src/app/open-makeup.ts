import type { LookRecipe } from '../engine/contracts';

export type Finish = 'matte' | 'shimmer' | 'glossy';

export interface MakeupState {
  foundation: { enabled: boolean; color: string; finish: Finish };
  lipstick: { enabled: boolean; color: string; finish: Finish };
  blush: { enabled: boolean; color: string; finish: Finish };
  eyeshadow: { enabled: boolean; color: string; finish: Finish };
  eyeline: { enabled: boolean; color: string };
}

export function toLookRecipe(
  makeup: MakeupState,
  hair: { color: string; strength: number },
): LookRecipe {
  return {
    schemaVersion: 2,
    id: 'live',
    revision: 1,
    label: 'Live',
    mode: 'natural',
    hair: {
      enabled: hair.strength > 0,
      targetColor: hair.color,
      strength: hair.strength,
      chromaMix: 0.72,
      liftStops: 0,
      detailKeep: 0.74,
      detailLimit: 0.8,
      highlightProtect: 0.58,
      edgeStrength: 0.72,
    },
    foundation: {
      enabled: makeup.foundation.enabled,
      targetColor: makeup.foundation.color,
      strength: 0.72,
    },
    lip: {
      enabled: makeup.lipstick.enabled,
      targetColor: makeup.lipstick.color,
      material: makeup.lipstick.finish === 'glossy' ? 'gloss' : makeup.lipstick.finish === 'shimmer' ? 'satin' : 'matte',
      strength: 0.82,
    },
    blush: {
      enabled: makeup.blush.enabled,
      targetColor: makeup.blush.color,
      strength: 0.7,
      size: 0.65,
      placement: 'apple',
    },
    eye: {
      enabled: makeup.eyeshadow.enabled || makeup.eyeline.enabled,
      targetColor: makeup.eyeshadow.color,
      linerColor: makeup.eyeline.color,
      shadowStrength: makeup.eyeshadow.enabled ? 0.65 : 0,
      linerStrength: makeup.eyeline.enabled ? 0.9 : 0,
    },
  };
}
