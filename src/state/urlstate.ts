/**
 * Shareable view state, packed into the URL fragment.
 *
 * The centre is carried as a decimal *string*, not a float, because past about
 * 10^14 zoom a float64 no longer distinguishes neighbouring views — a link
 * built from floats would silently land somewhere else. Zoom travels as a log2
 * exponent, which stays exact enough at any depth and is short.
 *
 * The payload lives in the fragment (`#v=...`) so it never reaches a server.
 */

import type { Category, FractalMode, ModeParams, Settings, VisualMode, VisualParams } from './types.ts';
import { defaultSettings, MODES, VISUAL_MODES } from './types.ts';

export interface ViewState {
  category: Category;
  mode: FractalMode;
  /** Centre as decimal strings. */
  cx: string;
  cy: string;
  /** log2 of the zoom factor. */
  z: number;
  iterations: number;
  palette: string;
  colorDensity: number;
  flowSpeed: number;
  antialias: boolean;
  params: ModeParams;
  visualMode: VisualMode;
  visualParams: VisualParams;
  /** Continuous hue rotation, in degrees per second — see Settings.hueSpin. */
  hueSpin: number;
}

interface Packed {
  /** v1 links (no visualizer fields) still decode; v2 carries the full state. */
  v: 1 | 2;
  cat?: 'f' | 'v';
  m: FractalMode;
  x: string;
  y: string;
  z: number;
  i: number;
  p: string;
  d: number;
  f: number;
  a: 0 | 1;
  pr: [string, string, number, number, number];
  vm?: VisualMode;
  /** speed, warp, complexity, symmetry, zoom — zoom is absent on older links. */
  vpr?: number[];
  hs?: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeState(s: ViewState): string {
  const packed: Packed = {
    v: 2,
    cat: s.category === 'visual' ? 'v' : 'f',
    m: s.mode,
    x: s.cx,
    y: s.cy,
    z: Math.round(s.z * 1e6) / 1e6,
    i: s.iterations,
    p: s.palette,
    d: Math.round(s.colorDensity * 1000) / 1000,
    f: Math.round(s.flowSpeed * 1000) / 1000,
    a: s.antialias ? 1 : 0,
    pr: [s.params.cr, s.params.ci, s.params.power, s.params.newtonPower, s.params.relaxation],
    vm: s.visualMode,
    vpr: [
      s.visualParams.speed,
      s.visualParams.warp,
      s.visualParams.complexity,
      s.visualParams.symmetry,
      s.visualParams.zoom,
    ],
    hs: Math.round(s.hueSpin * 100) / 100,
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(packed)));
}

export function decodeState(token: string): ViewState | null {
  try {
    const json = new TextDecoder().decode(fromBase64Url(token));
    const p = JSON.parse(json) as Partial<Packed>;
    if (p.v !== 1 && p.v !== 2) return null;

    const mode = MODES.includes(p.m as FractalMode) ? (p.m as FractalMode) : 'mandelbrot';
    const pr = Array.isArray(p.pr) ? p.pr : [];
    const vpr = Array.isArray(p.vpr) ? p.vpr : [];
    const d = defaultSettings();
    const vm = VISUAL_MODES.includes(p.vm as VisualMode) ? (p.vm as VisualMode) : d.visualMode;

    return {
      category: p.cat === 'v' ? 'visual' : 'fractal',
      mode,
      cx: typeof p.x === 'string' ? p.x : '0',
      cy: typeof p.y === 'string' ? p.y : '0',
      z: numOr(p.z, 0),
      iterations: clamp(Math.round(numOr(p.i, 400)), 20, 100000),
      palette: typeof p.p === 'string' ? p.p : d.palette,
      colorDensity: clamp(numOr(p.d, 1), 0.05, 8),
      flowSpeed: clamp(numOr(p.f, 0), -5, 5),
      antialias: p.a === 1,
      params: {
        cr: typeof pr[0] === 'string' ? pr[0] : d.params.cr,
        ci: typeof pr[1] === 'string' ? pr[1] : d.params.ci,
        power: clamp(numOr(pr[2] as number, 2), 1, 8),
        newtonPower: clamp(Math.round(numOr(pr[3] as number, 3)), 2, 12),
        relaxation: clamp(numOr(pr[4] as number, 1), 0.1, 2.5),
      },
      visualMode: vm,
      visualParams: {
        speed: clamp(numOr(vpr[0] as number, d.visualParams.speed), 0.05, 6),
        warp: clamp(numOr(vpr[1] as number, d.visualParams.warp), 0, 3),
        complexity: clamp(numOr(vpr[2] as number, d.visualParams.complexity), 1, 8),
        symmetry: clamp(numOr(vpr[3] as number, d.visualParams.symmetry), 2, 16),
        zoom: clamp(numOr(vpr[4] as number, d.visualParams.zoom), 0.1, 10),
      },
      hueSpin: clamp(numOr(p.hs, 0), -360, 360),
    };
  } catch {
    return null;
  }
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Read a state token out of `location.hash`, if there is one. */
export function readHashState(hash: string): ViewState | null {
  const m = /(?:^#|[#&])v=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? decodeState(m[1]) : null;
}

export function buildShareUrl(base: string, s: ViewState): string {
  const clean = base.split('#')[0];
  return `${clean}#v=${encodeState(s)}`;
}

export function settingsFromState(s: ViewState): Settings {
  return {
    category: s.category,
    mode: s.mode,
    visualMode: s.visualMode,
    visualParams: { ...s.visualParams },
    palette: s.palette,
    iterations: s.iterations,
    colorDensity: s.colorDensity,
    flowSpeed: s.flowSpeed,
    hueSpin: s.hueSpin,
    antialias: s.antialias,
    params: { ...s.params },
  };
}
