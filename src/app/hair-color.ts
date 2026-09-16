export function paintHairMask(mask: Float32Array, pixels: Uint8ClampedArray): void {
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const confidence = Math.round(Math.max(0, Math.min(1, mask[index])) * 255);
    pixels[offset] = confidence;
    pixels[offset + 1] = confidence;
    pixels[offset + 2] = confidence;
    pixels[offset + 3] = 255;
  }
}
