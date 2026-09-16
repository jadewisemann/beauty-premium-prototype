/** Small, dependency-free CSS Color 4 compatible color conversions. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const inGamut = ({ r, g, b }: Rgb): boolean => Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
  && r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;

/** Converts one encoded sRGB channel (0..1) to linear sRGB. */
export const srgbToLinear = (channel: number): number => (
  Math.abs(channel) <= 0.04045 ? channel / 12.92 : Math.sign(channel) * ((Math.abs(channel) + 0.055) / 1.055) ** 2.4
);

/** Converts one linear sRGB channel to encoded sRGB (0..1). */
export const linearToSrgb = (channel: number): number => (
  Math.abs(channel) <= 0.0031308 ? 12.92 * channel : Math.sign(channel) * (1.055 * Math.abs(channel) ** (1 / 2.4) - 0.055)
);

export const srgbToLinearRgb = ({ r, g, b }: Rgb): Rgb => ({
  r: srgbToLinear(r), g: srgbToLinear(g), b: srgbToLinear(b),
});

export const linearToSrgbRgb = ({ r, g, b }: Rgb): Rgb => ({
  r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b),
});

/** CSS Color 4 linear sRGB to OKLab reference matrices. */
export function linearRgbToOklab({ r, g, b }: Rgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** CSS Color 4 OKLab to linear sRGB reference matrices. */
export function oklabToLinearRgb({ L, a, b }: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** Parses exactly a #RRGGBB color into encoded sRGB channels. */
export function parseHexColor(value: string): Rgb {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) throw new TypeError('Expected a #RRGGBB color');
  return { r: Number.parseInt(match[1], 16) / 255, g: Number.parseInt(match[2], 16) / 255, b: Number.parseInt(match[3], 16) / 255 };
}

/** Rec. 709 relative luminance from linear sRGB. */
export const relativeLuminance = ({ r, g, b }: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Preserves lightness and hue while using a fixed binary search to reduce
 * chroma only as much as needed for the linear-sRGB gamut.
 */
export function gamutMapOklab(color: Oklab): Rgb {
  const direct = oklabToLinearRgb(color);
  if (inGamut(direct)) return direct;

  let low = 0;
  let high = 1;
  let best = oklabToLinearRgb({ L: color.L, a: 0, b: 0 });
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const mix = (low + high) / 2;
    const candidate = oklabToLinearRgb({ L: color.L, a: color.a * mix, b: color.b * mix });
    if (inGamut(candidate)) {
      low = mix;
      best = candidate;
    } else {
      high = mix;
    }
  }
  return inGamut(best) ? best : { r: clamp01(best.r), g: clamp01(best.g), b: clamp01(best.b) };
}
