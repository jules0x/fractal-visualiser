/** WebGL2 plumbing: program, uniforms, reference-orbit texture, palette LUT. */

import {
  FRAGMENT_SHADER,
  VERTEX_SHADER,
  MODE_MANDELBROT,
  MODE_JULIA,
  MODE_NEWTON,
  MODE_MANDELBROT_POWER,
} from './shaders.ts';
import {
  VISUAL_FRAGMENT_SHADER,
  MODE_FLOW,
  MODE_PLASMA,
  MODE_KALEIDO,
  MODE_MANDALA,
  MODE_TUNNEL,
  MODE_CYBERGRID,
  MODE_COSMIC,
  MODE_NEBULA,
  MODE_SPIRAL,
} from './visualShaders.ts';
import { buildPaletteLut, paletteById } from './palettes.ts';
import type { ReferenceOrbit } from '../core/reference.ts';

export const SHADER_MODE = {
  mandelbrot: MODE_MANDELBROT,
  julia: MODE_JULIA,
  newton: MODE_NEWTON,
  mandelbrotPower: MODE_MANDELBROT_POWER,
} as const;

export const VISUAL_SHADER_MODE = {
  flow: MODE_FLOW,
  plasma: MODE_PLASMA,
  kaleido: MODE_KALEIDO,
  mandala: MODE_MANDALA,
  cosmic: MODE_COSMIC,
  tunnel: MODE_TUNNEL,
  cybergrid: MODE_CYBERGRID,
  nebula: MODE_NEBULA,
  spiral: MODE_SPIRAL,
} as const;

/** Reference orbits are laid out row-major in a texture this wide. */
const REF_TEX_WIDTH = 2048;

/**
 * Two layouts, chosen per orbit.
 *
 * The escape-time modes want `Z` and nothing else, packed as tightly as
 * possible: `perturbEscape` does one texel fetch per iteration per pixel, and
 * rebasing puts every lane of a warp at a different index, so those reads are
 * scattered and the orbit's byte stride is what decides how many points fit in
 * a cache line. Two floats per point is eight bytes and eight points to a line.
 *
 * Newton needs four values per point, so it gets two RGBA texels — but its
 * orbit settles in tens of points rather than thousands, which stays resident
 * whatever the stride. Making both modes share the wide layout for the sake of
 * one indexing expression cost Mandelbrot four times the bandwidth on its
 * hottest read, for data it never looks at.
 */
const NARROW = { stride: 1, internal: 'RG32F', format: 'RG' } as const;
const WIDE = { stride: 2, internal: 'RGBA32F', format: 'RGBA' } as const;

export interface DrawParams {
  shaderMode: number;
  maxIter: number;
  antialias: boolean;
  /** Perturbation. */
  scaleMant: number;
  scaleExp: number;
  /** Where the reference orbit was seeded, in normalised view units. */
  refShift: [number, number];
  /** Direct path. */
  centerHi: [number, number];
  centerLo: [number, number];
  directScale: number;
  power: number;
  newtonPower: number;
  relaxation: number;
  /** Colour. */
  colorDensity: number;
  flowPhase: number;
  /** Continuous hue rotation, in turns — see u_hueSpin in the shaders. */
  hueSpin: number;
}

export interface DrawVisualParams {
  vmode: number;
  time: number;
  speed: number;
  warp: number;
  complexity: number;
  symmetry: number;
  zoom: number;
  colorDensity: number;
  flowPhase: number;
  /** Continuous hue rotation, in turns — see u_hueSpin in the shaders. */
  hueSpin: number;
  /** Future audio hook — silent (0) until a source is wired up. */
  audioLevel: number;
  audioBands: [number, number, number];
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  private visualProgram: WebGLProgram;
  private visualUniforms: Record<string, WebGLUniformLocation | null> = {};

  private refTex: WebGLTexture;
  private refLen = 0;
  private refTexH = 0;
  private refStride: number = NARROW.stride;
  private refZ0: [number, number] = [0, 0];

  private paletteTex: WebGLTexture;
  private paletteId = '';

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // so Export can read the canvas back
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is required — this browser or GPU does not provide it.');
    this.gl = gl;

    this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    const names = [
      'u_resolution', 'u_mode', 'u_maxIter', 'u_aa',
      'u_ref', 'u_refLen', 'u_refTexW', 'u_z0', 'u_scaleExp', 'u_scaleMant', 'u_refShift', 'u_refStride',
      'u_centerHi', 'u_centerLo', 'u_directScale',
      'u_power', 'u_newtonPower', 'u_relaxation',
      'u_palette', 'u_colorDensity', 'u_flowPhase', 'u_hueSpin',
    ];
    for (const n of names) this.uniforms[n] = gl.getUniformLocation(this.program, n);

    // Full-screen triangle pair.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    // Location 0 is pinned by `layout(location = 0)` in VERTEX_SHADER, which
    // both programs share, so this one VAO/attribute serves either program.
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.visualProgram = linkProgram(gl, VERTEX_SHADER, VISUAL_FRAGMENT_SHADER);
    gl.useProgram(this.visualProgram);
    const visualNames = [
      'u_resolution', 'u_vmode', 'u_time',
      'u_speed', 'u_warp', 'u_complexity', 'u_symmetry', 'u_zoom',
      'u_palette', 'u_colorDensity', 'u_flowPhase', 'u_hueSpin',
      'u_audioLevel', 'u_audioBands',
    ];
    for (const n of visualNames) this.visualUniforms[n] = gl.getUniformLocation(this.visualProgram, n);
    gl.uniform1i(this.visualUniforms['u_palette'], 1);
    gl.useProgram(this.program); // back to the fractal program for the setup below

    this.refTex = createTexture(gl, gl.NEAREST, gl.CLAMP_TO_EDGE);
    this.paletteTex = createTexture(gl, gl.LINEAR, gl.REPEAT);

    // Give both samplers complete textures up front. The direct render paths
    // never read the reference, but a sampler bound to an incomplete texture is
    // undefined behaviour and some drivers take it badly.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));

    gl.uniform1i(this.uniforms['u_ref'], 0);
    gl.uniform1i(this.uniforms['u_palette'], 1);
  }

  /** Largest square render target this context will accept. */
  get maxDimension(): number {
    return Math.min(
      this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number,
      (this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS) as Int32Array)[0],
    );
  }

  /** Upload a freshly computed reference orbit. */
  setReference(orbit: ReferenceOrbit): void {
    const gl = this.gl;
    const len = Math.max(1, orbit.length);
    const wide = orbit.aux !== undefined || orbit.steps !== undefined;
    const layout = wide ? WIDE : NARROW;
    const channels = wide ? 4 : 2;
    const h = Math.max(1, Math.ceil((len * layout.stride) / REF_TEX_WIDTH));

    // Pad to a full rectangle; the shader never reads past refLen.
    const padded = new Float32Array(REF_TEX_WIDTH * h * channels);
    for (let i = 0; i < len; i++) {
      const at = i * layout.stride * channels;
      padded[at] = orbit.data[i * 2];
      padded[at + 1] = orbit.data[i * 2 + 1];
      if (orbit.steps) {
        padded[at + 2] = orbit.steps[i * 2];
        padded[at + 3] = orbit.steps[i * 2 + 1];
      }
      if (orbit.aux) padded.set(orbit.aux.subarray(i * 4, i * 4 + 4), at + 4);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl[layout.internal],
      REF_TEX_WIDTH,
      h,
      0,
      gl[layout.format],
      gl.FLOAT,
      padded,
    );

    this.refLen = len;
    this.refTexH = h;
    this.refStride = layout.stride;
    this.refZ0 = [orbit.z0x, orbit.z0y];
  }

  setPalette(id: string): void {
    if (id === this.paletteId) return;
    const gl = this.gl;
    const lut = buildPaletteLut(paletteById(id), 1024);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
    this.paletteId = id;
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    gl.canvas.width = width;
    gl.canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  draw(p: DrawParams): void {
    const gl = this.gl;
    const u = this.uniforms;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.refTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.uniform2f(u['u_resolution'], gl.canvas.width, gl.canvas.height);
    gl.uniform1i(u['u_mode'], p.shaderMode);
    gl.uniform1i(u['u_maxIter'], p.maxIter);
    gl.uniform1i(u['u_aa'], p.antialias ? 2 : 1);

    gl.uniform1i(u['u_refLen'], this.refLen);
    gl.uniform1i(u['u_refTexW'], REF_TEX_WIDTH);
    gl.uniform1i(u['u_refStride'], this.refStride);
    gl.uniform2f(u['u_z0'], this.refZ0[0], this.refZ0[1]);
    gl.uniform1i(u['u_scaleExp'], p.scaleExp);
    gl.uniform1f(u['u_scaleMant'], p.scaleMant);
    gl.uniform2f(u['u_refShift'], p.refShift[0], p.refShift[1]);

    gl.uniform2f(u['u_centerHi'], p.centerHi[0], p.centerHi[1]);
    gl.uniform2f(u['u_centerLo'], p.centerLo[0], p.centerLo[1]);
    gl.uniform1f(u['u_directScale'], p.directScale);
    gl.uniform1f(u['u_power'], p.power);
    gl.uniform1f(u['u_newtonPower'], p.newtonPower);
    gl.uniform1f(u['u_relaxation'], p.relaxation);

    gl.uniform1f(u['u_colorDensity'], p.colorDensity);
    gl.uniform1f(u['u_flowPhase'], p.flowPhase);
    gl.uniform1f(u['u_hueSpin'], p.hueSpin);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /** Draw one frame of the generative visualizer engine — no camera, no reference orbit. */
  drawVisual(p: DrawVisualParams): void {
    const gl = this.gl;
    const u = this.visualUniforms;

    gl.useProgram(this.visualProgram);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    gl.uniform2f(u['u_resolution'], gl.canvas.width, gl.canvas.height);
    gl.uniform1i(u['u_vmode'], p.vmode);
    gl.uniform1f(u['u_time'], p.time);
    gl.uniform1f(u['u_speed'], p.speed);
    gl.uniform1f(u['u_warp'], p.warp);
    gl.uniform1f(u['u_complexity'], p.complexity);
    gl.uniform1f(u['u_symmetry'], p.symmetry);
    gl.uniform1f(u['u_zoom'], p.zoom);
    gl.uniform1f(u['u_colorDensity'], p.colorDensity);
    gl.uniform1f(u['u_flowPhase'], p.flowPhase);
    gl.uniform1f(u['u_hueSpin'], p.hueSpin);
    gl.uniform1f(u['u_audioLevel'], p.audioLevel);
    gl.uniform3f(u['u_audioBands'], p.audioBands[0], p.audioBands[1], p.audioBands[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  get referenceRows(): number {
    return this.refTexH;
  }
}

function createTexture(
  gl: WebGL2RenderingContext,
  filter: number,
  wrap: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Failed to create shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'unknown error';
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed:\n${log}`);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    throw new Error(`Program link failed:\n${log}`);
  }
  return program;
}
