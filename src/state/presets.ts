/**
 * Curated presets — every one a documented location, not an invented name.
 *
 * Mandelbrot coordinates come from Robert Munafo's Mu-Ency, which names each
 * feature and gives the exact centre and view radius:
 *   http://www.mrob.com/pub/muency/seahorsevalley.html
 *   http://www.mrob.com/pub/muency/largestislands.html
 *
 * Julia constants are the classical named sets as given by MathWorld:
 *   https://mathworld.wolfram.com/DouadysRabbitFractal.html   c = -0.123 + 0.745i
 *   https://mathworld.wolfram.com/SanMarcoFractal.html        c = -3/4
 *   https://mathworld.wolfram.com/SiegelDiskFractal.html      c = -0.390541 - 0.586788i
 *   https://mathworld.wolfram.com/DendriteFractal.html        c = i
 *
 * Newton entries are the canonical z^p - 1 root cases plus the standard
 * over/under-relaxed variants of the relaxed Newton method.
 */

import type { FractalMode } from './types.ts';

export interface Preset {
  name: string;
  /** One line on what it is and where the numbers come from. */
  note: string;
  /** Centre, as decimal strings so deep entries survive float64. */
  cx: string;
  cy: string;
  /** View half-height in complex units. */
  radius: number;
  iterations: number;
  params?: Partial<{
    cr: string;
    ci: string;
    power: number;
    newtonPower: number;
    relaxation: number;
  }>;
}

export const PRESETS: Record<FractalMode, readonly Preset[]> = {
  mandelbrot: [
    {
      name: 'The Whole Set',
      note: 'Standard establishing view of the full Mandelbrot set.',
      cx: '-0.5',
      cy: '0',
      radius: 1.3,
      iterations: 300,
    },
    {
      name: 'Seahorse Valley',
      note: 'Cusp between R2a and R2.1/2a — the 1985 Scientific American zoom target (Mu-Ency).',
      cx: '-0.75',
      cy: '0.1',
      radius: 0.16,
      iterations: 1200,
    },
    {
      name: 'Elephant Valley',
      note: 'The seam right of the main cardioid at x ≈ 0.25, where the spiral "trunks" appear.',
      cx: '0.275',
      cy: '0',
      radius: 0.02,
      iterations: 1500,
    },
    {
      name: 'Period-5 Island · R2F(1/3B2)S',
      note: 'Rank-6 largest island in the whole set. Mu-Ency: -0.04332 + 0.98630i @ 0.01259.',
      cx: '-0.04332',
      cy: '0.98630',
      radius: 0.01259,
      iterations: 2000,
    },
    {
      name: 'Period-29 Island · R2F(13/27B2)S',
      note: '335th largest island, inside Seahorse Valley. Mu-Ency: -0.745067 + 0.118346i @ 0.0007.',
      cx: '-0.745067',
      cy: '0.118346',
      radius: 0.0007,
      iterations: 3000,
    },
    {
      name: 'Period-1312 Island · deep',
      note: 'End of the Mu-Ency Seahorse descent, at radius 1.172e-17 — past what float64 can resolve.',
      cx: '-0.74453986035590838011',
      cy: '0.12172377389442482241',
      radius: 1.172e-17,
      iterations: 6000,
    },
  ],

  julia: [
    {
      name: "Douady's Rabbit",
      note: 'c = -0.123 + 0.745i. The period-3 rabbit, a.k.a. the dragon fractal (MathWorld).',
      cx: '0',
      cy: '0',
      radius: 1.4,
      iterations: 400,
      params: { cr: '-0.123', ci: '0.745' },
    },
    {
      name: 'San Marco',
      note: 'c = -3/4, the parabolic set Mandelbrot named for the basilica (MathWorld).',
      cx: '0',
      cy: '0',
      radius: 1.4,
      iterations: 500,
      params: { cr: '-0.75', ci: '0' },
    },
    {
      name: 'Siegel Disk',
      note: 'c = -0.390541 - 0.586788i, the classical Siegel disk example (MathWorld).',
      cx: '0',
      cy: '0',
      radius: 1.3,
      iterations: 500,
      params: { cr: '-0.390541', ci: '-0.586788' },
    },
    {
      name: 'Dendrite',
      note: 'c = i. Critically pre-periodic, so the set has empty interior (MathWorld).',
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 400,
      params: { cr: '0', ci: '1' },
    },
    {
      name: 'Basilica',
      note: 'c = -1. The period-2 hyperbolic component at the centre of the primary disk.',
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 400,
      params: { cr: '-1', ci: '0' },
    },
    {
      name: 'Airplane',
      note: 'c ≈ -1.7548776662, the real period-3 centre in the antenna of the set.',
      cx: '0',
      cy: '0',
      radius: 1.8,
      iterations: 500,
      params: { cr: '-1.7548776662', ci: '0' },
    },
  ],

  newton: [
    {
      name: 'Cube Roots · z³ − 1',
      note: "Cayley's original problem, and the fractal that came out of it.",
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 60,
      params: { newtonPower: 3, relaxation: 1 },
    },
    {
      name: 'Quartic · z⁴ − 1',
      note: 'Four roots on the unit circle; basins meet in four-fold symmetry.',
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 60,
      params: { newtonPower: 4, relaxation: 1 },
    },
    {
      name: 'Quintic · z⁵ − 1',
      note: 'Five-fold basin boundary — every boundary point touches all five basins.',
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 60,
      params: { newtonPower: 5, relaxation: 1 },
    },
    {
      name: 'Octic · z⁸ − 1',
      note: 'Eight roots; the Julia set tightens toward the unit circle.',
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 80,
      params: { newtonPower: 8, relaxation: 1 },
    },
    {
      name: 'Over-relaxed Cubic · a = 1.6',
      note: 'Relaxed Newton z − a·f/f′ with a > 1: overshoot turns the basins into spirals.',
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 90,
      params: { newtonPower: 3, relaxation: 1.6 },
    },
    {
      name: 'Under-relaxed Cubic · a = 0.5',
      note: 'a < 1 damps each step; convergence slows and the basin fringes thicken.',
      cx: '0',
      cy: '0',
      radius: 1.6,
      iterations: 120,
      params: { newtonPower: 3, relaxation: 0.5 },
    },
  ],
};

/** zoom = 2 / halfHeight, expressed as a log2 exponent. */
export function radiusToLog2Zoom(radius: number): number {
  return 1 - Math.log2(radius);
}
