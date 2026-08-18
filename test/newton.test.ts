/**
 * The load-bearing test for Newton mode, and the counterpart to
 * perturbation.test.ts.
 *
 * It re-implements `newtonPerturbShade` from src/render/shaders.ts in
 * JavaScript, forcing every step through Math.fround so the numerics match
 * float32 — underflow included, which is the whole point of carrying the delta
 * as a scaled mantissa. The two things the shader actually renders, the
 * iteration count and which root the pixel lands on, are then compared against
 * ground truth iterated the slow exact way in BigInt fixed point.
 *
 * If the delta factor, the binomial series, or the exponent bookkeeping is
 * wrong, this test fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedCtx, type Fx } from '../src/core/fixed.ts';
import { newtonReference, newtonStep, newtonCoefficients } from '../src/core/reference.ts';
import { Viewport } from '../src/core/viewport.ts';
import { radiusToLog2Zoom } from '../src/state/presets.ts';

const f = Math.fround;

/* ------------------------------------------------------- float32 complex */

function cmul(ax: number, ay: number, bx: number, by: number): [number, number] {
  return [f(f(ax * bx) - f(ay * by)), f(f(ax * by) + f(ay * bx))];
}

function cdiv(ax: number, ay: number, bx: number, by: number): [number, number] {
  const den = f(f(bx * bx) + f(by * by));
  return [f(f(f(ax * bx) + f(ay * by)) / den), f(f(f(ay * bx) - f(ax * by)) / den)];
}

/** What the shader ends up colouring with. */
interface Shade {
  /** Iteration index it stopped on. */
  n: number;
  /** Argument of the final z — the root, in practice. */
  angle: number;
}

/** Mirror of `newtonPerturbShade` in src/render/shaders.ts. */
function newtonPerturb(
  ref: Float32Array,
  refStepData: Float32Array,
  refAux: Float32Array,
  refLen: number,
  d0: [number, number],
  E: number,
  power: number,
  relaxation: number,
  maxIter: number,
): Shade {
  const q = Math.round(power) - 1;
  const ratio = f(relaxation / power);
  const A = f(1 - ratio);
  const B = ratio;

  let Dx = f(d0[0]);
  let Dy = f(d0[1]);
  let k = -E;
  let s = f(Math.pow(2, k));
  let m = 0;
  const last = Math.max(0, refLen - 1);

  let n = 0;
  let zx = 0;
  let zy = 0;

  for (let i = 0; i < maxIter; i++) {
    const Zx = ref[m * 2];
    const Zy = ref[m * 2 + 1];
    const rsx = refStepData[m * 2];
    const rsy = refStepData[m * 2 + 1];
    const Vx = refAux[m * 4];
    const Vy = refAux[m * 4 + 1];
    const invZx = refAux[m * 4 + 2];
    const invZy = refAux[m * 4 + 3];

    const dx = f(Dx * s);
    const dy = f(Dy * s);
    zx = f(Zx + dx);
    zy = f(Zy + dy);
    n = i;

    if (f(f(invZx * invZx) + f(invZy * invZy)) === 0) break;

    const [ex, ey] = cmul(dx, dy, invZx, invZy);
    let Dnx: number;
    let Dny: number;

    if (f(f(ex * ex) + f(ey * ey)) < 0.25) {
      let Px = 1;
      let Py = 0;
      let cb = 1;
      for (let j = q - 1; j >= 1; j--) {
        cb = f(f(cb * (j + 1)) / (q - j));
        const [tx, ty] = cmul(ex, ey, Px, Py);
        Px = f(cb + tx);
        Py = ty;
      }

      const [epx, epy] = cmul(ex, ey, Px, Py);
      const denx = f(1 + epx);
      const deny = epy;
      if (f(f(denx * denx) + f(deny * deny)) === 0) break;

      const [qx, qy] = cdiv(Px, Py, denx, deny);
      const [vqx, vqy] = cmul(Vx, Vy, qx, qy);
      [Dnx, Dny] = cmul(Dx, Dy, f(A - f(B * vqx)), f(-f(B * vqy)));
    } else {
      let zqx = 1;
      let zqy = 0;
      for (let j = 0; j < q; j++) [zqx, zqy] = cmul(zqx, zqy, zx, zy);
      const zq2 = f(f(zqx * zqx) + f(zqy * zqy));
      if (zq2 === 0) break;
      const [px, py] = zq2 > 3.0e38 ? [0, 0] : cdiv(1, 0, zqx, zqy);
      const [Zpx, Zpy] = cmul(Vx, Vy, Zx, Zy);
      const bs = f(B / s);
      Dnx = f(f(A * Dx) + f(bs * f(px - Zpx)));
      Dny = f(f(A * Dy) + f(bs * f(py - Zpy)));
    }

    if (!(f(f(Dnx * Dnx) + f(Dny * Dny)) < 3.0e38)) break;

    const dnx = f(Dnx * s);
    const dny = f(Dny * s);

    const stx = f(f(rsx + f(dnx - dx)) / relaxation);
    const sty = f(f(rsy + f(dny - dy)) / relaxation);

    Dx = Dnx;
    Dy = Dny;
    m = Math.min(m + 1, last);

    if (f(f(stx * stx) + f(sty * sty)) < 1e-12) {
      zx = f(ref[m * 2] + dnx);
      zy = f(ref[m * 2 + 1] + dny);
      break;
    }

    const a = Math.max(Math.abs(Dx), Math.abs(Dy));
    if (a > 33554432 || (a < 5.9604645e-8 && a > 0)) {
      const e = Math.floor(Math.log2(a));
      const sc = f(Math.pow(2, -e));
      Dx = f(Dx * sc);
      Dy = f(Dy * sc);
      k += e;
      s = f(Math.pow(2, k));
    }
  }

  if (!(f(f(zx * zx) + f(zy * zy)) < 3.0e38)) {
    zx = ref[m * 2];
    zy = ref[m * 2 + 1];
  }
  return { n, angle: Math.atan2(zy, zx) };
}

/* -------------------------------------------------------- ground truth */

/** The same iteration, exact, straight from the pixel's own coordinate. */
function newtonTruth(
  ctx: FixedCtx,
  px: Fx,
  py: Fx,
  power: number,
  relaxation: number,
  maxIter: number,
): Shade {
  let zx = px;
  let zy = py;
  let n = 0;

  for (let i = 0; i < maxIter; i++) {
    n = i;
    if (ctx.toNumber(ctx.norm2(zx, zy)) < 1e-24) break;
    const next = newtonStep(ctx, zx, zy, power, relaxation);
    if (next === null) break;
    const sx = ctx.toNumber(next[0] - zx) / relaxation;
    const sy = ctx.toNumber(next[1] - zy) / relaxation;
    zx = next[0];
    zy = next[1];
    if (sx * sx + sy * sy < 1e-12) break;
  }
  return { n, angle: Math.atan2(ctx.toNumber(zy), ctx.toNumber(zx)) };
}

/** Which root of z^p - 1 a point ended up at, or -1 if it never settled. */
function rootIndex(angle: number, power: number): number {
  const k = Math.round((angle * power) / (2 * Math.PI));
  return ((k % power) + power) % power;
}

/* ------------------------------------------------------------ comparison */

interface Report {
  total: number;
  /** Pixels whose root and iteration count both match exactly. */
  exact: number;
  /** Pixels that landed on the wrong root — the only visible kind of failure. */
  wrongRoot: number;
  /** Largest disagreement in iteration count. */
  worstIter: number;
  /** Distinct roots present in the view. */
  roots: number;
  /** Distinct iteration counts present, i.e. how much detail is on screen. */
  levels: number;
}

/**
 * Find a centre on the basin boundary at the requested scale.
 *
 * Picking a pretty coordinate is no good: almost every point of the plane sits
 * comfortably inside one basin, and a 10^-40 neighbourhood of one is a flat
 * wash where every pixel trivially agrees. Bisecting a segment whose endpoints
 * converge to *different* roots drives onto the Julia set, which guarantees the
 * view straddles a boundary and the comparison is testing something.
 */
function boundaryCentre(
  ctx: FixedCtx,
  power: number,
  relaxation: number,
  radius: number,
  iter: number,
): [Fx, Fx] {
  const x = ctx.fromString('0.4');
  const root = (y: Fx) =>
    rootIndex(newtonTruth(ctx, x, y, power, relaxation, iter).angle, power);

  // Which basins sit where depends on the degree and the relaxation, so find a
  // straddling pair by scanning rather than hard-coding a segment that happens
  // to work for z^3 - 1.
  const samples = 48;
  const at = (i: number) => ctx.fromNumber(-0.95 + (1.9 * i) / samples);
  let lo = at(0);
  let loRoot = root(lo);
  let hi: Fx | null = null;
  for (let i = 1; i <= samples; i++) {
    const y = at(i);
    if (root(y) !== loRoot) {
      hi = y;
      break;
    }
    lo = y;
    loRoot = root(y);
  }
  assert.ok(hi !== null, `no basin boundary found for p=${power} a=${relaxation}`);
  let top: Fx = hi;

  const steps = Math.ceil(Math.log2(1 / radius)) + 2;
  for (let i = 0; i < steps; i++) {
    const mid: Fx = (lo + top) >> 1n;
    if (root(mid) === loRoot) lo = mid;
    else top = mid;
  }
  return [x, (lo + top) >> 1n];
}

/**
 * How long a pixel needs before its verdict is settled, and it grows with depth.
 *
 * A delta of 10^-250 has to be amplified all the way back to order 1 before the
 * pixel can fall into a basin different from the reference's, and the basin
 * boundary only stretches it by a bounded factor per iteration. Budget too
 * little and every pixel in a deep view is still mid-flight when the loop ends,
 * which is not a disagreement between the two implementations — it is both of
 * them being asked a question neither has finished answering.
 *
 * It grows with the degree too, and steeply. The Julia set of z^3 - 1 pushes
 * neighbouring points apart by roughly a factor of two per iteration; by z^8 - 1
 * that is nearer 1.3, so the same 200 bits of separation take three times as
 * long to open up. This is a property of the fractal rather than of the
 * renderer, and it is why high degrees at extreme depth want a large iteration
 * budget in the app as well.
 */
function budgetFor(radius: number, power = 3): number {
  const perDecade = 1.6 + 0.35 * (power - 3);
  return Math.max(200, Math.ceil(perDecade * Math.log2(1 / radius)));
}

/**
 * Seed the reference somewhere the map is defined, and say where.
 *
 * Mirrors `App.ensureReference`. A reference orbit that starts on the pole dies
 * at step zero, and then every pixel in the frame stops at its first iteration —
 * which renders as a smooth pinwheel of `arg(z)` with no fractal in it at all.
 * Any nearby point serves equally well, so re-seed off-centre and measure d
 * from there instead.
 */
function seedReference(
  ctx: FixedCtx,
  vp: Viewport,
  power: number,
  relaxation: number,
  maxIter: number,
): { orbit: ReturnType<typeof newtonReference>; shift: [number, number] } {
  const seeds: [number, number][] = [
    [0, 0],
    [0.5, 0.25],
    [-0.37, 0.61],
    [0.83, -0.44],
    [-0.68, -0.79],
  ];
  let orbit = newtonReference(ctx, vp.cx, vp.cy, power, relaxation, maxIter);
  let shift: [number, number] = [0, 0];
  for (const seed of seeds) {
    shift = seed;
    orbit = newtonReference(
      ctx,
      vp.cx + vp.normToOffset(seed[0]),
      vp.cy + vp.normToOffset(seed[1]),
      power,
      relaxation,
      maxIter,
    );
    if (!orbit.polefault) break;
  }
  return { orbit, shift };
}

function compare(
  radius: number,
  power: number,
  relaxation: number,
  bisectIter: number,
  grid = 9,
): Report {
  const log2Zoom = 1 - Math.log2(radius);
  const seed = new FixedCtx(FixedCtx.precisionForLog2Zoom(log2Zoom));
  const [bx, by] = boundaryCentre(seed, power, relaxation, radius, bisectIter);

  // Compare at twice the budget the centre was found with, so no sampled pixel
  // is still undecided when the loop ends and a ±1 at the cutoff cannot be
  // mistaken for a disagreement.
  const maxIter = bisectIter * 2;

  const vp = new Viewport();
  vp.snapTo(bx, by, log2Zoom, seed);
  const ctx = vp.ctx;

  const { orbit, shift } = seedReference(ctx, vp, power, relaxation, maxIter);
  const { mant, exp } = vp.scaleParts();

  const roots = new Set<number>();
  const levels = new Set<number>();
  let total = 0;
  let exact = 0;
  let wrongRoot = 0;
  let worstIter = 0;

  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const nx = (i / (grid - 1)) * 2 - 1;
      const ny = (j / (grid - 1)) * 2 - 1;

      const truth = newtonTruth(
        ctx,
        vp.cx + vp.normToOffset(nx),
        vp.cy + vp.normToOffset(ny),
        power,
        relaxation,
        maxIter,
      );
      const got = newtonPerturb(
        orbit.data,
        orbit.steps!,
        orbit.aux!,
        orbit.length,
        [f((nx - shift[0]) * mant), f((ny - shift[1]) * mant)],
        exp,
        power,
        relaxation,
        maxIter,
      );

      const tr = rootIndex(truth.angle, power);
      const gr = rootIndex(got.angle, power);
      roots.add(tr);
      levels.add(truth.n);

      total++;
      if (tr !== gr) wrongRoot++;
      const di = Math.abs(truth.n - got.n);
      worstIter = Math.max(worstIter, di);
      if (tr === gr && di === 0) exact++;
    }
  }

  return { total, exact, wrongRoot, worstIter, roots: roots.size, levels: levels.size };
}

function describe(r: Report): string {
  return (
    `${r.exact}/${r.total} exact · ${r.roots} roots · ${r.levels} dwell levels · ` +
    `${r.wrongRoot} wrong root · worst Δn ${r.worstIter}`
  );
}

/**
 * The view has to actually contain structure, or agreement proves nothing: two
 * roots and several distinct dwell counts means the frame straddles a basin
 * boundary rather than sitting in a flat interior.
 *
 * Two different standards are then applied, because they hold to different
 * degrees:
 *
 *   - Which basin a pixel falls into must be right for *every* pixel. That is
 *     the hue, and it is what you actually see.
 *   - The iteration count is allowed to differ by one. Newton stops when its
 *     step falls under 1e-6, and about a fifth of the pixels in a boundary view
 *     cross that line with a step between 1e-7 and 1e-6 — inside float32's
 *     resolution of the threshold. Landing either side of it shifts the colour
 *     by one iteration in the n * 0.02 * density term, i.e. two percent of one
 *     band. Removing it would mean double-single deltas throughout, at a large
 *     cost in frame rate, to fix something invisible.
 *
 * The tolerance widens with slow convergence rather than with depth, which is
 * the tell that it is the threshold and not the delta arithmetic: a relaxation
 * of 1.6 makes the roots only weakly attracting, so the step shrinks by 0.6 a
 * time instead of squaring, and an orbit can spend several iterations inside
 * the band the threshold sits in. A relaxation of 1 at 10^250 does not.
 */
function checkDepth(
  label: string,
  radius: number,
  power = 3,
  relaxation = 1,
  grid = 9,
): void {
  const r = compare(radius, power, relaxation, budgetFor(radius, power), grid);
  const detail = describe(r);
  assert.ok(r.roots >= 2, `${label}: view is not on a boundary (${detail})`);
  assert.ok(r.levels >= 3, `${label}: view has no detail in it (${detail})`);
  assert.equal(r.wrongRoot, 0, `${label}: pixels landed in the wrong basin (${detail})`);
  assert.ok(r.worstIter <= 2, `${label}: dwell drifted too far (${detail})`);
  assert.ok(r.exact / r.total >= 0.8, `${label}: too few pixels exact (${detail})`);
}

/* ----------------------------------------------------------------- tests */

test('the rearranged map is the textbook Newton step', () => {
  const ctx = new FixedCtx(96);
  for (const [p, a] of [
    [3, 1],
    [5, 1],
    [4, 0.6],
    [8, 1.7],
  ]) {
    const zx = ctx.fromString('0.37');
    const zy = ctx.fromString('-0.61');
    const got = newtonStep(ctx, zx, zy, p, a);
    assert.ok(got);

    // Textbook: z - a (z^p - 1) / (p z^(p-1)), evaluated the long way.
    const [fx, fy] = ctx.cpowi(zx, zy, p);
    const [dx0, dy0] = ctx.cpowi(zx, zy, p - 1);
    const num: [Fx, Fx] = [fx - ctx.one, fy];
    const den: [Fx, Fx] = [ctx.mul(ctx.fromNumber(p), dx0), ctx.mul(ctx.fromNumber(p), dy0)];
    const inv = ctx.cinv(den[0], den[1]);
    assert.ok(inv);
    const [rx, ry] = ctx.cmul(num[0], num[1], inv[0], inv[1]);
    const fa = ctx.fromNumber(a);
    const wantX = zx - ctx.mul(fa, rx);
    const wantY = zy - ctx.mul(fa, ry);

    // The two forms differ only in where the float64 rounding of a/p lands, so
    // they agree to float64 and no further.
    assert.ok(
      Math.abs(ctx.toNumber(got[0] - wantX)) < 1e-15,
      `p=${p} a=${a} real part disagrees`,
    );
    assert.ok(
      Math.abs(ctx.toNumber(got[1] - wantY)) < 1e-15,
      `p=${p} a=${a} imaginary part disagrees`,
    );
  }
});

test('coefficients match the closed form', () => {
  const { A, B, q } = newtonCoefficients(3, 1);
  assert.equal(q, 2);
  assert.ok(Math.abs(A - 2 / 3) < 1e-15);
  assert.ok(Math.abs(B - 1 / 3) < 1e-15);
});

test('the reference settles onto a genuine root and stops', () => {
  const ctx = new FixedCtx(256);
  const orbit = newtonReference(ctx, ctx.fromString('0.4'), ctx.fromString('0.35'), 3, 1, 600);

  assert.ok(orbit.escaped, 'a relaxation of 1 should always settle');
  assert.ok(orbit.length < 60, `settled far too slowly (${orbit.length})`);

  const x = orbit.data[(orbit.length - 1) * 2];
  const y = orbit.data[(orbit.length - 1) * 2 + 1];
  // z^3 = 1 at the landing point.
  const r3 = Math.pow(Math.hypot(x, y), 3);
  assert.ok(Math.abs(r3 - 1) < 1e-6, `not on the unit circle (r^3 = ${r3})`);
  const arg = ((Math.atan2(y, x) * 3) / (2 * Math.PI)) % 1;
  assert.ok(Math.min(Math.abs(arg), 1 - Math.abs(arg)) < 1e-5, 'not at a cube root of unity');

  // And the last point really is at rest: holding it, as the shader does past
  // the end of the orbit, must not move.
  const again = newtonStep(ctx, ctx.fromString('0'), ctx.fromString('0'), 3, 1);
  assert.equal(again, null, 'the pole must report itself rather than divide by zero');
});

/**
 * The bug this test exists for: every shipped Newton preset opens on the
 * origin, which is the one point where N has no value. The reference orbit died
 * at step zero, the shader stopped every pixel on its first iteration, and the
 * whole frame came out as a smooth pinwheel of arg(z) with no fractal in it.
 *
 * A pinwheel is exactly what "one dwell level, and hue that sweeps the circle"
 * looks like, so both are checked: real structure means several dwells.
 */
test('a view centred on the pole still renders the fractal', () => {
  for (const { power, relaxation } of [
    { power: 3, relaxation: 1 },
    { power: 4, relaxation: 1 },
    { power: 8, relaxation: 1 },
    { power: 3, relaxation: 1.6 },
  ]) {
    const label = `p=${power} a=${relaxation}`;
    const log2Zoom = radiusToLog2Zoom(1.6);
    const ctxSeed = new FixedCtx(FixedCtx.precisionForLog2Zoom(log2Zoom));
    const vp = new Viewport();
    vp.snapTo(0n, 0n, log2Zoom, ctxSeed);

    const maxIter = 200;
    const bare = newtonReference(vp.ctx, vp.cx, vp.cy, power, relaxation, maxIter);
    assert.ok(bare.polefault, `${label}: the origin should be reported as a pole`);

    const { orbit, shift } = seedReference(vp.ctx, vp, power, relaxation, maxIter);
    assert.ok(!orbit.polefault, `${label}: re-seeding should escape the pole`);

    const { mant, exp } = vp.scaleParts();
    const roots = new Set<number>();
    const levels = new Set<number>();
    let wrong = 0;
    let total = 0;

    // Offset off the lattice on purpose, and by a different amount on each
    // axis. This view is centred on the origin, where the basins meet in p-fold
    // symmetry: an evenly spaced grid puts a whole row and column on the axes,
    // and equal offsets put the diagonal on the 45° boundary. Those points lie
    // on the Julia set itself, belong to no basin, and never converge.
    for (let j = 0; j < 9; j++) {
      for (let i = 0; i < 9; i++) {
        const nx = ((i + 0.317) / 9) * 2 - 1;
        const ny = ((j + 0.724) / 9) * 2 - 1;
        const truth = newtonTruth(
          vp.ctx,
          vp.cx + vp.normToOffset(nx),
          vp.cy + vp.normToOffset(ny),
          power,
          relaxation,
          maxIter,
        );
        const got = newtonPerturb(
          orbit.data,
          orbit.steps!,
          orbit.aux!,
          orbit.length,
          [f((nx - shift[0]) * mant), f((ny - shift[1]) * mant)],
          exp,
          power,
          relaxation,
          maxIter,
        );
        // A point that ran out the budget never picked a basin, so there is
        // nothing to be right or wrong about.
        if (truth.n >= maxIter - 1) continue;

        roots.add(rootIndex(truth.angle, power));
        levels.add(truth.n);
        total++;
        if (rootIndex(truth.angle, power) !== rootIndex(got.angle, power)) wrong++;
      }
    }

    assert.ok(roots.size >= 2, `${label}: no basins in view`);
    assert.ok(levels.size >= 4, `${label}: flat dwell — this is the pinwheel again`);
    assert.ok(wrong / total <= 0.07, `${label}: ${wrong}/${total} pixels in the wrong basin`);
  }
});

test('shallow view — the same code path at zoom 1', () => {
  const r = compare(0.35, 3, 1, 200, 13);
  assert.ok(r.roots >= 2, `expected several basins in a wide view (${describe(r)})`);
  assert.equal(r.wrongRoot, 0, describe(r));
  assert.ok(r.worstIter <= 1, describe(r));
  assert.ok(r.exact / r.total >= 0.85, describe(r));
});

test('10^17 zoom — past the float64 ceiling', () => {
  checkDepth('1e-17', 1e-17);
});

test('10^40 zoom', () => {
  checkDepth('1e-40', 1e-40);
});

test('10^100 zoom', () => {
  checkDepth('1e-100', 1e-100, 3, 1, 7);
});

test('10^250 zoom — as deep as the Mandelbrot path goes', () => {
  checkDepth('1e-250', 1e-250, 3, 1, 5);
});

/**
 * Degree exercises the binomial series and the two-regime split, neither of
 * which does anything at all when q = 1.
 *
 * The standard here is deliberately looser than for degree 3, and the reason is
 * the fractal rather than the arithmetic. The Julia set of z^3 - 1 pushes
 * neighbouring points apart by roughly a factor of two per iteration; by
 * z^12 - 1 it is nearer 1.3, so a pixel spends four times as long near the
 * boundary before its fate is settled, and float32's 10^-7 accumulates over all
 * of it. A pixel sitting within about 10^-5 of a basin boundary can therefore
 * come down on the wrong side — which is the ordinary glitch rate of any
 * single-precision perturbation renderer, and does not grow with depth: the
 * numbers below are as good at 10^40 as at 10^3, which is the tell that it is
 * the boundary and not the precision.
 */
test('higher degrees land in the right basins', () => {
  for (const radius of [1e-3, 1e-8, 1e-20, 1e-40]) {
    for (const power of [4, 6, 8, 10, 12]) {
      const r = compare(radius, power, 1, budgetFor(radius, power), 7);
      const detail = `p=${power} @ ${radius}: ${describe(r)}`;
      assert.ok(r.roots >= power - 3, `${detail} — view is not fractal enough`);
      assert.ok(r.levels >= 3, `${detail} — no detail in the view`);
      assert.ok(r.wrongRoot / r.total <= 0.07, `${detail} — too many wrong basins`);
    }
  }
});

test('a relaxation away from 1 stays exact at depth', () => {
  checkDepth('a=0.5 @ 1e-60', 1e-60, 3, 0.5);
  checkDepth('a=1.6 @ 1e-60', 1e-60, 3, 1.6);
});

/**
 * The regression this whole change exists to fix.
 *
 * The old Newton path built its coordinate with a double-double add and then
 * collapsed the result to a single float32, so below about 10^-7 of the centre
 * every pixel in a row rounded to the same coordinate. This asserts the deltas
 * still separate neighbouring pixels 250 orders of magnitude further down.
 */
test('neighbouring pixels stay distinguishable at 10^250', () => {
  const radius = 1e-250;
  const budget = budgetFor(radius);
  const log2Zoom = 1 - Math.log2(radius);
  const seed = new FixedCtx(FixedCtx.precisionForLog2Zoom(log2Zoom));
  const [bx, by] = boundaryCentre(seed, 3, 1, radius, budget);

  const vp = new Viewport();
  vp.snapTo(bx, by, log2Zoom, seed);
  const orbit = newtonReference(vp.ctx, vp.cx, vp.cy, 3, 1, budget * 2);
  const { mant, exp } = vp.scaleParts();

  const seen = new Set<string>();
  for (let i = 0; i < 21; i++) {
    const nx = (i / 20) * 2 - 1;
    const s = newtonPerturb(
      orbit.data,
      orbit.steps!,
      orbit.aux!,
      orbit.length,
      [f(nx * mant), f(0)],
      exp,
      3,
      1,
      budget * 2,
    );
    seen.add(`${rootIndex(s.angle, 3)}:${s.n}`);
  }
  assert.ok(seen.size >= 4, `row collapsed to ${seen.size} distinct values`);
});
