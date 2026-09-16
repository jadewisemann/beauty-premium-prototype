import { describe, expect, it } from 'vitest';
import {
  gamutMapOklab,
  linearRgbToOklab,
  linearToSrgb,
  oklabToLinearRgb,
  parseHexColor,
  relativeLuminance,
  srgbToLinear,
} from '../src/engine/color';

const primaryAndExtremes = [0, 1, 0.25, 0.5, 0.75];

describe('color math', () => {
  it('round-trips sRGB transfer channels', () => {
    for (const channel of primaryAndExtremes) expect(linearToSrgb(srgbToLinear(channel))).toBeCloseTo(channel, 12);
  });

  it('round-trips black, white, and primary linear RGB through OKLab', () => {
    for (const color of [
      { r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, { r: 1, g: 0, b: 0 },
      { r: 0, g: 1, b: 0 }, { r: 0, g: 0, b: 1 },
    ]) {
      expect(oklabToLinearRgb(linearRgbToOklab(color))).toEqual(expect.objectContaining({
        r: expect.closeTo(color.r, 6), g: expect.closeTo(color.g, 6), b: expect.closeTo(color.b, 6),
      }));
    }
  });

  it('keeps neutral linear RGB neutral in OKLab', () => {
    const neutral = linearRgbToOklab({ r: 0.4, g: 0.4, b: 0.4 });
    expect(neutral.a).toBeCloseTo(0, 6);
    expect(neutral.b).toBeCloseTo(0, 6);
    expect(relativeLuminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 12);
  });

  it('parses only #RRGGBB colors', () => {
    expect(parseHexColor('#80ff00')).toEqual({ r: 128 / 255, g: 1, b: 0 });
    expect(() => parseHexColor('#fff')).toThrow(TypeError);
    expect(() => parseHexColor('80ff00')).toThrow(TypeError);
    expect(() => parseHexColor('#gg0000')).toThrow(TypeError);
  });

  it('maps out-of-gamut OKLab colors to finite linear RGB in gamut', () => {
    const mapped = gamutMapOklab({ L: 0.7, a: 0.5, b: 0.5 });
    for (const channel of [mapped.r, mapped.g, mapped.b]) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});
