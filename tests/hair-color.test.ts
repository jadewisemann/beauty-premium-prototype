import { expect, it } from 'vitest';
import { paintHairMask } from '../src/app/hair-color';

it('copies hair confidence into a texture', () => {
  const pixels = new Uint8ClampedArray(8);
  paintHairMask(new Float32Array([0.1, 1]), pixels);

  expect([...pixels]).toEqual([26, 26, 26, 255, 255, 255, 255, 255]);
});
