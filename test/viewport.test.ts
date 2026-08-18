import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedCtx } from '../src/core/fixed.ts';
import { Viewport } from '../src/core/viewport.ts';

test('scaleParts decomposes the view half-height exactly', () => {
  const vp = new Viewport();
  for (const z of [0, 1, 7.3, 56.2, 333.1, 800]) {
    vp.snapTo(0n, 0n, z);
    const { mant, exp } = vp.scaleParts();
    assert.ok(mant >= 1 && mant < 2, `mantissa ${mant} out of [1,2) at z=${z}`);
    // mant * 2^-exp must equal 2^(1-z), computed via logs to dodge overflow.
    const got = Math.log2(mant) - exp;
    assert.ok(Math.abs(got - (1 - z)) < 1e-9, `half-height wrong at z=${z}`);
  }
});

test('normToOffset scales with depth and stays exact', () => {
  const vp = new Viewport();
  vp.snapTo(0n, 0n, 100);
  const off = vp.normToOffset(1);
  // Half-height at zoom 2^100 is 2^-99.
  const expected = Math.pow(2, -99);
  const got = vp.ctx.toNumber(off);
  assert.ok(Math.abs(got / expected - 1) < 1e-12, `${got} vs ${expected}`);
  assert.equal(vp.normToOffset(-1), -off);
  assert.equal(vp.normToOffset(0), 0n);
});

test('zooming pins the complex point under the cursor at any depth', () => {
  for (const startZoom of [0, 40, 200]) {
    const vp = new Viewport();
    vp.snapTo(vp.ctx.fromString('-0.5'), 0n, startZoom);

    const nx = 0.6;
    const ny = -0.35;
    const [beforeX, beforeY] = vp.targetPointAt(nx, ny);
    const beforeCtx = vp.ctx;

    vp.zoomAt(nx, ny, 9);

    const [afterX, afterY] = vp.targetPointAt(nx, ny);
    const bx = vp.ctx.rescaleFrom(beforeX, beforeCtx);
    const by = vp.ctx.rescaleFrom(beforeY, beforeCtx);

    // The anchor must hold to well within one pixel of the *new*, deeper view.
    const pixel = vp.normToOffset(2 / 1000);
    const driftX = afterX > bx ? afterX - bx : bx - afterX;
    const driftY = afterY > by ? afterY - by : by - afterY;
    assert.ok(driftX < pixel, `x drifted at start zoom 2^${startZoom}`);
    assert.ok(driftY < pixel, `y drifted at start zoom 2^${startZoom}`);
  }
});

test('precision grows with depth and coordinates survive the rescale', () => {
  const vp = new Viewport();
  const start = vp.ctx.fromString('-0.7445398603559083801');
  vp.snapTo(start, 0n, 0);
  const shallowDigits = vp.ctx.toString(vp.cx, 19);

  vp.zoomAt(0, 0, 500);
  assert.ok(vp.ctx.p > 500, `expected >500 bits at 2^500, got ${vp.ctx.p}`);
  assert.equal(vp.ctx.toString(vp.cx, 19), shallowDigits, 'centre changed while zooming on it');
});

test('zoom is clamped at both ends', () => {
  const vp = new Viewport();
  vp.zoomAt(0, 0, -100);
  assert.equal(vp.tLog2Zoom, vp.minLog2Zoom);
  vp.zoomAt(0, 0, 99999);
  assert.equal(vp.tLog2Zoom, vp.maxLog2Zoom);
});

test('easing converges and then reports no further movement', () => {
  const vp = new Viewport();
  vp.setTarget(vp.ctx.fromString('0.25'), vp.ctx.fromString('-0.1'), 12);
  let guard = 0;
  while (vp.step(0.18) && guard++ < 1000);
  assert.ok(guard < 1000, 'easing never settled');
  assert.equal(vp.cx, vp.tcx);
  assert.equal(vp.cy, vp.tcy);
  assert.equal(vp.log2Zoom, vp.tLog2Zoom);
});

test('zoom label reads sensibly across the range', () => {
  const vp = new Viewport();
  vp.snapTo(0n, 0n, 0);
  assert.equal(vp.zoomLabel, '1.00×');
  vp.snapTo(0n, 0n, Math.log2(1e100));
  assert.match(vp.zoomLabel, /^1\.00e100×$/);
});

test('display digits keep pace with depth', () => {
  const vp = new Viewport();
  vp.snapTo(0n, 0n, 0);
  assert.ok(vp.displayDigits >= 6);
  vp.snapTo(0n, 0n, Math.log2(1e60));
  assert.ok(vp.displayDigits >= 60, `only ${vp.displayDigits} digits at 1e60 zoom`);
  assert.ok(vp.ctx.p > vp.displayDigits * 3.32, 'not enough bits behind the printed digits');
});

test('snapTo keeps the centre when the jump itself raises precision', () => {
  // Regression: snapTo bumps precision for the new depth before storing the
  // centre. If the incoming mantissa is not rescaled it gets read at the new
  // scale and the view lands 2^-p away from where it was asked to go.
  const vp = new Viewport();
  const shallow = vp.ctx;
  const cx = shallow.fromString('-0.743643887037151');
  const cy = shallow.fromString('0.131825904205330');

  vp.snapTo(cx, cy, 300); // no srcCtx: values are in the viewport's own context
  assert.ok(vp.ctx.p > 300, 'precision should have grown');
  assert.equal(vp.ctx.toString(vp.cx, 15), '-0.743643887037151');
  assert.equal(vp.ctx.toString(vp.cy, 15), '0.131825904205330');
  assert.equal(vp.cx, vp.tcx);

  // And explicitly tagging the source context must agree.
  const other = new Viewport();
  other.snapTo(cx, cy, 300, shallow);
  assert.equal(other.ctx.toString(other.cx, 15), '-0.743643887037151');
});

test('a precision bump does not disturb the centre', () => {
  const vp = new Viewport();
  const ctx = new FixedCtx(FixedCtx.precisionForLog2Zoom(0));
  vp.snapTo(ctx.fromString('-0.123456789012345'), ctx.fromString('0.745'), 0);
  const before = vp.ctx.toString(vp.cx, 15);
  vp.tLog2Zoom = 400;
  vp.syncPrecision();
  assert.equal(vp.ctx.toString(vp.cx, 15), before);
});
