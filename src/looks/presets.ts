import type { LookRecipe } from '../engine/contracts';

export const HAIR_COLORS = ['#5A3826', '#9D5A32', '#7A483E', '#5D6774', '#3A2938', '#4B234D'] as const;
export const EYE_COLORS = ['#6F5548', '#8A6558', '#795C78', '#59606F', '#4B3439', '#2B2528'] as const;
export const LIP_COLORS = ['#A84957', '#BF5964', '#8B344D', '#C86C72', '#9E454F', '#B95B79', '#7A3049', '#A84268'] as const;
export const BLUSH_PALETTES = [
  ['#D98582', '#B95D65'],
  ['#CC765E', '#A84B43'],
  ['#CD8192', '#A95169'],
  ['#9D526D', '#713350'],
] as const;

const label = (name: string) => `[Experimental · Unapproved] ${name}`;

const recipe = (id: string, name: string, mode: LookRecipe['mode'], hairColor: string, eyeColor: string, lipColor: string, blushColor: string): LookRecipe => ({
  schemaVersion: 2,
  id,
  revision: 0,
  label: label(name),
  mode,
  hair: { enabled: true, targetColor: hairColor, strength: 0.68, chromaMix: 0.62, liftStops: 0, detailKeep: 0.7, detailLimit: 0.8, highlightProtect: 0.55, edgeStrength: 0.45 },
  eye: { enabled: true, targetColor: eyeColor, shadowStrength: 0.18, linerStrength: 0.32 },
  lip: { enabled: true, material: 'tint', targetColor: lipColor, strength: 0.52 },
  blush: { enabled: true, targetColor: blushColor, strength: 0.34, size: 0.58, placement: 'apple' },
});

/** Draft-only recipes. They are intentionally labelled as unapproved for every consumer. */
export const DRAFT_LOOKS: readonly LookRecipe[] = [
  recipe('soft-brown', 'Soft Brown', 'natural', HAIR_COLORS[0], EYE_COLORS[0], LIP_COLORS[0], BLUSH_PALETTES[0][0]),
  recipe('copper-glow', 'Copper Glow', 'natural', HAIR_COLORS[1], EYE_COLORS[1], LIP_COLORS[3], BLUSH_PALETTES[1][0]),
  recipe('rose-brown', 'Rose Brown', 'natural', HAIR_COLORS[2], EYE_COLORS[2], LIP_COLORS[1], BLUSH_PALETTES[2][0]),
  recipe('cool-ash', 'Cool Ash', 'natural', HAIR_COLORS[3], EYE_COLORS[3], LIP_COLORS[4], BLUSH_PALETTES[2][1]),
  recipe('berry-contrast', 'Berry Contrast', 'expressive', HAIR_COLORS[4], EYE_COLORS[4], LIP_COLORS[6], BLUSH_PALETTES[3][0]),
  recipe('creative-plum', 'Creative Plum', 'expressive', HAIR_COLORS[5], EYE_COLORS[2], LIP_COLORS[7], BLUSH_PALETTES[3][1]),
];
