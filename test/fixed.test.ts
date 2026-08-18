import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedCtx } from '../src/core/fixed.ts';
import { dwell, mandelbrotReference, juliaReference } from '../src/core/reference.ts';

test('number round-trip', () => {
  const ctx = new FixedCtx(128);
  for (const v of [0, 1, -1, 0.5, -0.75, 2, -1.7549, 0.27015, 1e-9, -3.25e-7]) {
    assert.ok(Math.abs(ctx.toNumber(ctx.fromNumber(v)) - v) < 1e-15 * Math.max(1, Math.abs(v)));
  }
});

test('decimal string round-trip keeps digits float64 would lose', () => {
  const ctx = new FixedCtx(256);
  const s = '-0.74453986035590838011';
  const v = ctx.fromString(s);
  assert.equal(ctx.toString(v, 20), s);
  // float64 cannot hold this: it collapses to 17 significant digits.
  assert.notEqual((-0.74453986035590838011).toFixed(20), s);
});

test('scientific notation parses', () => {
  const ctx = new FixedCtx(160);
  assert.ok(Math.abs(ctx.toNumber(ctx.fromString('1.25e-3')) - 0.00125) < 1e-18);
  assert.ok(Math.abs(ctx.toNumber(ctx.fromString('-2.5E2')) + 250) < 1e-12);
});

test('arithmetic matches float64 on well-conditioned inputs', () => {
  const ctx = new FixedCtx(192);
  const a = ctx.fromNumber(0.375);
  const b = ctx.fromNumber(-1.25);
  assert.ok(Math.abs(ctx.toNumber(ctx.add(a, b)) - -0.875) < 1e-30);
  assert.ok(Math.abs(ctx.toNumber(ctx.sub(a, b)) - 1.625) < 1e-30);
  assert.ok(Math.abs(ctx.toNumber(ctx.mul(a, b)) - -0.46875) < 1e-30);
  assert.ok(Math.abs(ctx.toNumber(ctx.sqr(b)) - 1.5625) < 1e-30);
});

test('rescaling between precisions preserves value', () => {
  const lo = new FixedCtx(96);
  const hi = new FixedCtx(320);
  const v = lo.fromString('-0.743643887037151');
  const up = hi.rescaleFrom(v, lo);
  assert.equal(hi.toString(up, 15), '-0.743643887037151');
  const back = lo.rescaleFrom(up, hi);
  assert.equal(back, v);
});

// Munafo's pi-in-Seahorse-Valley identity: dwell(-3/4 + (10^-n) i) reproduces
// the digits of pi. A genuinely demanding check of the fixed-point iteration —
// it is stated for the classical escape radius of 2, hence the override.
// http://www.mrob.com/pub/muency/seahorsevalley.html
test('dwell(-3/4 + eps i) reproduces digits of pi', () => {
  const ctx = new FixedCtx(128);
  const cx = ctx.fromString('-0.75');
  const radiusTwo = 4n << BigInt(ctx.p);
  const cases: Array<[string, number]> = [
    ['1', 3],
    ['0.1', 33],
    ['0.01', 315],
    ['0.001', 3143],
    ['0.0001', 31417],
    ['0.00001', 314160],
  ];
  for (const [eps, expected] of cases) {
    assert.equal(
      dwell(ctx, cx, ctx.fromString(eps), 400000, radiusTwo),
      expected,
      `eps=${eps}`,
    );
  }
});

test('mandelbrot reference stays bounded inside the set and escapes outside', () => {
  const ctx = new FixedCtx(128);
  const inside = mandelbrotReference(ctx, ctx.fromString('-0.5'), 0n, 500);
  assert.equal(inside.escaped, false);
  assert.equal(inside.length, 501);
  for (let i = 0; i < inside.length; i++) {
    const x = inside.data[i * 2];
    const y = inside.data[i * 2 + 1];
    assert.ok(x * x + y * y <= 4.0000001, `|Z_${i}| stayed bounded`);
  }
  assert.equal(inside.z0x, 0);
  assert.equal(inside.z0y, 0);

  const outside = mandelbrotReference(ctx, ctx.fromString('1.0'), 0n, 500);
  assert.equal(outside.escaped, true);
  assert.ok(outside.length < 10);
});

test('reference orbit of a deep Seahorse Valley point survives 20 decimal digits', () => {
  // Munafo's period-1312 island, far past float64's resolving power.
  const ctx = new FixedCtx(FixedCtx.precisionForLog2Zoom(Math.log2(1e17)));
  const cx = ctx.fromString('-0.74453986035590838011');
  const cy = ctx.fromString('0.12172377389442482241');
  const orbit = mandelbrotReference(ctx, cx, cy, 4000);
  assert.equal(orbit.escaped, false, 'a point on a period-1312 island must not escape');
  assert.equal(orbit.length, 4001);
});

test('julia reference starts at the view centre', () => {
  const ctx = new FixedCtx(128);
  const orbit = juliaReference(
    ctx,
    ctx.fromString('0.1'),
    ctx.fromString('-0.2'),
    ctx.fromString('-0.123'),
    ctx.fromString('0.745'),
    100,
  );
  assert.ok(Math.abs(orbit.z0x - 0.1) < 1e-12);
  assert.ok(Math.abs(orbit.z0y - -0.2) < 1e-12);
  assert.ok(Math.abs(orbit.data[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(orbit.data[1] - -0.2) < 1e-6);
});

test('precisionForLog2Zoom grows with depth', () => {
  assert.ok(FixedCtx.precisionForLog2Zoom(0) >= 64);
  const deep = FixedCtx.precisionForLog2Zoom(Math.log2(1e100));
  assert.ok(deep > 330, `expected >330 bits at 1e100 zoom, got ${deep}`);
});

/**
 * Reciprocals of small values, which fixed point makes easy to get wrong.
 *
 * The scale is absolute, so |a|^2 vanishes long before |a| does: at 96 bits,
 * |a| = 1e-6 is still resolved to twenty-odd significant bits while |a|^2 has
 * five and |a|^5 has none. A reciprocal routed through norm2 therefore reports
 * a pole at every point near one — which is exactly where Newton's map needs
 * it most.
 */
test('complex reciprocal survives values near the pole', () => {
  const ctx = new FixedCtx(96);
  for (const mag of [1, 1e-3, 1e-6, 1e-9, 1e-12, 1e-15]) {
    const x = ctx.fromNumber(mag * 0.7237);
    const y = ctx.fromNumber(mag * -0.6901);
    const inv = ctx.cinv(x, y);
    assert.ok(inv, `reported a pole at |a| = ${mag}`);

    // a * (1/a) must be 1.
    const [px, py] = ctx.cmul(x, y, inv[0], inv[1]);
    assert.ok(
      Math.abs(ctx.toNumber(px) - 1) < 1e-9,
      `|a| = ${mag}: real part came out ${ctx.toNumber(px)}`,
    );
    assert.ok(Math.abs(ctx.toNumber(py)) < 1e-9, `|a| = ${mag}: imaginary part not zero`);
  }
  assert.equal(ctx.cinv(0n, 0n), null, 'an exact zero is the one real pole');
});

test('integer powers of a reciprocal keep their precision', () => {
  const ctx = new FixedCtx(96);
  // |Z| = 1e-6 with q = 5: Z^5 is 1e-30, far below one ulp at this precision,
  // so the answer has to be reached as (1/Z)^5 rather than 1/(Z^5).
  const inv = ctx.cinv(ctx.fromNumber(6e-6), ctx.fromNumber(4e-6));
  assert.ok(inv);
  const [px, py] = ctx.cpowi(inv[0], inv[1], 5);
  const want = Math.pow(Math.hypot(6e-6, 4e-6), -5);
  assert.ok(
    Math.abs(Math.hypot(ctx.toNumber(px), ctx.toNumber(py)) / want - 1) < 1e-9,
    'magnitude of (1/Z)^5 is wrong',
  );
});
