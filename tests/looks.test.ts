import { describe, expect, it } from 'vitest';
import { DRAFT_LOOKS, HAIR_COLORS, LIP_COLORS, BLUSH_PALETTES } from '../src/looks/presets';
import { HISTORY_LIMIT, applyPreset, beginSliderTransaction, commitRecipe, commitSliderTransaction, createRecipeHistory, patchRegion, redoRecipe, undoRecipe, updateSliderTransaction } from '../src/app/recipe-state';

const base = () => structuredClone(DRAFT_LOOKS[0]);
const changed = (recipe = base(), strength = 0.1) => patchRegion(recipe, 'lip', { strength });

describe('draft looks', () => {
  it('exports the requested experimental palette and six unapproved looks', () => {
    expect(DRAFT_LOOKS).toHaveLength(6);
    expect(DRAFT_LOOKS.map(({ label }) => label)).toEqual(expect.arrayContaining(['[Experimental · Unapproved] Soft Brown', '[Experimental · Unapproved] Copper Glow', '[Experimental · Unapproved] Rose Brown', '[Experimental · Unapproved] Cool Ash', '[Experimental · Unapproved] Berry Contrast', '[Experimental · Unapproved] Creative Plum']));
    expect(DRAFT_LOOKS.every(({ label }) => /experimental.*unapproved/i.test(label))).toBe(true);
    expect(HAIR_COLORS).toHaveLength(6);
    expect(LIP_COLORS).toHaveLength(8);
    expect(BLUSH_PALETTES).toHaveLength(4);
  });
});

describe('recipe state', () => {
  it('applies only unlocked preset regions without mutating either input', () => {
    const current = base();
    const preset = structuredClone(DRAFT_LOOKS[1]);
    const result = applyPreset(current, preset, { hair: true, blush: true });
    expect(result.hair).toEqual(current.hair);
    expect(result.blush).toEqual(current.blush);
    expect(result.lip).toEqual(preset.lip);
    result.lip.targetColor = '#000000';
    expect(preset.lip.targetColor).not.toBe('#000000');
    expect(current.id).toBe('soft-brown');
  });

  it('patches only the named region', () => {
    const original = base();
    const result = patchRegion(original, 'hair', { strength: 0.2 });
    expect(result.hair.strength).toBe(0.2);
    expect(result.lip).toEqual(original.lip);
    expect(result.blush).toEqual(original.blush);
    expect(original.hair.strength).not.toBe(0.2);
  });

  it('undoes, redoes, and truncates a branched future', () => {
    const first = changed(base(), 0.2);
    const second = changed(first, 0.3);
    const history = commitRecipe(commitRecipe(createRecipeHistory(base()), first), second);
    const undone = undoRecipe(history);
    expect(undone.present.lip.strength).toBe(0.2);
    expect(redoRecipe(undone).present.lip.strength).toBe(0.3);
    const branched = commitRecipe(undone, changed(undone.present, 0.4));
    expect(branched.future).toEqual([]);
    expect(redoRecipe(branched)).toBe(branched);
  });

  it('limits JSON-only snapshots to twenty entries', () => {
    let history = createRecipeHistory(base());
    for (let index = 1; index <= HISTORY_LIMIT + 3; index += 1) history = commitRecipe(history, changed(history.present, index / 100));
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(JSON.parse(JSON.stringify(history))).toEqual(history);
  });

  it('records a slider drag as one undo entry when committed', () => {
    const initial = createRecipeHistory(base());
    const dragging = updateSliderTransaction(updateSliderTransaction(beginSliderTransaction(initial), changed(initial.present, 0.2)), changed(initial.present, 0.4));
    expect(dragging.past).toHaveLength(0);
    const committed = commitSliderTransaction(dragging);
    expect(committed.past).toHaveLength(1);
    expect(undoRecipe(committed).present.lip.strength).toBe(initial.present.lip.strength);
  });
});
