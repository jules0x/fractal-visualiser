import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareUrl,
  decodeState,
  encodeState,
  readHashState,
  type ViewState,
} from '../src/state/urlstate.ts';
import { PRESETS, radiusToLog2Zoom } from '../src/state/presets.ts';
import { MODES } from '../src/state/types.ts';
import { FixedCtx } from '../src/core/fixed.ts';
import {
  DYNAMIC_PALETTES,
  PALETTES,
  buildPaletteLut,
  oklchToRgb8,
  paletteById,
} from '../src/render/palettes.ts';

const deep: ViewState = {
  category: 'fractal',
  mode: 'mandelbrot',
  cx: '-0.74453986035590838011',
  cy: '0.12172377389442482241',
  z: 57.243,
  iterations: 8000,
  palette: 'glacier',
  colorDensity: 1.35,
  flowSpeed: -0.4,
  hueSpin: -22.5,
  antialias: true,
  params: { cr: '-0.123', ci: '0.745', power: 2, newtonPower: 3, relaxation: 1 },
  visualMode: 'plasma',
  visualParams: { speed: 1.5, warp: 0.8, complexity: 5, symmetry: 8, zoom: 2.25 },
};

test('URL state round-trips without touching float64', () => {
  const back = decodeState(encodeState(deep));
  if (!back) throw new Error('a state token failed to decode');
  assert.deepEqual(back, deep);
  // The centre must survive as written — this is the whole reason it is a
  // string. Through a float64 the last four digits would be gone.
  assert.equal(back.cx, deep.cx);
  assert.notEqual(String(Number(deep.cx)), deep.cx);
});

test('share URLs are fragment-only and re-readable', () => {
  const url = buildShareUrl('https://example.com/aether/?utm=x#v=stale', deep);
  assert.ok(url.startsWith('https://example.com/aether/?utm=x#v='));
  const back = readHashState(new URL(url).hash);
  if (!back) throw new Error('share URL did not round-trip');
  assert.equal(back.cx, deep.cx);
  assert.equal(back.z, deep.z);
});

test('token is URL-safe', () => {
  assert.match(encodeState(deep), /^[A-Za-z0-9_-]+$/);
});

test('garbage decodes to null rather than throwing', () => {
  for (const bad of ['', 'not-base64!!', 'YWJj', btoa('{"v":9}')]) {
    assert.equal(decodeState(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  assert.equal(readHashState('#nothing=here'), null);
});

test('out-of-range values are clamped on decode', () => {
  const wild = decodeState(
    encodeState({ ...deep, iterations: 10 ** 9, colorDensity: 500, flowSpeed: -99 }),
  );
  if (!wild) throw new Error('clamped state failed to decode');
  assert.ok(wild.iterations <= 100000 && wild.iterations >= 20);
  assert.ok(wild.colorDensity <= 8);
  assert.ok(wild.flowSpeed >= -5);
});

test('every preset parses, sits in the plane, and has a sane budget', () => {
  for (const mode of MODES) {
    const list = PRESETS[mode];
    assert.equal(list.length, 6, `${mode} should ship 6 presets`);
    for (const p of list) {
      const z = radiusToLog2Zoom(p.radius);
      const ctx = new FixedCtx(FixedCtx.precisionForLog2Zoom(z));
      const x = ctx.toNumber(ctx.fromString(p.cx));
      const y = ctx.toNumber(ctx.fromString(p.cy));
      assert.ok(Math.abs(x) <= 2.5 && Math.abs(y) <= 2.5, `${p.name} is off the plane`);
      assert.ok(p.radius > 0 && p.radius <= 2, `${p.name} has a silly radius`);
      assert.ok(p.iterations >= 50 && p.iterations <= 20000, `${p.name} budget out of range`);
      assert.ok(p.note.length > 20, `${p.name} has no provenance note`);
      if (p.params?.cr !== undefined) {
        assert.doesNotThrow(() => ctx.fromString(p.params!.cr!), `${p.name} cr unparseable`);
        assert.doesNotThrow(() => ctx.fromString(p.params!.ci!), `${p.name} ci unparseable`);
      }
    }
  }
});

test('the deep preset really is deeper than float64 can address', () => {
  const deepest = PRESETS.mandelbrot.find((p) => p.name.includes('1312'));
  if (!deepest) throw new Error('the deep showcase preset is missing');
  assert.ok(deepest.radius < 1e-16, 'the showcase preset should be past the float64 ceiling');
  assert.ok(radiusToLog2Zoom(deepest.radius) > 55);
});

test('radiusToLog2Zoom inverts the half-height relation', () => {
  for (const r of [1.3, 0.02, 1e-17]) {
    assert.ok(Math.abs(Math.pow(2, 1 - radiusToLog2Zoom(r)) / r - 1) < 1e-12);
  }
});

/* ------------------------------------------------------------------ colour */

test('OKLCH converts to the sRGB primaries it should', () => {
  // Ottosson's published sRGB-red coordinates.
  const [r, g, b] = oklchToRgb8(0.62796, 0.25768, 29.234);
  assert.ok(r > 250 && g < 12 && b < 12, `expected red, got ${r},${g},${b}`);
  const [wr, wg, wb] = oklchToRgb8(1, 0, 0);
  assert.ok(wr > 250 && wg > 250 && wb > 250, `expected white, got ${wr},${wg},${wb}`);
  const [kr, kg, kb] = oklchToRgb8(0, 0, 0);
  assert.equal(kr + kg + kb, 0, 'L=0 should be black');
});

test('out-of-gamut chroma is reduced, not clipped to a flat channel', () => {
  // Wildly out-of-gamut chroma at mid lightness.
  const [r, g, b] = oklchToRgb8(0.5, 0.9, 150);
  for (const v of [r, g, b]) assert.ok(v >= 0 && v <= 255);
  assert.ok(g > r && g > b, 'hue should survive gamut mapping');
});

test('every palette bakes to a clean, looping ramp', () => {
  assert.equal(PALETTES.length, 10);
  const ids = new Set(PALETTES.map((p) => p.id));
  assert.equal(ids.size, 10, 'palette ids must be unique');

  for (const p of PALETTES) {
    assert.equal(p.stops.length, 4, `${p.name} should have 4 stops`);
    const lut = buildPaletteLut(p, 256);
    assert.equal(lut.length, 256 * 4);

    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 3; c++) {
        const v = lut[i * 4 + c];
        assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${p.name} bad channel at ${i}`);
      }
      assert.equal(lut[i * 4 + 3], 255, `${p.name} must be opaque`);
    }

    // Seamless wrap: the last entry has to sit next to the first, or the flow
    // animation shows a hard line every cycle.
    const step = (a: number, b: number) =>
      Math.abs(lut[a * 4] - lut[b * 4]) +
      Math.abs(lut[a * 4 + 1] - lut[b * 4 + 1]) +
      Math.abs(lut[a * 4 + 2] - lut[b * 4 + 2]);
    let biggestInterior = 0;
    for (let i = 1; i < 255; i++) biggestInterior = Math.max(biggestInterior, step(i, i + 1));
    assert.ok(
      step(255, 0) <= Math.max(6, biggestInterior * 1.5),
      `${p.name} has a seam at the wrap point`,
    );

    // And it must actually go somewhere. Measured per channel rather than on
    // summed luminance, because a rainbow ramp deliberately holds lightness
    // roughly constant and travels in hue instead — it is not a flat wash, and
    // a luminance-only check would call it one.
    let travel = 0;
    for (let c = 0; c < 3; c++) {
      const ch = Array.from({ length: 256 }, (_, i) => lut[i * 4 + c]);
      travel += Math.max(...ch) - Math.min(...ch);
    }
    assert.ok(travel > 180, `${p.name} is too flat`);
  }
});

test('unknown palette id falls back rather than throwing', () => {
  assert.equal(paletteById('nope').id, PALETTES[0].id);
  assert.equal(paletteById('glacier').name, 'Glacier');
});

test('dynamic palettes bake cleanly, spin, and do not collide with static ids', () => {
  assert.equal(DYNAMIC_PALETTES.length, 3);

  const staticIds = new Set(PALETTES.map((p) => p.id));
  const dynIds = new Set(DYNAMIC_PALETTES.map((p) => p.id));
  assert.equal(dynIds.size, DYNAMIC_PALETTES.length, 'dynamic palette ids must be unique');
  for (const id of dynIds) assert.ok(!staticIds.has(id), `${id} collides with a static palette`);

  for (const p of DYNAMIC_PALETTES) {
    assert.equal(p.stops.length, 4, `${p.name} should have 4 stops`);
    assert.notEqual(p.spin, 0, `${p.name} should actually spin`);
    const lut = buildPaletteLut(p, 64);
    assert.equal(lut.length, 64 * 4);
    // paletteById must find these too — the panel looks palettes up by id
    // without caring which list they came from.
    assert.equal(paletteById(p.id).id, p.id);
  }
});
