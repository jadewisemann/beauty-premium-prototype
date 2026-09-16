import type { BlushRecipe, HairRecipe, LipRecipe, LookRecipe, Region } from '../engine/contracts';

export type RegionLocks = Partial<Record<Region, boolean>>;
export type RegionPatch = Partial<HairRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>;

export interface RecipeHistory {
  past: LookRecipe[];
  present: LookRecipe;
  future: LookRecipe[];
  transaction: LookRecipe | null;
}

export const HISTORY_LIMIT = 20;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: LookRecipe, right: LookRecipe) => JSON.stringify(left) === JSON.stringify(right);

/** Applies unlocked preset regions without sharing any mutable recipe data. */
export function applyPreset(current: LookRecipe, preset: LookRecipe, locks: RegionLocks = {}): LookRecipe {
  return {
    ...clone(current),
    id: preset.id,
    label: preset.label,
    mode: preset.mode,
    revision: current.revision + 1,
    hair: locks.hair ? clone(current.hair) : clone(preset.hair),
    lip: locks.lip ? clone(current.lip) : clone(preset.lip),
    blush: locks.blush ? clone(current.blush) : clone(preset.blush),
  };
}

/** Patches exactly one cosmetic region, retaining the rest of the recipe. */
export function patchRegion(current: LookRecipe, region: 'hair', patch: Partial<HairRecipe>): LookRecipe;
export function patchRegion(current: LookRecipe, region: 'lip', patch: Partial<LipRecipe>): LookRecipe;
export function patchRegion(current: LookRecipe, region: 'blush', patch: Partial<BlushRecipe>): LookRecipe;
export function patchRegion(current: LookRecipe, region: Region, patch: RegionPatch): LookRecipe {
  return { ...clone(current), revision: current.revision + 1, [region]: { ...current[region], ...clone(patch) } } as LookRecipe;
}

export const createRecipeHistory = (present: LookRecipe): RecipeHistory => ({ past: [], present: clone(present), future: [], transaction: null });

export function commitRecipe(history: RecipeHistory, next: LookRecipe): RecipeHistory {
  if (same(history.present, next)) return history;
  return {
    past: [...history.past, clone(history.present)].slice(-HISTORY_LIMIT),
    present: clone(next),
    future: [],
    transaction: null,
  };
}

export function undoRecipe(history: RecipeHistory): RecipeHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: clone(previous), future: [clone(history.present), ...history.future], transaction: null };
}

export function redoRecipe(history: RecipeHistory): RecipeHistory {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, clone(history.present)].slice(-HISTORY_LIMIT), present: clone(next), future: history.future.slice(1), transaction: null };
}

/** Slider changes replace the visible draft; commit writes its original state once. */
export function beginSliderTransaction(history: RecipeHistory): RecipeHistory {
  return history.transaction ? history : { ...history, transaction: clone(history.present) };
}

export function updateSliderTransaction(history: RecipeHistory, next: LookRecipe): RecipeHistory {
  return history.transaction ? { ...history, present: clone(next) } : commitRecipe(history, next);
}

export function commitSliderTransaction(history: RecipeHistory): RecipeHistory {
  if (!history.transaction) return history;
  if (same(history.transaction, history.present)) return { ...history, transaction: null };
  return { past: [...history.past, clone(history.transaction)].slice(-HISTORY_LIMIT), present: clone(history.present), future: [], transaction: null };
}
