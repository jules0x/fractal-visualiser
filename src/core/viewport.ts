/**
 * Camera state.
 *
 * The centre is held in arbitrary-precision fixed point and the zoom as a
 * log2 exponent, so neither runs out of headroom the way a float64 pair does
 * around 10^14. Working precision is re-derived from the zoom depth whenever it
 * moves materially, and existing coordinates are rescaled into the new context.
 */

import { FixedCtx, type Fx } from './fixed.ts';

/** View half-height expressed as mant * 2^-exp, with mant in [1, 2). */
export interface ScaleParts {
  mant: number;
  exp: number;
}

export class Viewport {
  ctx: FixedCtx;

  /** Animated centre. */
  cx: Fx = 0n;
  cy: Fx = 0n;
  /** Centre the animation is easing toward. */
  tcx: Fx = 0n;
  tcy: Fx = 0n;

  log2Zoom = 0;
  tLog2Zoom = 0;

  /** Hard floor so you can always zoom back out to the whole set. */
  readonly minLog2Zoom = -2;
  /** 2^1100 ≈ 10^331. Far past anything interactive; just a sanity rail. */
  readonly maxLog2Zoom = 1100;

  constructor() {
    this.ctx = new FixedCtx(FixedCtx.precisionForLog2Zoom(0));
  }

  /** View half-height in complex units = 2 / zoom = 2^(1 - log2Zoom). */
  scaleParts(): ScaleParts {
    const l = 1 - this.log2Zoom;
    const exp = Math.ceil(-l);
    const mant = Math.pow(2, l + exp);
    return { mant, exp };
  }

  /** The same quantity as a plain float, for the shallow direct render paths. */
  halfHeightFloat(): number {
    return Math.pow(2, 1 - this.log2Zoom);
  }

  /** Raise working precision if the current depth calls for it. */
  syncPrecision(): void {
    const want = FixedCtx.precisionForLog2Zoom(Math.max(this.log2Zoom, this.tLog2Zoom));
    // Hysteresis: only rebuild when meaningfully off, so panning doesn't churn.
    if (want > this.ctx.p || want < this.ctx.p - 128) {
      const next = new FixedCtx(want);
      this.cx = next.rescaleFrom(this.cx, this.ctx);
      this.cy = next.rescaleFrom(this.cy, this.ctx);
      this.tcx = next.rescaleFrom(this.tcx, this.ctx);
      this.tcy = next.rescaleFrom(this.tcy, this.ctx);
      this.ctx = next;
    }
  }

  /**
   * Convert a normalised screen offset (±1 on the short axis) into a
   * fixed-point complex offset, without ever materialising the tiny float.
   */
  normToOffset(n: number): Fx {
    const { mant, exp } = this.scaleParts();
    const base = this.ctx.fromNumber(n * mant);
    if (exp <= 0) return base << BigInt(-exp);
    const sh = BigInt(exp);
    return base < 0n ? -((-base) >> sh) : base >> sh;
  }

  /** Complex coordinate under a normalised screen position, at the target camera. */
  targetPointAt(nx: number, ny: number): [Fx, Fx] {
    const saved = this.log2Zoom;
    this.log2Zoom = this.tLog2Zoom;
    const px = this.tcx + this.normToOffset(nx);
    const py = this.tcy + this.normToOffset(ny);
    this.log2Zoom = saved;
    return [px, py];
  }

  /** Drag-pan by a normalised screen delta. */
  pan(dnx: number, dny: number): void {
    const saved = this.log2Zoom;
    this.log2Zoom = this.tLog2Zoom;
    this.tcx -= this.normToOffset(dnx);
    this.tcy -= this.normToOffset(dny);
    this.log2Zoom = saved;
  }

  /**
   * Zoom by `dLog2` steps while pinning the complex point under (nx, ny).
   * Both the anchor and the resulting centre are computed in fixed point, so
   * the pin holds at any depth.
   */
  zoomAt(nx: number, ny: number, dLog2: number): void {
    const [px, py] = this.targetPointAt(nx, ny);
    const prev = this.ctx;

    this.tLog2Zoom = Math.min(this.maxLog2Zoom, Math.max(this.minLog2Zoom, this.tLog2Zoom + dLog2));
    this.syncPrecision(); // may swap this.ctx out from under us

    const anchorX = this.ctx.rescaleFrom(px, prev);
    const anchorY = this.ctx.rescaleFrom(py, prev);

    const saved = this.log2Zoom;
    this.log2Zoom = this.tLog2Zoom;
    this.tcx = anchorX - this.normToOffset(nx);
    this.tcy = anchorY - this.normToOffset(ny);
    this.log2Zoom = saved;
  }

  /** Ease current state toward target. Returns true if anything moved. */
  step(alpha: number): boolean {
    const dz = this.tLog2Zoom - this.log2Zoom;
    const dx = this.tcx - this.cx;
    const dy = this.tcy - this.cy;

    if (Math.abs(dz) < 1e-9 && dx === 0n && dy === 0n) return false;

    if (Math.abs(dz) < 1e-6) this.log2Zoom = this.tLog2Zoom;
    else this.log2Zoom += dz * alpha;

    const a = this.ctx.fromNumber(alpha);
    const stepX = this.ctx.mul(dx, a);
    const stepY = this.ctx.mul(dy, a);
    // Below one ulp of the easing step, snap — otherwise deep views creep
    // forever a few bits at a time and never settle.
    this.cx = stepX === 0n ? this.tcx : this.cx + stepX;
    this.cy = stepY === 0n ? this.tcy : this.cy + stepY;
    return true;
  }

  /**
   * Jump straight to a state with no easing. `srcCtx` describes the precision
   * `cx`/`cy` were built at, if it differs from the viewport's current one.
   */
  snapTo(cx: Fx, cy: Fx, log2Zoom: number, srcCtx?: FixedCtx): void {
    this.tLog2Zoom = Math.min(this.maxLog2Zoom, Math.max(this.minLog2Zoom, log2Zoom));
    this.log2Zoom = this.tLog2Zoom;
    // Capture the context the caller was working in before the depth change
    // swaps it out, or the incoming mantissas get read at the wrong scale.
    const prev = this.ctx;
    this.syncPrecision();
    const from = srcCtx ?? prev;
    this.cx = this.tcx = this.ctx.rescaleFrom(cx, from);
    this.cy = this.tcy = this.ctx.rescaleFrom(cy, from);
  }

  /** Ease toward a state. Same `srcCtx` contract as `snapTo`. */
  setTarget(cx: Fx, cy: Fx, log2Zoom: number, srcCtx?: FixedCtx): void {
    this.tLog2Zoom = Math.min(this.maxLog2Zoom, Math.max(this.minLog2Zoom, log2Zoom));
    const prev = this.ctx;
    this.syncPrecision();
    const from = srcCtx ?? prev;
    this.tcx = this.ctx.rescaleFrom(cx, from);
    this.tcy = this.ctx.rescaleFrom(cy, from);
  }

  get zoomLabel(): string {
    const l10 = this.log2Zoom * Math.LOG10E * Math.LN2;
    if (l10 < 4) return `${Math.pow(10, l10).toFixed(2)}×`;
    const e = Math.floor(l10);
    const m = Math.pow(10, l10 - e);
    return `${m.toFixed(2)}e${e}×`;
  }

  /** Enough digits to identify the view, plus a couple of spares. */
  get displayDigits(): number {
    return Math.max(6, Math.ceil(this.log2Zoom * 0.30103) + 4);
  }
}
