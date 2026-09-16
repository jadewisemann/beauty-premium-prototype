import type { HairSnapshot, LookRecipe } from './contracts';
import { compositeFragmentShader, fullscreenVertexShader, luminanceFragmentShader, refineMaskFragmentShader, temporalMaskFragmentShader } from './shaders';
import type { Mat3 } from './contracts';
import { identityMat3, invertMat3, multiplyMat3 } from './transforms';

export type RenderView = 'original' | 'raw-mask' | 'refined-mask' | 'final';

export interface BlushEllipse {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

export interface BlushGeometry {
  left: BlushEllipse | null;
  right: BlushEllipse | null;
  angle: number;
  face: BlushEllipse;
}

export interface RenderOptions {
  view: RenderView;
  mirror: boolean;
  recipe: LookRecipe;
  hairFreshness: number;
  faceFreshness: number;
  blush: BlushGeometry | null;
  splitCompare?: boolean;
}

export interface RendererMetrics {
  drawCalls: number;
  textureBytes: number;
  budgetExceeded: boolean;
  contextLosses: number;
  hairFreshness: number;
  faceFreshness: number;
}

interface TextureResource {
  texture: WebGLTexture;
  width: number;
  height: number;
  bytesPerPixel: number;
}

const LIVE_TEXTURE_BUDGET = 32 * 1024 * 1024;

/** A deliberately small WebGL2 owner. No GL handles leave this class. */
export class BeautyRenderer {
  private gl: WebGL2RenderingContext;
  private refineProgram: WebGLProgram;
  private lumaProgram: WebGLProgram;
  private temporalProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private source: TextureResource;
  private rawMask: TextureResource;
  private refinedMask: TextureResource;
  private stableMasks: [TextureResource, TextureResource];
  private largeLuma: TextureResource;
  private lipMask: TextureResource;
  private refineFramebuffer: WebGLFramebuffer;
  private lumaFramebuffer: WebGLFramebuffer;
  private temporalFramebuffer: WebGLFramebuffer;
  private sourceWidth = 1;
  private sourceHeight = 1;
  private disposed = false;
  private lost = false;
  private hairDirty = true;
  private sourceDirty = true;
  private drawCalls = 0;
  private contextLosses = 0;
  private stableIndex = 0;
  private hasMaskHistory = false;
  private previousHair: HairSnapshot | null = null;
  private temporalWeight = 0;
  private currentToPrevious: Mat3 = identityMat3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onContextRestored?: () => void,
    private readonly onContextLost?: () => void,
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.gl = gl;
    this.refineProgram = createProgram(gl, fullscreenVertexShader, refineMaskFragmentShader);
    this.lumaProgram = createProgram(gl, fullscreenVertexShader, luminanceFragmentShader);
    this.temporalProgram = createProgram(gl, fullscreenVertexShader, temporalMaskFragmentShader);
    this.compositeProgram = createProgram(gl, fullscreenVertexShader, compositeFragmentShader);
    this.vao = must(gl.createVertexArray(), 'vertex array');
    this.source = createTexture(gl, 1, 1, 4, [0, 0, 0, 255]);
    this.rawMask = createTexture(gl, 1, 1, 1, [0]);
    this.refinedMask = createTexture(gl, 1, 1, 4, [0, 0, 0, 255]);
    this.stableMasks = [
      createTexture(gl, 1, 1, 4, [0, 0, 0, 255]),
      createTexture(gl, 1, 1, 4, [0, 0, 0, 255]),
    ];
    this.largeLuma = createTexture(gl, 1, 1, 4, [128, 128, 128, 255]);
    this.lipMask = createTexture(gl, 1, 1, 4, [0, 0, 0, 255]);
    this.refineFramebuffer = must(gl.createFramebuffer(), 'refine framebuffer');
    this.lumaFramebuffer = must(gl.createFramebuffer(), 'luminance framebuffer');
    this.temporalFramebuffer = must(gl.createFramebuffer(), 'temporal framebuffer');
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  uploadSource(source: TexImageSource, width: number, height: number): void {
    if (this.disposed || this.lost || width < 1 || height < 1) return;
    const gl = this.gl;
    this.sourceWidth = width;
    this.sourceHeight = height;
    gl.bindTexture(gl.TEXTURE_2D, this.source.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    if (this.source.width === width && this.source.height === height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    this.source.width = width;
    this.source.height = height;
    this.sourceDirty = true;
  }

  uploadHair(hair: HairSnapshot | null): void {
    if (this.disposed || this.lost) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.rawMask.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (hair) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, hair.width, hair.height, 0, gl.RED, gl.UNSIGNED_BYTE, hair.values);
      this.rawMask.width = hair.width;
      this.rawMask.height = hair.height;
      this.prepareTemporalBlend(hair);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
      this.rawMask.width = 1;
      this.rawMask.height = 1;
      this.previousHair = null;
      this.hasMaskHistory = false;
      this.temporalWeight = 0;
    }
    this.hairDirty = true;
  }

  uploadLipMask(mask: TexImageSource | null, width = 1, height = 1): void {
    if (this.disposed || this.lost) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lipMask.texture);
    if (mask && this.lipMask.width === width && this.lipMask.height === height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    } else if (mask) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    }
    this.lipMask.width = mask ? width : 1;
    this.lipMask.height = mask ? height : 1;
  }

  render(options: RenderOptions): RendererMetrics {
    if (this.disposed || this.lost) return this.metrics();
    this.drawCalls = 0;
    if (this.hairDirty) this.runMaskRefinement();
    if (this.hairDirty || this.sourceDirty) this.runLargeLuminance();
    this.hairDirty = false;
    this.sourceDirty = false;
    this.runComposite(options);
    return { ...this.metrics(), hairFreshness: options.hairFreshness, faceFreshness: options.faceFreshness };
  }

  metrics(): RendererMetrics {
    const textureBytes = [this.source, this.rawMask, this.refinedMask, ...this.stableMasks, this.largeLuma, this.lipMask]
      .reduce((sum, resource) => sum + resource.width * resource.height * resource.bytesPerPixel, 0);
    return { drawCalls: this.drawCalls, textureBytes, budgetExceeded: textureBytes > LIVE_TEXTURE_BUDGET, contextLosses: this.contextLosses, hairFreshness: 0, faceFreshness: 0 };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    const gl = this.gl;
    [this.source, this.rawMask, this.refinedMask, ...this.stableMasks, this.largeLuma, this.lipMask].forEach(({ texture }) => gl.deleteTexture(texture));
    gl.deleteFramebuffer(this.refineFramebuffer);
    gl.deleteFramebuffer(this.lumaFramebuffer);
    gl.deleteFramebuffer(this.temporalFramebuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.refineProgram);
    gl.deleteProgram(this.lumaProgram);
    gl.deleteProgram(this.temporalProgram);
    gl.deleteProgram(this.compositeProgram);
  }

  private runMaskRefinement(): void {
    const gl = this.gl;
    resizeTexture(gl, this.refinedMask, this.rawMask.width, this.rawMask.height, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.refineFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.refinedMask.texture, 0);
    assertFramebuffer(gl, 'mask refinement');
    gl.viewport(0, 0, this.refinedMask.width, this.refinedMask.height);
    gl.useProgram(this.refineProgram);
    this.bindCommonGeometry();
    bindTexture(gl, this.refineProgram, 'uSource', this.source.texture, 0);
    bindTexture(gl, this.refineProgram, 'uRawMask', this.rawMask.texture, 1);
    uniform2f(gl, this.refineProgram, 'uTexel', 1 / this.rawMask.width, 1 / this.rawMask.height);
    uniform1f(gl, this.refineProgram, 'uSigmaColor', 0.1);
    uniform1f(gl, this.refineProgram, 'uLow', 0.15);
    uniform1f(gl, this.refineProgram, 'uHigh', 0.85);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls += 1;
    this.runTemporalMask();
  }

  private runTemporalMask(): void {
    const gl = this.gl;
    const nextIndex = this.stableIndex === 0 ? 1 : 0;
    const output = this.stableMasks[nextIndex];
    const previous = this.stableMasks[this.stableIndex];
    const resized = output.width !== this.refinedMask.width || output.height !== this.refinedMask.height;
    resizeTexture(gl, output, this.refinedMask.width, this.refinedMask.height, 4);
    if (resized) this.hasMaskHistory = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.temporalFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.texture, 0);
    assertFramebuffer(gl, 'temporal mask');
    gl.viewport(0, 0, output.width, output.height);
    gl.useProgram(this.temporalProgram);
    this.bindCommonGeometry();
    bindTexture(gl, this.temporalProgram, 'uCurrent', this.refinedMask.texture, 0);
    bindTexture(gl, this.temporalProgram, 'uPrevious', previous.texture, 1);
    uniformMatrix3(gl, this.temporalProgram, 'uCurrentToPrevious', this.currentToPrevious);
    uniform1f(gl, this.temporalProgram, 'uHistoryWeight', this.hasMaskHistory ? this.temporalWeight : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls += 1;
    this.stableIndex = nextIndex;
    this.hasMaskHistory = true;
  }

  private runLargeLuminance(): void {
    const gl = this.gl;
    const scale = Math.min(1, 256 / Math.max(this.sourceWidth, this.sourceHeight));
    const width = Math.max(1, Math.round(this.sourceWidth * scale));
    const height = Math.max(1, Math.round(this.sourceHeight * scale));
    resizeTexture(gl, this.largeLuma, width, height, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lumaFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.largeLuma.texture, 0);
    assertFramebuffer(gl, 'large luminance');
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.lumaProgram);
    this.bindCommonGeometry();
    bindTexture(gl, this.lumaProgram, 'uSource', this.source.texture, 0);
    bindTexture(gl, this.lumaProgram, 'uMask', this.stableMasks[this.stableIndex].texture, 1);
    uniform2f(gl, this.lumaProgram, 'uTexel', 1 / width, 1 / height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls += 1;
  }

  private runComposite(options: RenderOptions): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.compositeProgram);
    this.bindCommonGeometry();
    bindTexture(gl, this.compositeProgram, 'uSource', this.source.texture, 0);
    bindTexture(gl, this.compositeProgram, 'uRawMask', this.rawMask.texture, 1);
    bindTexture(gl, this.compositeProgram, 'uRefinedMask', this.stableMasks[this.stableIndex].texture, 2);
    bindTexture(gl, this.compositeProgram, 'uLargeLuma', this.largeLuma.texture, 3);
    bindTexture(gl, this.compositeProgram, 'uLipMask', this.lipMask.texture, 4);
    const recipe = options.recipe;
    uniform1i(gl, this.compositeProgram, 'uView', viewIndex(options.view));
    uniform1i(gl, this.compositeProgram, 'uSplitCompare', options.splitCompare ? 1 : 0);
    uniform1i(gl, this.compositeProgram, 'uMirror', options.mirror ? 1 : 0);
    uniform3f(gl, this.compositeProgram, 'uHairTarget', hexToRgb(recipe.hair.targetColor));
    uniform3f(gl, this.compositeProgram, 'uLipTarget', hexToRgb(recipe.lip.targetColor));
    uniform3f(gl, this.compositeProgram, 'uBlushTarget', hexToRgb(recipe.blush.targetColor));
    uniform1f(gl, this.compositeProgram, 'uHairStrength', recipe.hair.enabled ? recipe.hair.strength : 0);
    uniform1f(gl, this.compositeProgram, 'uHairChromaMix', recipe.hair.chromaMix);
    uniform1f(gl, this.compositeProgram, 'uHairLiftStops', recipe.hair.liftStops);
    uniform1f(gl, this.compositeProgram, 'uDetailKeep', recipe.hair.detailKeep);
    uniform1f(gl, this.compositeProgram, 'uDetailLimit', recipe.hair.detailLimit);
    uniform1f(gl, this.compositeProgram, 'uHighlightProtect', recipe.hair.highlightProtect);
    uniform1f(gl, this.compositeProgram, 'uEdgeStrength', recipe.hair.edgeStrength);
    uniform1f(gl, this.compositeProgram, 'uHairFreshness', options.hairFreshness);
    uniform1f(gl, this.compositeProgram, 'uLipStrength', recipe.lip.enabled ? recipe.lip.strength : 0);
    uniform1f(gl, this.compositeProgram, 'uLipSatin', recipe.lip.material === 'satin' ? 1 : 0);
    uniform1f(gl, this.compositeProgram, 'uFaceFreshness', options.faceFreshness);
    uniform1f(gl, this.compositeProgram, 'uBlushStrength', recipe.blush.enabled ? recipe.blush.strength : 0);
    setEllipse(gl, this.compositeProgram, 'uBlushLeft', options.blush?.left ?? null);
    setEllipse(gl, this.compositeProgram, 'uBlushRight', options.blush?.right ?? null);
    setEllipse(gl, this.compositeProgram, 'uFaceEllipse', options.blush?.face ?? null);
    uniform1f(gl, this.compositeProgram, 'uBlushAngle', options.blush?.angle ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls += 1;
  }

  private bindCommonGeometry(): void {
    this.gl.bindVertexArray(this.vao);
    this.gl.disable(this.gl.BLEND);
    this.gl.disable(this.gl.DEPTH_TEST);
  }

  private prepareTemporalBlend(hair: HairSnapshot): void {
    const previous = this.previousHair;
    this.temporalWeight = 0;
    this.currentToPrevious = identityMat3();
    if (previous && hair.frame.generation === previous.frame.generation && hair.frame.frameId > previous.frame.frameId && hair.poseAtSource && previous.poseAtSource) {
      const deltaMs = Math.max(0, hair.frame.acquiredMs - previous.frame.acquiredMs);
      this.temporalWeight = Math.min(0.8, Math.exp(-deltaMs / 100));
      try {
        this.currentToPrevious = multiplyMat3(invertMat3(previous.poseAtSource), hair.poseAtSource);
      } catch {
        this.temporalWeight = 0;
      }
    } else if (previous) {
      this.hasMaskHistory = false;
    }
    this.previousHair = hair;
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.contextLosses += 1;
    this.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    this.lost = false;
    this.onContextRestored?.();
  };
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = must(gl.createProgram(), 'program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`WebGL program link failed: ${message}`);
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = must(gl.createShader(type), 'shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`WebGL shader compile failed: ${message}`);
  }
  return shader;
}

function createTexture(gl: WebGL2RenderingContext, width: number, height: number, bytesPerPixel: number, data: number[]): TextureResource {
  const resource = { texture: must(gl.createTexture(), 'texture'), width, height, bytesPerPixel };
  gl.bindTexture(gl.TEXTURE_2D, resource.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (bytesPerPixel === 1) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(data));
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data));
  }
  return resource;
}

function resizeTexture(gl: WebGL2RenderingContext, resource: TextureResource, width: number, height: number, bytesPerPixel: number): void {
  if (resource.width === width && resource.height === height && resource.bytesPerPixel === bytesPerPixel) return;
  resource.width = width;
  resource.height = height;
  resource.bytesPerPixel = bytesPerPixel;
  gl.bindTexture(gl.TEXTURE_2D, resource.texture);
  if (bytesPerPixel === 1) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

function bindTexture(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, texture: WebGLTexture, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  uniform1i(gl, program, name, unit);
}

function uniform1i(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1i(location, value);
}

function uniform1f(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1f(location, value);
}

function uniform2f(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, x: number, y: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform2f(location, x, y);
}

function uniform3f(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: readonly [number, number, number]): void {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform3f(location, value[0], value[1], value[2]);
}

function uniformMatrix3(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: Mat3): void {
  const location = gl.getUniformLocation(program, name);
  if (location === null) return;
  gl.uniformMatrix3fv(location, false, new Float32Array([
    value[0], value[3], value[6],
    value[1], value[4], value[7],
    value[2], value[5], value[8],
  ]));
}

function setEllipse(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, ellipse: BlushEllipse | null): void {
  const location = gl.getUniformLocation(program, name);
  if (location === null) return;
  if (!ellipse) gl.uniform4f(location, 0, 0, 0, 0);
  else gl.uniform4f(location, ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY);
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000';
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255) as unknown as readonly [number, number, number];
}

function viewIndex(view: RenderView): number {
  return view === 'original' ? 0 : view === 'raw-mask' ? 1 : view === 'refined-mask' ? 2 : 3;
}

function assertFramebuffer(gl: WebGL2RenderingContext, label: string): void {
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`${label} framebuffer incomplete: ${status}`);
}

function must<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Could not create WebGL ${label}`);
  return value;
}
