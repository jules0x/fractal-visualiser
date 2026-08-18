export type FractalMode = 'mandelbrot' | 'julia' | 'newton';

export const MODES: readonly FractalMode[] = ['mandelbrot', 'julia', 'newton'];

export const MODE_LABELS: Record<FractalMode, string> = {
  mandelbrot: 'Mandelbrot',
  julia: 'Julia',
  newton: 'Newton',
};

/** Which engine the canvas is currently driven by. */
export type Category = 'fractal' | 'visual';

/**
 * Generative, continuously-morphing full-screen shaders. Unlike the fractal
 * modes these have no camera — they animate on their own and are shaped by a
 * handful of sliders, which is also the surface a future audio input would
 * drive: see `u_audioLevel` / `u_audioBands` in visualShaders.ts.
 */
export type VisualMode = 'flow' | 'plasma' | 'kaleido' | 'mandala' | 'cosmic' | 'tunnel' | 'cybergrid' | 'nebula' | 'spiral';

export const VISUAL_MODES: readonly VisualMode[] = ['flow', 'plasma', 'kaleido', 'mandala', 'cosmic', 'tunnel', 'cybergrid', 'nebula', 'spiral'];

export const VISUAL_MODE_LABELS: Record<VisualMode, string> = {
  flow: 'Flow Field',
  plasma: 'Plasma',
  kaleido: 'Kaleidoscope',
  mandala: 'Mandala',
  cosmic: 'Cosmic Mandala',
  tunnel: 'Infinity Tunnel',
  cybergrid: 'Cyber Grid',
  nebula: 'Liquid Nebula',
  spiral: 'Spiral Mandala',
};

export interface ModeParams {
  /** Julia constant, as decimal strings so precision is not lost in the URL. */
  cr: string;
  ci: string;
  /** Mandelbrot exponent. 2 uses the perturbation engine; anything else falls
   *  back to the shallow direct path. */
  power: number;
  /** Newton polynomial degree in z^p - 1. */
  newtonPower: number;
  /** Relaxation factor a in z - a·f/f′. */
  relaxation: number;
}

/**
 * The sliders every visualizer shares. Not every mode reads every field —
 * Kaleidoscope and Mandala are the only ones that fold on `symmetry`, say —
 * but keeping one shape means the panel can offer a uniform control surface
 * and a future audio reactor can drive them the same way regardless of which
 * shader is live.
 */
export interface VisualParams {
  /** Overall animation speed. */
  speed: number;
  /** Domain-warp / distortion strength. */
  warp: number;
  /** Detail: noise octaves, wave layers, or blob count, depending on mode. */
  complexity: number;
  /** Mirror-fold count, used by Kaleidoscope. */
  symmetry: number;
  /** View scale: 1 is the default framing, bigger is closer in. */
  zoom: number;
}

export interface Settings {
  category: Category;
  mode: FractalMode;
  visualMode: VisualMode;
  visualParams: VisualParams;
  palette: string;
  iterations: number;
  colorDensity: number;
  flowSpeed: number;
  /**
   * Continuous hue rotation applied on top of whatever the palette LUT
   * returns, in degrees per second. Zero for the plain palettes; the
   * "Dynamic" swatch row sets this alongside `palette` as a bundle.
   */
  hueSpin: number;
  antialias: boolean;
  params: ModeParams;
}

export function defaultParams(): ModeParams {
  return {
    cr: '-0.123',
    ci: '0.745',
    power: 2,
    newtonPower: 3,
    relaxation: 1,
  };
}

export function defaultVisualParams(): VisualParams {
  return { speed: 1, warp: 1, complexity: 4, symmetry: 6, zoom: 1 };
}

export function defaultSettings(): Settings {
  return {
    category: 'fractal',
    mode: 'mandelbrot',
    visualMode: 'flow',
    visualParams: defaultVisualParams(),
    palette: 'electric',
    iterations: 600,
    colorDensity: 1,
    flowSpeed: 0,
    hueSpin: 0,
    antialias: false,
    params: defaultParams(),
  };
}
