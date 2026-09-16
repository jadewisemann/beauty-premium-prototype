import { expect, it } from 'vitest';
import { tintHairMask } from '../src/app/hair-color';

it('colors only confident hair pixels', () => {
  const pixels = new Uint8ClampedArray(8);
  tintHairMask(new Float32Array([0.1, 1]), pixels, '#804020', 0.5);

  expect([...pixels]).toEqual([128, 64, 32, 0, 128, 64, 32, 110]);
});
