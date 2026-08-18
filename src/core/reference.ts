/**
 * Reference-orbit computation.
 *
 * The whole point of perturbation rendering: iterate ONE orbit per frame at
 * arbitrary precision on the CPU, then let every pixel on the GPU track only
 * its small delta from that orbit in ordinary float32. Cost is O(maxIter) per
 * frame instead of O(maxIter × pixels), so high precision is affordable.
 */

import { BAILOUT, FixedCtx, type Fx } from './fixed.ts';

/**
 * Continuous ("normalised") iteration count — the quantity the shader colours
 * with, and the only escape measure that is actually well-defined.
 *
 * The raw integer count is ambiguous by ±1 for any orbit that lands within
 * rounding distance of the bailout radius, and at depth that is not a rare
 * accident: the reference orbit always terminates on its first crossing, so its
 * final point sits right on the threshold by construction. This value is
 * invariant to which side of that crossing you stop on — for z → z², doubling
 * |z| adds exactly 1 to log2(log|z|), which cancels the extra iteration.
 */
export function smoothIter(n: number, absZSquared: number, base = 2): number {
  const lz = Math.log(absZSquared) * 0.5;
  return n + 1 - Math.log(lz / Math.log(BAILOUT)) / Math.log(base);
}

export interface ReferenceOrbit {
  /** Z_n packed as [x0, y0, x1, y1, ...] in float32 (what the GPU samples). */
  readonly data: Float32Array;
  /** Number of stored orbit points. */
  readonly length: number;
  /**
   * The orbit ended before maxIter under its own steam: escaped past the
   * bailout radius for the escape-time modes, settled exactly onto a root for
   * Newton. Either way the last stored point is a valid stopping place, which
   * is what lets the shader clamp its index there.
   */
  readonly escaped: boolean;
  /** Z_0, needed by the shader when rebasing. */
  readonly z0x: number;
  readonly z0y: number;
  /**
   * Z_{n+1} - Z_n, same packing, for modes that need the reference's own step.
   *
   * Newton decides a pixel has converged by the size of its step, and the step
   * is small by the time that matters — differencing two neighbouring float32
   * points of size 1 to get an answer of size 1e-8 leaves nothing. Subtracting
   * here, in full precision, and *then* rounding keeps all 24 bits where they
   * are needed. Absent for the escape-time modes, which never look at it.
   */
  readonly steps?: Float32Array;
  /**
   * Per orbit point, `[Z^-(q+1), 1/Z]` packed as four floats.
   *
   * Newton never rebases, so every pixel is at reference index `min(i, last)` on
   * iteration `i` — the same one, always. Everything the delta factor needs from
   * `Z` is therefore identical across the whole frame, and computing it per
   * pixel meant a `log2`, an `exp2`, a chain of complex multiplies and a divide
   * done a million times over for one answer. Done once on the CPU instead, the
   * inner loop has no transcendental in it at all.
   *
   * Inverting here rather than on the GPU also removes the overflow that made
   * the normalisation necessary: an orbit thrown out to |Z| = 10^5 has
   * Z^12 ≈ 10^60, which float32 cannot hold, while its reciprocal is simply
   * small and underflows to the zero that is the right answer anyway.
   */
  readonly aux?: Float32Array;
  /**
   * The orbit ran into the pole at z = 0, or somewhere float32 cannot hold, and
   * stopped there rather than at a root. The last point is not a resting one, so
   * holding it is wrong and the caller should re-seed somewhere else. Centring
   * on the pole is not exotic: every Newton preset opens on the origin.
   */
  readonly polefault?: boolean;
}

/**
 * Mandelbrot reference: Z_0 = 0, Z_{n+1} = Z_n^2 + C.
 * `cx`/`cy` are the view centre in `ctx` fixed-point.
 */
export function mandelbrotReference(
  ctx: FixedCtx,
  cx: Fx,
  cy: Fx,
  maxIter: number,
): ReferenceOrbit {
  const cap = Math.max(1, maxIter) + 1;
  const data = new Float32Array(cap * 2);
  const bail = ctx.bailoutSq;

  let zx: Fx = 0n;
  let zy: Fx = 0n;
  let n = 0;
  let escaped = false;

  for (; n < cap; n++) {
    data[n * 2] = ctx.toNumber(zx);
    data[n * 2 + 1] = ctx.toNumber(zy);

    const zx2 = ctx.sqr(zx);
    const zy2 = ctx.sqr(zy);
    if (zx2 + zy2 > bail) {
      escaped = true;
      n++;
      break;
    }
    const nzy = ctx.double(ctx.mul(zx, zy)) + cy;
    zx = zx2 - zy2 + cx;
    zy = nzy;
  }

  return { data, length: n, escaped, z0x: 0, z0y: 0 };
}

/**
 * Julia reference: Z_0 = view centre, Z_{n+1} = Z_n^2 + c with c a constant
 * shared by every pixel.
 */
export function juliaReference(
  ctx: FixedCtx,
  centreX: Fx,
  centreY: Fx,
  cRe: Fx,
  cIm: Fx,
  maxIter: number,
): ReferenceOrbit {
  const cap = Math.max(1, maxIter) + 1;
  const data = new Float32Array(cap * 2);
  const bail = ctx.bailoutSq;

  let zx: Fx = centreX;
  let zy: Fx = centreY;
  let n = 0;
  let escaped = false;

  const z0x = ctx.toNumber(centreX);
  const z0y = ctx.toNumber(centreY);

  for (; n < cap; n++) {
    data[n * 2] = ctx.toNumber(zx);
    data[n * 2 + 1] = ctx.toNumber(zy);

    const zx2 = ctx.sqr(zx);
    const zy2 = ctx.sqr(zy);
    if (zx2 + zy2 > bail) {
      escaped = true;
      n++;
      break;
    }
    const nzy = ctx.double(ctx.mul(zx, zy)) + cIm;
    zx = zx2 - zy2 + cRe;
    zy = nzy;
  }

  return { data, length: n, escaped, z0x, z0y };
}

/* ------------------------------------------------------------------ Newton */

/**
 * Newton's method on z^p - 1, rearranged.
 *
 * The textbook form z - a(z^p - 1)/(p z^(p-1)) expands to
 *
 *     N(z) = A z + B z^-q,   A = 1 - a/p,  B = a/p,  q = p - 1
 *
 * which is the form the perturbation algebra wants: one linear term and one
 * pole, no polynomial quotient to differentiate through.
 */
export function newtonCoefficients(power: number, relaxation: number) {
  return { A: 1 - relaxation / power, B: relaxation / power, q: Math.round(power) - 1 };
}

/**
 * Newton reference orbits usually settle in ten or twenty iterations, but a
 * relaxation near 2 makes the roots barely attracting and the orbit can wander
 * indefinitely. This caps the CPU cost of a frame in that case; the shader
 * holds the last point, which is a small error confined to pixels still
 * iterating that deep.
 */
export const NEWTON_REF_CAP = 2048;

/**
 * How small a step counts as settled, as a shift below the working precision.
 *
 * The shader extends the orbit past its stored end by holding the last point,
 * so that point has to be a fixed point for the extension to be sound. It does
 * not have to be an *exact* one: the roots of z^p - 1 are irrational, so the
 * iteration generally never repeats a mantissa bit-for-bit and waiting for that
 * would just spin to the cap. Stopping 8 bits above the last bit leaves a
 * residual of 2^-(p-8), and since precision is carried 72 bits deeper than the
 * zoom needs, that residual is still 2^64 below the smallest delta in the
 * frame. It is also invisible in the float32 the shader actually samples.
 */
const SETTLE_SHIFT = 8;

/**
 * Room for a stored orbit point in float32.
 *
 * It used to have to leave headroom to square the value, because the shader
 * raised Z to the (q+1)th itself. Now that it receives the reciprocal power
 * precomputed, all that is asked of Z is that it fit.
 */
function withinFloat32(v: number, limit = 1e30): boolean {
  return Number.isFinite(v) && Math.abs(v) < limit;
}

/**
 * The pole term gets multiplied by an O(1) factor in the shader before anything
 * else happens to it, so it is allowed most of float32's range but not the last
 * few orders. It is legitimately enormous near the origin — a view sitting on
 * the pole at 10^5 has every point within 10^-5 of it, and `Z^-6` of that is
 * 10^30. Rejecting those would refuse to render the pole neighbourhood at all.
 */
const POLE_TERM_LIMIT = 1e34;

/**
 * Write `[Z^-(q+1), 1/Z]` for one orbit point, in float64 then rounded down.
 * Returns false if the pole term is too large for float32, which happens when
 * the orbit passes very close to z = 0 at a high degree.
 */
function packAux(aux: Float32Array, n: number, zx: number, zy: number, q: number): boolean {
  const n2 = zx * zx + zy * zy;
  if (n2 === 0) return false; // left as zeros; the shader stops on a zero reciprocal
  const invX = zx / n2;
  const invY = -zy / n2;

  // Z^-(q+1) as the (q+1)th power of the reciprocal: the reciprocal is the
  // small quantity near the pole, so this direction cannot overflow where the
  // forward power would. Underflowing to zero the other way is not a loss —
  // the pole term genuinely has died out that far from the origin.
  let vx = 1;
  let vy = 0;
  for (let i = 0; i <= q; i++) {
    const t = vx * invX - vy * invY;
    vy = vx * invY + vy * invX;
    vx = t;
  }
  if (!withinFloat32(vx, POLE_TERM_LIMIT) || !withinFloat32(vy, POLE_TERM_LIMIT)) return false;

  aux[n * 4] = vx;
  aux[n * 4 + 1] = vy;
  aux[n * 4 + 2] = invX;
  aux[n * 4 + 3] = invY;
  return true;
}

/**
 * Newton reference: Z_0 = view centre, Z_{n+1} = N(Z_n) at full precision.
 */
export function newtonReference(
  ctx: FixedCtx,
  centreX: Fx,
  centreY: Fx,
  power: number,
  relaxation: number,
  maxIter: number,
): ReferenceOrbit {
  const { A, B, q } = newtonCoefficients(power, relaxation);
  const fa = ctx.fromNumber(A);
  const fb = ctx.fromNumber(B);
  const deg = Math.max(1, q);

  const cap = Math.min(Math.max(1, maxIter) + 1, NEWTON_REF_CAP);
  const data = new Float32Array(cap * 2);
  const steps = new Float32Array(cap * 2);
  const aux = new Float32Array(cap * 4);

  let zx: Fx = centreX;
  let zy: Fx = centreY;
  let n = 0;
  let settled = false;
  let atRest = false;
  let polefault = false;

  const tol = 1n << BigInt(Math.max(0, SETTLE_SHIFT));

  const z0x = ctx.toNumber(centreX);
  const z0y = ctx.toNumber(centreY);

  for (; n < cap; n++) {
    data[n * 2] = ctx.toNumber(zx);
    data[n * 2 + 1] = ctx.toNumber(zy);
    // Derived from the float32 the shader will actually sample, not from the
    // exact value, so that the two agree bit for bit.
    if (!packAux(aux, n, data[n * 2], data[n * 2 + 1], deg)) {
      n++;
      polefault = true;
      break;
    }

    // The previous step was already inside tolerance, so the point just stored
    // is the resting one. Stop here and let the shader hold it.
    if (atRest) {
      n++;
      settled = true;
      break;
    }

    // Reciprocal first, then the power. The other order forms Z^q, which for a
    // Z near the pole is smaller than fixed point can hold anything of — |Z| at
    // 10^-6 leaves Z^5 with no significant bits at all — whereas 1/Z is large
    // and loses nothing.
    const r = ctx.cinv(zx, zy);
    const inv = r === null ? null : ctx.cpowi(r[0], r[1], deg);
    // Z sitting exactly on the pole at the origin: N has no value here, so the
    // orbit ends — but not at rest, which the caller needs to know.
    if (inv === null) {
      n++;
      polefault = true;
      break;
    }

    const nx = ctx.mul(fa, zx) + ctx.mul(fb, inv[0]);
    const ny = ctx.mul(fa, zy) + ctx.mul(fb, inv[1]);

    // A pass close enough to the pole throws the next iterate past what a
    // float32 texture can hold. Ending the orbit at the last representable
    // point beats uploading infinities; the shader holds that point, which is
    // an approximation confined to a region the map has already made chaotic.
    if (!withinFloat32(ctx.toNumber(nx)) || !withinFloat32(ctx.toNumber(ny))) {
      n++;
      polefault = true;
      break;
    }

    const dx = nx - zx;
    const dy = ny - zy;
    steps[n * 2] = ctx.toNumber(dx);
    steps[n * 2 + 1] = ctx.toNumber(dy);
    atRest = (dx < 0n ? -dx : dx) + (dy < 0n ? -dy : dy) <= tol;
    zx = nx;
    zy = ny;
  }

  // The final stored point is where the orbit rests, so its step is zero — and
  // it stays zero for every index the shader clamps to beyond the end.
  return { data, length: n, escaped: settled, z0x, z0y, steps, aux, polefault };
}

/**
 * One Newton step in full precision. The tests use it to build ground truth a
 * pixel's orbit can be checked against; the renderer never calls it.
 */
export function newtonStep(
  ctx: FixedCtx,
  zx: Fx,
  zy: Fx,
  power: number,
  relaxation: number,
): [Fx, Fx] | null {
  const { A, B, q } = newtonCoefficients(power, relaxation);
  const r = ctx.cinv(zx, zy);
  if (r === null) return null;
  const inv = ctx.cpowi(r[0], r[1], Math.max(1, q));
  const fa = ctx.fromNumber(A);
  const fb = ctx.fromNumber(B);
  return [ctx.mul(fa, zx) + ctx.mul(fb, inv[0]), ctx.mul(fa, zy) + ctx.mul(fb, inv[1])];
}

/**
 * Escape-time dwell for a single point in full fixed precision. Used by the
 * tests and by the auto-iteration heuristic; never on the render path.
 */
export function dwell(
  ctx: FixedCtx,
  cx: Fx,
  cy: Fx,
  maxIter: number,
  /** Override the escape radius. Only classical identities need this; the
   *  renderer always uses the context's own, larger bailout. */
  bailoutSq: Fx = ctx.bailoutSq,
): number {
  const bail = bailoutSq;
  let zx: Fx = 0n;
  let zy: Fx = 0n;
  for (let n = 0; n < maxIter; n++) {
    const zx2 = ctx.sqr(zx);
    const zy2 = ctx.sqr(zy);
    if (zx2 + zy2 > bail) return n;
    const nzy = ctx.double(ctx.mul(zx, zy)) + cy;
    zx = zx2 - zy2 + cx;
    zy = nzy;
  }
  return maxIter;
}

/**
 * Exact reference implementation of what the shader computes: the continuous
 * escape value, or `maxIter` for a point that never escaped.
 */
export function dwellSmooth(ctx: FixedCtx, cx: Fx, cy: Fx, maxIter: number): number {
  const bail = ctx.bailoutSq;
  let zx: Fx = 0n;
  let zy: Fx = 0n;
  for (let n = 0; n < maxIter; n++) {
    const zx2 = ctx.sqr(zx);
    const zy2 = ctx.sqr(zy);
    if (zx2 + zy2 > bail) return smoothIter(n, ctx.toNumber(zx2 + zy2));
    const nzy = ctx.double(ctx.mul(zx, zy)) + cy;
    zx = zx2 - zy2 + cx;
    zy = nzy;
  }
  return maxIter;
}
