/**
 * The load-bearing test.
 *
 * It re-implements the fragment shader's perturbation loop in JavaScript,
 * forcing every arithmetic step through Math.fround so the numerics match
 * float32 — including underflow, which is exactly what the scaled-exponent
 * representation exists to survive. Escape counts are then compared against
 * ground truth computed the slow, exact way in BigInt fixed point.
 *
 * If the delta iteration, the rebasing rule, or the exponent bookkeeping in
 * shaders.ts is wrong, this test fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedCtx } from '../src/core/fixed.ts';
import { mandelbrotReference, dwell, dwellSmooth, smoothIter } from '../src/core/reference.ts';
import { Viewport } from '../src/core/viewport.ts';

const f = Math.fround;

/** Mirror of `perturbEscape` in src/render/shaders.ts. Returns the continuous
 *  escape value, or -1 if the pixel never escaped. */
function perturbEscape(
  ref: Float32Array,
  refLen: number,
  z0: [number, number],
  c0: [number, number],
  E: number,
  maxIter: number,
  addC: boolean,
): number {
  let Dx = f(c0[0]);
  let Dy = f(c0[1]);
  let k = -E;
  let m = addC ? 1 : 0;
  const limit = addC ? maxIter - 1 : maxIter;

  for (let n = 0; n < limit; n++) {
    let Zx = ref[m * 2];
    let Zy = ref[m * 2 + 1];
    const s = f(Math.pow(2, k));
    const zx = f(Zx + f(Dx * s));
    const zy = f(Zy + f(Dy * s));
    const z2 = f(f(zx * zx) + f(zy * zy));

    if (z2 > 65536) return smoothIter(addC ? n + 1 : n, z2);

    const dmag = f(f(Math.sqrt(f(f(Dx * Dx) + f(Dy * Dy)))) * s);
    if (z2 < f(dmag * dmag) || m + 1 >= refLen) {
      Dx = f(zx - z0[0]);
      Dy = f(zy - z0[1]);
      k = 0;
      m = 0;
      Zx = z0[0];
      Zy = z0[1];
    }

    const D2x = f(f(Dx * Dx) - f(Dy * Dy));
    const D2y = f(2 * f(Dx * Dy));
    const ek = f(Math.pow(2, k));
    let nx = f(f(2 * f(f(Zx * Dx) - f(Zy * Dy))) + f(D2x * ek));
    let ny = f(f(2 * f(f(Zx * Dy) + f(Zy * Dx))) + f(D2y * ek));
    if (addC) {
      const ec = f(Math.pow(2, -E - k));
      nx = f(nx + f(c0[0] * ec));
      ny = f(ny + f(c0[1] * ec));
    }
    Dx = nx;
    Dy = ny;
    m += 1;

    const a = Math.max(Math.abs(Dx), Math.abs(Dy));
    if (a > 0) {
      const e = Math.floor(Math.log2(a));
      if (e > 24 || e < -24) {
        const sc = f(Math.pow(2, -e));
        Dx = f(Dx * sc);
        Dy = f(Dy * sc);
        k += e;
      }
    }
  }
  return -1;
}

interface Report {
  total: number;
  exact: number;
  escaped: number;
  interior: number;
  /** Largest absolute escape-value error; Infinity if a pixel was misclassified. */
  worst: number;
  /** Largest error as a fraction of the pixel's own escape value. */
  worstRelative: number;
  /** Range of escape values across the sampled grid. */
  spread: number;
}

/**
 * Find a centre that is genuinely on the boundary at the requested scale.
 *
 * Picking a famous deep coordinate is no good here: the published deep
 * locations are island *nuclei*, so a 10^-40 neighbourhood of one is entirely
 * interior and every pixel would trivially agree. Bisecting a segment between
 * an interior and an exterior point converges on the boundary, which guarantees
 * the view straddles it and the comparison is actually testing something.
 */
function boundaryCentre(ctx: FixedCtx, radius: number, bisectIter: number): [bigint, bigint] {
  const x = ctx.fromString('-0.5');
  let lo = ctx.fromString('0'); //   survives bisectIter
  let hi = ctx.fromString('1.0'); // escapes quickly
  const steps = Math.ceil(Math.log2(1 / radius)) + 1;

  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) >> 1n;
    if (dwell(ctx, x, mid, bisectIter) >= bisectIter) lo = mid;
    else hi = mid;
  }
  return [x, (lo + hi) >> 1n];
}

/**
 * Two budgets, and the gap between them matters.
 *
 * `bisectIter` has to be high enough that the set boundary is still fractal at
 * `radius` — bisect at a low budget and you land in the middle of a flat escape
 * band where every pixel has the same dwell and the comparison proves nothing.
 * The comparison then runs at double that, so escapes happen well short of the
 * budget: right at the limit, "escaped" versus "interior" turns on float32
 * rounding at the bailout, a real but visually irrelevant ±1 that would
 * otherwise swamp the measurement.
 */
function compareAtRadius(radius: number, bisectIter: number, grid = 9): Report {
  const log2Zoom = 1 - Math.log2(radius);
  const seed = new FixedCtx(FixedCtx.precisionForLog2Zoom(log2Zoom));
  const [bx, by] = boundaryCentre(seed, radius, bisectIter);
  return compare(bx, by, seed, radius, bisectIter * 2, grid);
}

function compareAtCentre(
  cx: string,
  cy: string,
  radius: number,
  maxIter: number,
  grid = 9,
): Report {
  const log2Zoom = 1 - Math.log2(radius);
  const seed = new FixedCtx(FixedCtx.precisionForLog2Zoom(log2Zoom));
  return compare(seed.fromString(cx), seed.fromString(cy), seed, radius, maxIter, grid);
}

function compare(
  bx: bigint,
  by: bigint,
  seed: FixedCtx,
  radius: number,
  maxIter: number,
  grid: number,
): Report {
  const vp = new Viewport();
  vp.snapTo(bx, by, 1 - Math.log2(radius), seed);

  const ctx = vp.ctx;
  const orbit = mandelbrotReference(ctx, vp.cx, vp.cy, maxIter);
  const { mant, exp } = vp.scaleParts();

  let total = 0;
  let exact = 0;
  let escaped = 0;
  let interior = 0;
  let worst = 0;
  let worstRelative = 0;
  let lo = Infinity;
  let hi = -Infinity;

  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const nx = (i / (grid - 1)) * 2 - 1;
      const ny = (j / (grid - 1)) * 2 - 1;

      // Ground truth: full-precision continuous escape value at this pixel.
      const cx = vp.cx + vp.normToOffset(nx);
      const cy = vp.cy + vp.normToOffset(ny);
      const truth = dwellSmooth(ctx, cx, cy, maxIter);
      const truthEscaped = dwell(ctx, cx, cy, maxIter) < maxIter;

      const got = perturbEscape(
        orbit.data,
        orbit.length,
        [orbit.z0x, orbit.z0y],
        [f(nx * mant), f(ny * mant)],
        exp,
        maxIter,
        true,
      );

      total++;
      if (truthEscaped) {
        escaped++;
        lo = Math.min(lo, truth);
        hi = Math.max(hi, truth);
      } else interior++;

      // Interior/exterior must agree outright; escape values to within a
      // hundredth of an iteration, which is far finer than a colour band.
      const gotEscaped = got >= 0;
      if (gotEscaped !== truthEscaped) {
        worst = Infinity;
        worstRelative = Infinity;
        continue;
      }
      const delta = truthEscaped ? Math.abs(got - truth) : 0;
      if (delta < 0.01) exact++;
      else {
        worst = Math.max(worst, delta);
        worstRelative = Math.max(worstRelative, delta / truth);
      }
    }
  }
  return { total, exact, escaped, interior, worst, worstRelative, spread: hi - lo };
}

function describe(r: Report): string {
  return (
    `${r.exact}/${r.total} exact · ${r.escaped} escaping · ${r.interior} interior · ` +
    `spread ${r.spread.toFixed(1)} · worst Δ${r.worst.toFixed(1)} (${(r.worstRelative * 100).toFixed(2)}%)`
  );
}

/**
 * Depth test: the scaled-exponent representation must survive the descent.
 *
 * At 10^250 the per-pixel delta starts around 2^-830 — some 700 binary orders
 * below the smallest float32 subnormal. If any of the exponent bookkeeping is
 * wrong the deltas collapse to zero or blow up to infinity and every pixel
 * returns the reference's own dwell. Requiring an exact match against
 * arbitrary-precision ground truth is what rules that out.
 */
function checkDepth(label: string, radius: number, bisectIter: number, grid = 9): void {
  const r = compareAtRadius(radius, bisectIter, grid);
  const detail = describe(r);
  assert.ok(r.escaped > 0, `${label}: no escaping pixels (${detail})`);
  assert.equal(r.exact, r.total, `${label}: ${detail}`);
}

test('shallow view — the same code path at zoom 1', () => {
  const ctx = new FixedCtx(64);
  const r = compare(ctx.fromString('-0.5'), 0n, ctx, 1.3, 400, 13);
  assert.ok(r.escaped > 20, 'a wide view should have plenty of escaping pixels');
  assert.ok(r.interior > 20, 'and plenty of interior ones');
  assert.equal(r.exact, r.total, describe(r));
});

test('10^17 zoom — past the float64 ceiling', () => {
  checkDepth('1e-17', 1e-17, 1500);
});

test('10^40 zoom', () => {
  checkDepth('1e-40', 1e-40, 1500);
});

test('10^100 zoom — the depth the plan targets', () => {
  checkDepth('1e-100', 1e-100, 1500);
});

test('10^250 zoom — well past anything float64 or double-single can reach', () => {
  checkDepth('1e-250', 1e-250, 1200);
});

/**
 * Accuracy test: a real, deeply fractal view rather than a synthetic one.
 *
 * This is the shipped "Period-1312 Island · deep" preset at its documented
 * radius, where dwells run to five figures and neighbouring pixels differ by
 * thousands of iterations. Two different things are asserted, because they hold
 * to different standards:
 *
 *   - Which side of the set a pixel is on must be right for *every* pixel.
 *     That is what you actually see.
 *   - The escape value is float32 arithmetic run for thousands of chaotic
 *     iterations, so it drifts on the busiest pixels. The error tracks how
 *     often the pixel had to rebase, and is the accepted accuracy of any
 *     single-precision perturbation renderer; a fix means double-single deltas
 *     in the shader, at a large cost in frame rate.
 */
test('period-1312 island — a genuinely fractal deep view', () => {
  const r = compareAtCentre(
    '-0.74453986035590838011',
    '0.12172377389442482241',
    1.172e-17,
    12000,
    7,
  );
  const detail = describe(r);
  assert.ok(r.escaped > 0, `no escaping pixels (${detail})`);
  assert.ok(r.interior > 0, `no interior pixels (${detail})`);
  assert.ok(r.spread > 1000, `view is not fractal enough to be a real test (${detail})`);
  assert.ok(
    Number.isFinite(r.worst),
    `a pixel was put on the wrong side of the set (${detail})`,
  );
  assert.ok(r.exact / r.total >= 0.65, `too few pixels exact (${detail})`);
  assert.ok(r.worstRelative < 0.03, `escape value drifted too far (${detail})`);
});
