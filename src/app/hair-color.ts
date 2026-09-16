export function tintHairMask(mask: Float32Array, pixels: Uint8ClampedArray, color: string, strength: number): void {
  const [red, green, blue] = hexToRgb(color);
  const alpha = Math.max(0, Math.min(1, strength)) * 220;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = Math.round(Math.max(0, Math.min(1, (mask[index] - 0.15) / 0.85)) * alpha);
  }
}

function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}
