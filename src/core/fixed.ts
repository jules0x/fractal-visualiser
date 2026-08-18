/**
 * Arbitrary-precision binary fixed-point arithmetic on BigInt.
 *
 * A value is stored as an integer mantissa `m` with an implicit scale of 2^-p:
 *
 *     value = m / 2^p
 *
 * `p` (the fractional bit count) is chosen from the zoom depth, so precision
 * grows automatically as you descend — there is no fixed ceiling the way there
 * is with float64 or emulated double-single.
 *
 * All numbers we hold this way are bounded (|z| <= 2 on the reference orbit,
 * |c| <= 2 in the parameter plane), so the integer part never needs more than a
 * couple of bits and `p` alone controls accuracy.
 */

/** A fixed-point value. Meaningless without the FixedCtx that produced it. */
export type Fx = bigint;

/**
 * Escape radius.
 *
 * The textbook value is 2, the smallest radius that guarantees divergence. It
 * is a poor choice here for two reasons: the smooth-colouring term is only
 * asymptotically correct, so it bands visibly at small radii; and on the GPU
 * the reference orbit is stored in float32, which at |Z| ≈ 2 cannot reliably
 * decide whether a marginal orbit crossed the threshold — costing an iteration
 * either way. Bailing out at 256 puts the escape decision far from any rounding
 * boundary and makes the continuous colouring genuinely continuous.
 */
export const BAILOUT = 256;
export const BAILOUT_SQ = BAILOUT * BAILOUT;

export class FixedCtx {
  /** Number of fractional bits. */
  readonly p: number;
  /** 1.0 in this context. */
  readonly one: Fx;
  /** The squared escape radius in this context. */
  readonly bailoutSq: Fx;
  private readonly pb: bigint;

  constructor(p: number) {
    if (!Number.isInteger(p) || p < 8) throw new Error(`FixedCtx: bad precision ${p}`);
    this.p = p;
    this.pb = BigInt(p);
    this.one = 1n << this.pb;
    this.bailoutSq = BigInt(BAILOUT_SQ) << this.pb;
  }

  /** Bits of precision needed to resolve a view at the given zoom level. */
  static precisionForLog2Zoom(log2Zoom: number, guard = 72): number {
    return Math.max(64, Math.ceil(Math.max(0, log2Zoom)) + guard);
  }

  add(a: Fx, b: Fx): Fx {
    return a + b;
  }

  sub(a: Fx, b: Fx): Fx {
    return a - b;
  }

  neg(a: Fx): Fx {
    return -a;
  }

  /** Multiply, truncating toward zero so rounding error stays symmetric about 0. */
  mul(a: Fx, b: Fx): Fx {
    const prod = a * b;
    return prod < 0n ? -((-prod) >> this.pb) : prod >> this.pb;
  }

  /** a * 2 — used constantly in the z^2 inner loop. */
  double(a: Fx): Fx {
    return a << 1n;
  }

  sqr(a: Fx): Fx {
    const prod = a * a;
    return prod >> this.pb;
  }

  /**
   * Divide, rounding to nearest. Newton's method needs this and z^2 + c does
   * not, which is why it was absent until now; rounding to nearest rather than
   * truncating matters here because a Newton orbit divides once per iteration
   * and a consistent downward bias would walk the reference off the true root.
   * Returns 0 for a zero divisor — callers guard the pole themselves.
   */
  div(a: Fx, b: Fx): Fx {
    if (b === 0n) return 0n;
    return divRound(a << this.pb, b);
  }

  /** |a|^2 for a complex value held as a pair. */
  norm2(x: Fx, y: Fx): Fx {
    return this.sqr(x) + this.sqr(y);
  }

  /** Complex multiply. */
  cmul(ax: Fx, ay: Fx, bx: Fx, by: Fx): [Fx, Fx] {
    return [this.mul(ax, bx) - this.mul(ay, by), this.mul(ax, by) + this.mul(ay, bx)];
  }

  /**
   * Complex reciprocal. Returns null only at an exact zero.
   *
   * Not `conj(a) / norm2(a)`: fixed point holds absolute precision, so |a|^2
   * underflows to nothing while `a` itself is still perfectly well resolved —
   * at 91 bits, |a| = 1e-6 gives |a|^2 = 1e-12 with a handful of bits left and
   * |a|^5 with none at all. Cancelling the scale algebraically instead keeps
   * the whole thing in integers:
   *
   *     (x / (x^2 + y^2)) * 2^p  =  (ax << 2p) / (ax^2 + ay^2)
   *
   * which is exact for any `a` a fixed-point value can represent.
   */
  cinv(x: Fx, y: Fx): [Fx, Fx] | null {
    const den = x * x + y * y;
    if (den === 0n) return null;
    const shift = this.pb << 1n;
    return [divRound(x << shift, den), divRound(-y << shift, den)];
  }

  /** Complex integer power by repeated multiplication. `k` is small (<= 12). */
  cpowi(x: Fx, y: Fx, k: number): [Fx, Fx] {
    let rx = this.one;
    let ry = 0n;
    for (let i = 0; i < k; i++) [rx, ry] = this.cmul(rx, ry, x, y);
    return [rx, ry];
  }

  fromNumber(x: number): Fx {
    if (!Number.isFinite(x) || x === 0) return 0n;
    const neg = x < 0;
    const ax = Math.abs(x);
    // Decompose into a 53-bit integer mantissa times a power of two.
    const exp = Math.floor(Math.log2(ax));
    const mantF = ax / Math.pow(2, exp - 52); // in [2^52, 2^53)
    let m = BigInt(Math.round(mantF));
    const shift = exp - 52 + this.p;
    m = shift >= 0 ? m << BigInt(shift) : m >> BigInt(-shift);
    return neg ? -m : m;
  }

  toNumber(a: Fx): number {
    if (a === 0n) return 0;
    const neg = a < 0n;
    let v = neg ? -a : a;
    const bits = bitLength(v);
    const shift = bits - 53;
    let mant: number;
    let exp: number;
    if (shift > 0) {
      mant = Number(v >> BigInt(shift));
      exp = shift - this.p;
    } else {
      mant = Number(v);
      exp = -this.p;
    }
    // Combine exponents in one step so intermediate powers never overflow.
    const out = mant * Math.pow(2, exp);
    return neg ? -out : out;
  }

  /** Re-express a value from another context at this context's precision. */
  rescaleFrom(a: Fx, from: FixedCtx): Fx {
    const d = this.p - from.p;
    if (d === 0) return a;
    if (d > 0) return a << BigInt(d);
    const s = BigInt(-d);
    return a < 0n ? -((-a) >> s) : a >> s;
  }

  /**
   * Parse a decimal string ("-0.744539860355908380", "1.25e-3") without going
   * through float64, so the full written precision survives.
   */
  fromString(s: string): Fx {
    const t = s.trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) {
      throw new Error(`FixedCtx.fromString: cannot parse ${JSON.stringify(s)}`);
    }
    const sign = m[1] === '-' ? -1n : 1n;
    const intPart = m[2] || '0';
    const fracPart = m[3] || '';
    const exp10 = m[4] ? parseInt(m[4], 10) : 0;

    // digits = intPart.fracPart as an integer, with scale 10^-fracLen
    let digits = BigInt(intPart + (fracPart || ''));
    let scale10 = fracPart.length - exp10; // value = digits * 10^-scale10

    if (scale10 < 0) {
      digits *= 10n ** BigInt(-scale10);
      scale10 = 0;
    }
    // value * 2^p = digits * 2^p / 10^scale10
    const num = digits << this.pb;
    const den = 10n ** BigInt(scale10);
    const q = (num + den / 2n) / den; // round-to-nearest, not truncate
    return sign * q;
  }

  /** Render as a plain decimal string with `digits` places after the point. */
  toString(a: Fx, digits: number): string {
    const neg = a < 0n;
    const v = neg ? -a : a;
    const half = 1n << (this.pb - 1n);
    const scaled = (v * 10n ** BigInt(digits) + half) >> this.pb;
    let s = scaled.toString();
    if (digits === 0) return (neg ? '-' : '') + s;
    if (s.length <= digits) s = s.padStart(digits + 1, '0');
    const ip = s.slice(0, s.length - digits);
    const fp = s.slice(s.length - digits);
    return `${neg ? '-' : ''}${ip}.${fp}`;
  }

  /** Decimal digits worth printing at this precision (log10(2) ≈ 0.30103). */
  get decimalDigits(): number {
    return Math.max(6, Math.ceil(this.p * 0.30103));
  }
}

/** Integer division rounded to nearest, symmetric about zero. */
function divRound(a: bigint, b: bigint): bigint {
  const neg = a < 0n !== b < 0n;
  const an = a < 0n ? -a : a;
  const bn = b < 0n ? -b : b;
  const q = (an + (bn >> 1n)) / bn;
  return neg ? -q : q;
}

export function bitLength(v: bigint): number {
  if (v === 0n) return 0;
  let n = v < 0n ? -v : v;
  let bits = 0;
  // Chunk by 64 bits to keep toString(2) off the hot path for huge values.
  while (n >= 0x10000000000000000n) {
    n >>= 64n;
    bits += 64;
  }
  return bits + n.toString(2).length;
}
