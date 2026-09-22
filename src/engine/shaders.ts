export const fullscreenVertexShader = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 vUv;

void main() {
  vec2 position = POSITIONS[gl_VertexID];
  gl_Position = vec4(position, 0.0, 1.0);
  vUv = vec2(position.x * 0.5 + 0.5, 1.0 - (position.y * 0.5 + 0.5));
}
`;

export const refineMaskFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uRawMask;
uniform vec2 uTexel;
uniform float uSigmaColor;
uniform float uLow;
uniform float uHigh;
out vec4 outColor;

vec3 srgbToLinear(vec3 value) {
  bvec3 cutoff = lessThanEqual(value, vec3(0.04045));
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 center = srgbToLinear(texture(uSource, uv).rgb);
  float weighted = 0.0;
  float weights = 0.0;
  for (int y = -2; y <= 2; y += 1) {
    for (int x = -2; x <= 2; x += 1) {
      vec2 offset = vec2(float(x), float(y)) * uTexel;
      vec3 sampleColor = srgbToLinear(texture(uSource, uv + offset).rgb);
      vec3 delta = center - sampleColor;
      float spatial = exp(-float(x * x + y * y) / (2.0 * 1.2 * 1.2));
      float colorWeight = exp(-dot(delta, delta) / max(2.0 * uSigmaColor * uSigmaColor, 0.00001));
      float weight = spatial * colorWeight;
      weighted += texture(uRawMask, uv + offset).r * weight;
      weights += weight;
    }
  }
  float confidence = weighted / max(weights, 0.00001);
  float coverage = smoothstep(uLow, uHigh, clamp(confidence, 0.0, 1.0));
  outColor = vec4(coverage, coverage, coverage, 1.0);
}
`;

export const luminanceFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uMask;
uniform vec2 uTexel;
out vec4 outColor;

vec3 srgbToLinear(vec3 value) {
  bvec3 cutoff = lessThanEqual(value, vec3(0.04045));
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float total = 0.0;
  float weights = 0.0;
  for (int y = -2; y <= 2; y += 1) {
    for (int x = -2; x <= 2; x += 1) {
      vec2 offset = vec2(float(x), float(y)) * uTexel * 3.0;
      float mask = texture(uMask, uv + offset).r;
      vec3 linear = srgbToLinear(texture(uSource, uv + offset).rgb);
      float luminance = max(dot(linear, vec3(0.2126, 0.7152, 0.0722)), 0.003);
      float weight = 0.08 + mask;
      total += log2(luminance) * weight;
      weights += weight;
    }
  }
  float encoded = clamp((total / max(weights, 0.00001) + 12.0) / 16.0, 0.0, 1.0);
  outColor = vec4(encoded, encoded, encoded, 1.0);
}
`;

export const temporalMaskFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
uniform mat3 uCurrentToPrevious;
uniform float uHistoryWeight;
out vec4 outColor;

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 mapped = uCurrentToPrevious * vec3(uv, 1.0);
  vec2 previousUv = mapped.xy / max(mapped.z, 0.00001);
  float current = texture(uCurrent, uv).r;
  float valid = step(0.0, previousUv.x) * step(previousUv.x, 1.0) * step(0.0, previousUv.y) * step(previousUv.y, 1.0);
  float previous = texture(uPrevious, clamp(previousUv, 0.0, 1.0)).r;
  float stable = mix(current, previous, uHistoryWeight * valid);
  outColor = vec4(stable, stable, stable, 1.0);
}
`;

export const compositeFragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uRawMask;
uniform sampler2D uRefinedMask;
uniform sampler2D uLargeLuma;
uniform sampler2D uLipMask;
uniform sampler2D uEyeMask;
uniform sampler2D uFoundationMask;
uniform int uView;
uniform bool uSplitCompare;
uniform bool uMirror;
uniform bool uOverlayOnly;
uniform mat3 uCurrentToHair;
uniform mat3 uCurrentToFace;
uniform vec3 uHairTarget;
uniform vec3 uFoundationTarget;
uniform vec3 uEyeTarget;
uniform vec3 uLinerTarget;
uniform vec3 uLipTarget;
uniform vec3 uBlushTarget;
uniform float uHairStrength;
uniform float uHairChromaMix;
uniform float uHairLiftStops;
uniform float uDetailKeep;
uniform float uDetailLimit;
uniform float uHighlightProtect;
uniform float uEdgeStrength;
uniform float uHairFreshness;
uniform float uFoundationStrength;
uniform float uEyeShadowStrength;
uniform float uEyeLinerStrength;
uniform float uLipStrength;
uniform int uLipFinish;
uniform float uFaceFreshness;
uniform float uBlushStrength;
uniform vec4 uBlushLeft;
uniform vec4 uBlushRight;
uniform float uBlushAngle;
uniform vec4 uFaceEllipse;
out vec4 outColor;

vec3 srgbToLinear(vec3 value) {
  bvec3 cutoff = lessThanEqual(value, vec3(0.04045));
  vec3 low = value / 12.92;
  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

vec3 linearToSrgb(vec3 value) {
  value = max(value, vec3(0.0));
  bvec3 cutoff = lessThanEqual(value, vec3(0.0031308));
  vec3 low = value * 12.92;
  vec3 high = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, vec3(cutoff));
}

vec3 linearToOklab(vec3 color) {
  vec3 lms = transpose(mat3(
    0.4122214708, 0.5363325363, 0.0514459929,
    0.2119034982, 0.6806995451, 0.1073969566,
    0.0883024619, 0.2817188376, 0.6299787005
  )) * color;
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  return transpose(mat3(
    0.2104542553, 0.7936177850, -0.0040720468,
    1.9779984951, -2.4285922050, 0.4505937099,
    0.0259040371, 0.7827717662, -0.8086757660
  )) * lms;
}

vec3 oklabToLinear(vec3 color) {
  vec3 lms = transpose(mat3(
    1.0, 0.3963377774, 0.2158037573,
    1.0, -0.1055613458, -0.0638541728,
    1.0, -0.0894841775, -1.2914855480
  )) * color;
  lms = lms * lms * lms;
  return transpose(mat3(
    4.0767416621, -3.3077115913, 0.2309699292,
    -1.2684380046, 2.6097574011, -0.3413193965,
    -0.0041960863, -0.7034186147, 1.7076147010
  )) * lms;
}

vec3 gamutMap(vec3 lab) {
  vec3 candidate = oklabToLinear(lab);
  for (int index = 0; index < 6; index += 1) {
    if (all(greaterThanEqual(candidate, vec3(0.0))) && all(lessThanEqual(candidate, vec3(1.0)))) break;
    lab.yz *= 0.82;
    candidate = oklabToLinear(lab);
  }
  return clamp(candidate, 0.0, 1.0);
}

float blushEllipse(vec2 uv, vec4 ellipse, float angle) {
  if (ellipse.z <= 0.0 || ellipse.w <= 0.0) return 0.0;
  vec2 point = uv - ellipse.xy;
  float c = cos(angle);
  float s = sin(angle);
  vec2 local = vec2(c * point.x + s * point.y, -s * point.x + c * point.y);
  float radius = dot(local / ellipse.zw, local / ellipse.zw);
  return exp(-2.5 * radius);
}

void main() {
  vec2 uv = vec2(uMirror ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec3 sourceSrgb = texture(uSource, uv).rgb;
  vec3 mappedHair = uCurrentToHair * vec3(uv, 1.0);
  vec2 hairUv = mappedHair.xy / max(mappedHair.z, 0.00001);
  float hairUvValid = step(0.0, hairUv.x) * step(hairUv.x, 1.0) * step(0.0, hairUv.y) * step(hairUv.y, 1.0);
  hairUv = clamp(hairUv, 0.0, 1.0);
  float rawMask = texture(uRawMask, hairUv).r * hairUvValid;
  float refinedMask = texture(uRefinedMask, hairUv).r * hairUvValid;
  vec3 mappedFace = uCurrentToFace * vec3(uv, 1.0);
  vec2 faceUv = mappedFace.xy / max(mappedFace.z, 0.00001);
  float faceUvValid = step(0.0, faceUv.x) * step(faceUv.x, 1.0) * step(0.0, faceUv.y) * step(faceUv.y, 1.0);
  faceUv = clamp(faceUv, 0.0, 1.0);
  if (uView == 0) {
    outColor = vec4(sourceSrgb, 1.0);
    return;
  }
  if (uView == 1) {
    outColor = vec4(vec3(rawMask), 1.0);
    return;
  }
  if (uView == 2) {
    outColor = vec4(vec3(refinedMask), 1.0);
    return;
  }
  if (uSplitCompare && vUv.x < 0.5) {
    outColor = uOverlayOnly ? vec4(0.0) : vec4(sourceSrgb, 1.0);
    return;
  }

  vec3 linear = srgbToLinear(sourceSrgb);
  vec3 overlayPremultiplied = vec3(0.0);
  float overlayAlpha = 0.0;
  float luminance = max(dot(linear, vec3(0.2126, 0.7152, 0.0722)), 0.003);
  float edge = mix(uEdgeStrength, 1.0, smoothstep(0.4, 0.9, refinedMask));
  float hairAlpha = clamp(refinedMask * edge * uHairStrength * uHairFreshness, 0.0, 1.0);
  if (hairAlpha > 0.001) {
    float logLuminance = log2(luminance);
    float base = texture(uLargeLuma, hairUv).r * 16.0 - 12.0;
    float detail = clamp(logLuminance - base, -uDetailLimit, uDetailLimit);
    float newLogLuminance = base + uHairLiftStops + uDetailKeep * detail;
    vec3 scaled = linear * (exp2(newLogLuminance) / luminance);
    vec3 hairLab = linearToOklab(max(scaled, vec3(0.0)));
    vec3 targetLab = linearToOklab(srgbToLinear(uHairTarget));
    float highlight = smoothstep(0.55, 1.0, hairLab.x) * uHighlightProtect;
    hairLab.yz = mix(hairLab.yz, targetLab.yz, uHairChromaMix * (1.0 - highlight));
    vec3 hairLinear = gamutMap(hairLab);
    overlayPremultiplied = hairLinear * hairAlpha + overlayPremultiplied * (1.0 - hairAlpha);
    overlayAlpha = hairAlpha + overlayAlpha * (1.0 - hairAlpha);
    linear = mix(linear, hairLinear, hairAlpha);
  }

  vec2 eyeMask = texture(uEyeMask, faceUv).rg * faceUvValid;
  float lipShape = texture(uLipMask, faceUv).r * faceUvValid;
  vec2 faceLocal = (faceUv - uFaceEllipse.xy) / max(uFaceEllipse.zw, vec2(0.0001));
  float faceClip = 1.0 - smoothstep(0.82, 1.05, dot(faceLocal, faceLocal));
  vec2 foundationUv = faceLocal * 0.5 + 0.5;
  float foundationAsset = texture(uFoundationMask, foundationUv).r;
  float foundationAlpha = clamp(foundationAsset * faceClip * (1.0 - refinedMask * 0.9) * uFoundationStrength * uFaceFreshness, 0.0, 0.38);
  if (foundationAlpha > 0.001) {
    vec3 foundationLab = linearToOklab(linear);
    vec3 foundationTarget = linearToOklab(srgbToLinear(uFoundationTarget));
    foundationLab.x = mix(foundationLab.x, foundationTarget.x, 0.16);
    foundationLab.yz = mix(foundationLab.yz, foundationTarget.yz, 0.28);
    vec3 foundationLinear = gamutMap(foundationLab);
    overlayPremultiplied = foundationLinear * foundationAlpha + overlayPremultiplied * (1.0 - foundationAlpha);
    overlayAlpha = foundationAlpha + overlayAlpha * (1.0 - foundationAlpha);
    linear = mix(linear, foundationLinear, foundationAlpha);
  }

  float eyeHairClip = 1.0 - refinedMask * 0.9;
  float eyeShadowAlpha = clamp(eyeMask.r * eyeHairClip * uEyeShadowStrength * uFaceFreshness, 0.0, 0.5);
  if (eyeShadowAlpha > 0.001) {
    vec3 eyeLab = linearToOklab(linear);
    vec3 eyeTarget = linearToOklab(srgbToLinear(uEyeTarget));
    eyeLab.yz = mix(eyeLab.yz, eyeTarget.yz, 0.72);
    vec3 eyeLinear = gamutMap(eyeLab);
    overlayPremultiplied = eyeLinear * eyeShadowAlpha + overlayPremultiplied * (1.0 - eyeShadowAlpha);
    overlayAlpha = eyeShadowAlpha + overlayAlpha * (1.0 - eyeShadowAlpha);
    linear = mix(linear, eyeLinear, eyeShadowAlpha);
  }
  float eyeLinerAlpha = clamp(eyeMask.g * eyeHairClip * uEyeLinerStrength * uFaceFreshness, 0.0, 0.72);
  if (eyeLinerAlpha > 0.001) {
    vec3 linerLinear = srgbToLinear(uLinerTarget);
    overlayPremultiplied = linerLinear * eyeLinerAlpha + overlayPremultiplied * (1.0 - eyeLinerAlpha);
    overlayAlpha = eyeLinerAlpha + overlayAlpha * (1.0 - eyeLinerAlpha);
    linear = mix(linear, linerLinear, eyeLinerAlpha);
  }

  float lipMask = lipShape * uLipStrength * uFaceFreshness;
  if (lipMask > 0.001) {
    vec3 lipLab = linearToOklab(linear);
    vec3 lipTarget = linearToOklab(srgbToLinear(uLipTarget));
    float lipChroma = uLipFinish == 2 ? 0.9 : 0.82;
    lipLab.yz = mix(lipLab.yz, lipTarget.yz, lipChroma);
    if (uLipFinish == 1) lipLab.x = clamp(lipLab.x + (lipLab.x - 0.5) * 0.08, 0.0, 1.0);
    if (uLipFinish == 2) lipLab.x = mix(lipLab.x, lipTarget.x, 0.08);
    if (uLipFinish == 3) lipLab.x = clamp(lipLab.x + 0.04 + smoothstep(0.45, 0.8, luminance) * 0.08, 0.0, 1.0);
    float lipAlpha = clamp(lipMask, 0.0, 1.0);
    vec3 lipLinear = gamutMap(lipLab);
    overlayPremultiplied = lipLinear * lipAlpha + overlayPremultiplied * (1.0 - lipAlpha);
    overlayAlpha = lipAlpha + overlayAlpha * (1.0 - lipAlpha);
    linear = mix(linear, lipLinear, lipAlpha);
  }

  float blushMask = max(blushEllipse(faceUv, uBlushLeft, uBlushAngle), blushEllipse(faceUv, uBlushRight, uBlushAngle)) * faceUvValid;
  blushMask *= faceClip * (1.0 - refinedMask * 0.85) * (1.0 - lipMask) * uBlushStrength * uFaceFreshness;
  if (blushMask > 0.001) {
    vec3 blushLab = linearToOklab(linear);
    vec3 blushTarget = linearToOklab(srgbToLinear(uBlushTarget));
    blushLab.yz = mix(blushLab.yz, blushTarget.yz, 0.55);
    float blushAlpha = clamp(blushMask, 0.0, 0.45);
    vec3 blushLinear = gamutMap(blushLab);
    overlayPremultiplied = blushLinear * blushAlpha + overlayPremultiplied * (1.0 - blushAlpha);
    overlayAlpha = blushAlpha + overlayAlpha * (1.0 - blushAlpha);
    linear = mix(linear, blushLinear, blushAlpha);
  }

  if (uOverlayOnly) {
    vec3 overlayLinear = overlayPremultiplied / max(overlayAlpha, 0.00001);
    outColor = vec4(linearToSrgb(overlayLinear), overlayAlpha);
  } else {
    outColor = vec4(linearToSrgb(linear), 1.0);
  }
}
`;
