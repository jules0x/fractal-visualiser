/**
 * Palettes as perceptually-even OKLCH ramps.
 *
 * Each palette is four OKLCH stops that loop back to the first, so the flow
 * animation can scroll the ramp forever without a seam — and because the
 * interpolation happens in OKLCH rather than sRGB, the midpoints never dip
 * through the desaturated grey that a naive RGB gradient produces.
 *
 * The ramp is baked to a 1024-entry sRGB lookup texture once at load; the
 * shader just samples it.
 */

export interface OklchStop {
  /** Perceptual lightness, 0..1 */
  l: number;
  /** Chroma, 0..~0.37 */
  c: number;
  /** Hue angle in degrees */
  h: number;
}

export interface Palette {
  id: string;
  name: string;
  /** Four stops; the ramp loops from the last back to the first. */
  stops: readonly OklchStop[];
}

const s = (l: number, c: number, h: number): OklchStop => ({ l, c, h });

export const PALETTES: readonly Palette[] = [
  {
    id: 'aurora',
    name: 'Aurora Violet',
    stops: [s(0.18, 0.14, 280), s(0.45, 0.2, 300), s(0.68, 0.18, 330), s(0.85, 0.1, 300)],
  },
  {
    id: 'solar',
    name: 'Solar Flare',
    stops: [s(0.16, 0.13, 25), s(0.42, 0.19, 40), s(0.68, 0.18, 70), s(0.9, 0.1, 90)],
  },
  {
    id: 'cyber',
    name: 'Neon Cyber',
    stops: [s(0.2, 0.2, 330), s(0.42, 0.22, 300), s(0.62, 0.2, 250), s(0.9, 0.08, 220)],
  },
  {
    id: 'toxic',
    name: 'Toxic Bloom',
    stops: [s(0.15, 0.1, 150), s(0.55, 0.24, 135), s(0.55, 0.24, 340), s(0.75, 0.2, 350)],
  },
  {
    // Hues a quarter-turn apart, so the short-way interpolation walks the wheel
    // once and the wrap from the last stop back to the first closes the circle
    // rather than doubling back through the colours it just passed.
    id: 'rainbow',
    name: 'Rainbow',
    stops: [s(0.68, 0.2, 30), s(0.8, 0.18, 120), s(0.62, 0.16, 210), s(0.55, 0.22, 300)],
  },
  {
    id: 'glacier',
    name: 'Glacier',
    stops: [s(0.16, 0.1, 260), s(0.42, 0.15, 245), s(0.7, 0.12, 215), s(0.95, 0.03, 210)],
  },
  {
    id: 'orchid',
    name: 'Orchid Dusk',
    stops: [s(0.2, 0.14, 320), s(0.45, 0.2, 350), s(0.65, 0.19, 25), s(0.85, 0.1, 55)],
  },
  {
    // The Ultra Fractal default, the one most people picture when they picture a
    // Mandelbrot: navy, blue, white, gold.
    id: 'ultra',
    name: 'Ultra Fractal',
    stops: [s(0.18, 0.13, 265), s(0.55, 0.15, 255), s(0.98, 0.02, 200), s(0.79, 0.16, 70)],
  },
  {
    id: 'fire',
    name: 'Fire',
    stops: [s(0.1, 0.06, 30), s(0.42, 0.2, 28), s(0.72, 0.18, 65), s(0.97, 0.04, 95)],
  },
  {
    id: 'electric',
    name: 'Electric Blue',
    stops: [s(0.12, 0.08, 265), s(0.4, 0.2, 262), s(0.7, 0.16, 230), s(0.95, 0.06, 200)],
  },
  {
    id: 'hypernova',
    name: 'Hypernova',
    stops: [s(0.15, 0.16, 290), s(0.48, 0.22, 340), s(0.72, 0.23, 45), s(0.92, 0.12, 85)],
  },
  {
    id: 'matrix',
    name: 'Matrix Digital',
    stops: [s(0.12, 0.08, 140), s(0.38, 0.18, 135), s(0.68, 0.21, 125), s(0.92, 0.1, 110)],
  },
  {
    id: 'arcade',
    name: 'Arcade Retro',
    stops: [s(0.16, 0.18, 295), s(0.42, 0.2, 220), s(0.68, 0.23, 190), s(0.88, 0.18, 335)],
  },
];

export const DEFAULT_PALETTE = 'aurora';

/**
 * A palette bundled with a continuous hue-rotation rate, applied on the GPU
 * on top of whatever the LUT returns (see `u_hueSpin` in the shaders). These
 * are the "Dynamic" swatch row: picking one sets the ramp and the spin
 * together, as a single living colour scheme rather than a static one.
 *
 * Kept to three, deliberately louder than the static row: chroma is pushed
 * near the top of what each stop's lightness can hold in sRGB, and lightness
 * stays out of the near-black/near-white ends where the gamut clamp would
 * mute it back down. The static palettes are the tasteful ramps; these are
 * the ones that are supposed to look like they're plugged in.
 */
export interface DynamicPalette extends Palette {
  /** Degrees per second; negative spins the other way. */
  spin: number;
}

export const DYNAMIC_PALETTES: readonly DynamicPalette[] = [
  {
    id: 'dyn-prism',
    name: 'Prism Spin',
    spin: 55,
    stops: [s(0.72, 0.33, 25), s(0.78, 0.32, 130), s(0.62, 0.34, 250), s(0.68, 0.35, 330)],
  },
  {
    id: 'dyn-neon',
    name: 'Neon Surge',
    spin: 90,
    stops: [s(0.65, 0.3, 195), s(0.55, 0.34, 320), s(0.85, 0.28, 95), s(0.5, 0.32, 280)],
  },
  {
    id: 'dyn-solar',
    name: 'Solar Blaze',
    spin: -40,
    stops: [s(0.62, 0.3, 30), s(0.45, 0.28, 10), s(0.8, 0.24, 85), s(0.55, 0.26, 350)],
  },
];

export function paletteById(id: string): Palette {
  return (
    PALETTES.find((p) => p.id === id) ?? DYNAMIC_PALETTES.find((p) => p.id === id) ?? PALETTES[0]
  );
}

export function dynamicPaletteById(id: string): DynamicPalette | undefined {
  return DYNAMIC_PALETTES.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ *
 * OKLCH -> sRGB
 * Björn Ottosson's Oklab matrices; see https://bottosson.github.io/posts/oklab/
 * ------------------------------------------------------------------ */

/** Oklab -> linear sRGB. Components may fall outside [0,1] (out of gamut). */
export function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const sc = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * sc,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * sc,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * sc,
  ];
}

function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function inGamut([r, g, b]: [number, number, number]): boolean {
  const eps = 1e-4;
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

/**
 * Convert an OKLCH colour to 8-bit sRGB. If the colour falls outside the sRGB
 * gamut, chroma is reduced (hue and lightness held) until it fits — that keeps
 * the ramp's hue path intact instead of hard-clipping a channel, which is what
 * produces those flat posterised bands in naive gradients.
 */
export function oklchToRgb8(l: number, c: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  let lo = 0;
  let hi = c;
  let best = oklabToLinearSrgb(l, 0, 0);

  if (inGamut(oklabToLinearSrgb(l, c * Math.cos(rad), c * Math.sin(rad)))) {
    best = oklabToLinearSrgb(l, c * Math.cos(rad), c * Math.sin(rad));
  } else {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const trial = oklabToLinearSrgb(l, mid * Math.cos(rad), mid * Math.sin(rad));
      if (inGamut(trial)) {
        best = trial;
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }

  return best.map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)) as [
    number,
    number,
    number,
  ];
}

/** Interpolate hue the short way round the circle. */
function lerpHue(a: number, b: number, t: number): number {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return a + d * t;
}

/**
 * Bake a palette into an RGBA8 lookup table. The ramp wraps: index `size` would
 * equal index 0, which is what makes the scrolling animation seamless.
 */
export function buildPaletteLut(palette: Palette, size = 1024): Uint8Array {
  const out = new Uint8Array(size * 4);
  const stops = palette.stops;
  const n = stops.length;

  for (let i = 0; i < size; i++) {
    const t = (i / size) * n; // 0..n, wrapping
    const i0 = Math.floor(t) % n;
    const i1 = (i0 + 1) % n;
    const f = t - Math.floor(t);
    const a = stops[i0];
    const b = stops[i1];

    // Smoothstep between stops: removes the visible crease at each stop that
    // straight linear interpolation leaves behind.
    const e = f * f * (3 - 2 * f);

    const L = a.l + (b.l - a.l) * e;
    const C = a.c + (b.c - a.c) * e;
    const H = lerpHue(a.h, b.h, e);

    const [r, g, bl] = oklchToRgb8(L, C, H);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = bl;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A CSS gradient for the UI swatch, sampled from the same LUT the GPU uses. */
export function paletteCssGradient(palette: Palette, samples = 12): string {
  const lut = buildPaletteLut(palette, samples);
  const parts: string[] = [];
  for (let i = 0; i < samples; i++) {
    const hex = `#${[lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`;
    parts.push(`${hex} ${((i / (samples - 1)) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
