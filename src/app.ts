/**
 * Application core: owns the camera, the settings, the reference orbit and the
 * render loop, and knows how to serialise itself to and from a shareable URL.
 * The UI layer talks to this and nothing below it.
 */

import { FixedCtx, type Fx } from './core/fixed.ts';
import { Viewport } from './core/viewport.ts';
import {
  juliaReference,
  mandelbrotReference,
  newtonReference,
  type ReferenceOrbit,
} from './core/reference.ts';
import { adaptScale, clampFlight, decayFlight } from './core/tuning.ts';
import { Renderer, SHADER_MODE, VISUAL_SHADER_MODE } from './render/renderer.ts';
import { defaultSettings, defaultVisualParams, type FractalMode, type Settings } from './state/types.ts';
import { loadPrefs, savePrefs, type Prefs } from './state/prefs.ts';
import {
  buildShareUrl,
  readHashState,
  settingsFromState,
  type ViewState,
} from './state/urlstate.ts';
import { PRESETS, radiusToLog2Zoom, type Preset } from './state/presets.ts';

// Bumped whenever a field is added to ViewState — an older session would
// otherwise restore with that field missing (e.g. `undefined`) rather than
// defaulted, which for a number like hueSpin turns into NaN once it reaches
// arithmetic.
const SESSION_KEY = 'aether.session.v4';

/** How long after the last input the view is still considered "in motion". */
const SETTLE_MS = 170;
/** Steering speed in half-screens per second. */
const STEER_SPEED = 0.85;

/**
 * Where to try seeding a Newton reference, in normalised view units, in order.
 *
 * The centre first, which is best conditioned when it works. After that,
 * points spread around the frame and off both axes, so a symmetric view cannot
 * keep landing on the same singularity. A view sitting *on* the pole needs
 * several tries: everything on screen is close to the origin there, and it is
 * the distance from the origin that decides whether the orbit stays inside
 * float32.
 */
const REFERENCE_SEEDS: readonly [number, number][] = [
  [0, 0],
  [0.5, 0.25],
  [-0.37, 0.61],
  [0.83, -0.44],
  [-0.68, -0.79],
];

export class App {
  readonly vp = new Viewport();
  readonly renderer: Renderer;
  settings: Settings = defaultSettings();
  prefs: Prefs = loadPrefs();

  /**
   * Zoom velocity in powers of two per second. A scroll gesture adds thrust and
   * this coasts down afterwards, so exploring feels like steering a descent
   * rather than issuing a series of discrete jumps.
   */
  zoomVelocity = 0;
  /** Continuous thrust from a held key, in the same units. */
  heldThrust = 0;
  /** Steering from held keys, in half-screens per second. */
  steer = { x: 0, y: 0 };
  /** Speed multiplier from held modifiers. */
  speedScale = 1;
  /** Live pointer position in normalised view coordinates. */
  pointer = { nx: 0, ny: 0, inside: false };

  fps = 60;
  lastOrbitMs = 0;
  lastOrbitLength = 0;
  referenceEscaped = false;
  /** Fraction of full resolution currently being rendered. */
  renderScale = 1;

  /** Called a few times a second so the UI can refresh its readouts. */
  onFrame: (() => void) | null = null;

  private flowPhase = 0;
  /** Turns of continuous hue rotation accumulated so far — see settings.hueSpin. */
  private hueSpinPhase = 0;
  /** Seconds of animation the visualizer engine has run, independent of the camera. */
  private visualTime = 0;
  private dirty = true;
  private frames = 0;
  private fpsMark = 0;
  private prevTs = 0;
  private running = false;
  
  // Audio analysis engine state variables
  public audioEnabled = false;
  public audioGain = 0.4; // Lower default multiplier to prevent over-movement
  private audioCtx: AudioContext | null = null;
  private audioAnalyser: AnalyserNode | null = null;
  private audioStream: MediaStream | null = null;
  private audioSourceNode: MediaStreamAudioSourceNode | null = null;
  private audioDataArray = new Uint8Array(0);

  private cssW = 1;
  private cssH = 1;
  /** Scale used while the view is moving; adapts to the measured frame rate. */
  private motionScale = 0.6;
  private interactUntil = 0;

  // Cache keys for the reference orbit.
  private refCx: Fx = -1n;
  private refCy: Fx = -1n;
  private refIter = -1;
  private refMode = '';
  private refCr = '';
  private refCi = '';
  private refPrecision = -1;
  private refNewtonPower = -1;
  private refRelaxation = Number.NaN;
  /** Offset of Z_0 from the view centre, in normalised view units. */
  private refShift: [number, number] = [0, 0];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.renderer.setPalette(this.settings.palette);
    this.restore();
  }

  /* ---------------------------------------------------------------- state */

  get usesPerturbation(): boolean {
    if (this.settings.category !== 'fractal') return false;
    const m = this.settings.mode;
    return m === 'julia' || m === 'newton' || (m === 'mandelbrot' && this.settings.params.power === 2);
  }

  get moving(): boolean {
    return (
      this.zoomVelocity !== 0 ||
      this.heldThrust !== 0 ||
      this.steer.x !== 0 ||
      this.steer.y !== 0 ||
      performance.now() < this.interactUntil
    );
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Tell the renderer that the user is actively driving, so it can go soft. */
  nudge(): void {
    this.interactUntil = performance.now() + SETTLE_MS;
    this.dirty = true;
  }

  /** Add thrust to the descent. */
  thrust(amount: number): void {
    this.zoomVelocity = clampFlight(this.zoomVelocity + amount);
    this.nudge();
  }

  stopFlight(): void {
    this.zoomVelocity = 0;
    this.heldThrust = 0;
    this.markDirty();
  }

  setZoomAnchor(anchor: Prefs['zoomAnchor']): void {
    this.prefs.zoomAnchor = anchor;
    savePrefs(this.prefs);
  }

  /**
   * Where zooming converges. Cursor-anchored is what people expect from maps;
   * centre-anchored keeps the pointer free and is steadier once the view is
   * deep enough that a small hand movement covers a lot of ground.
   */
  private anchor(): [number, number] {
    if (this.prefs.zoomAnchor === 'cursor' && this.pointer.inside) {
      return [this.pointer.nx, this.pointer.ny];
    }
    return [0, 0];
  }

  toViewState(): ViewState {
    const digits = this.vp.displayDigits;
    return {
      category: this.settings.category,
      mode: this.settings.mode,
      cx: this.vp.ctx.toString(this.vp.tcx, digits),
      cy: this.vp.ctx.toString(this.vp.tcy, digits),
      z: this.vp.tLog2Zoom,
      iterations: this.settings.iterations,
      palette: this.settings.palette,
      colorDensity: this.settings.colorDensity,
      flowSpeed: this.settings.flowSpeed,
      hueSpin: this.settings.hueSpin,
      antialias: this.settings.antialias,
      params: { ...this.settings.params },
      visualMode: this.settings.visualMode,
      visualParams: { ...this.settings.visualParams },
    };
  }

  applyViewState(s: ViewState, animate = false): void {
    this.settings = settingsFromState(s);
    this.renderer.setPalette(this.settings.palette);

    // Parse the centre at a precision that can actually hold it.
    const ctx = new FixedCtx(FixedCtx.precisionForLog2Zoom(s.z));
    const cx = ctx.fromString(s.cx);
    const cy = ctx.fromString(s.cy);
    if (animate) this.vp.setTarget(cx, cy, s.z, ctx);
    else this.vp.snapTo(cx, cy, s.z, ctx);

    this.markDirty();
  }

  applyPreset(mode: FractalMode, preset: Preset): void {
    this.settings.mode = mode;
    if (preset.params) {
      this.settings.params = { ...this.settings.params, ...preset.params };
    }
    this.settings.iterations = preset.iterations;
    this.stopFlight();

    const z = radiusToLog2Zoom(preset.radius);
    const ctx = new FixedCtx(FixedCtx.precisionForLog2Zoom(z));
    this.vp.snapTo(ctx.fromString(preset.cx), ctx.fromString(preset.cy), z, ctx);
    this.markDirty();
  }

  resetView(): void {
    if (this.settings.category === 'visual') {
      this.settings.visualParams = defaultVisualParams();
      this.markDirty();
      return;
    }
    this.applyPreset(this.settings.mode, PRESETS[this.settings.mode][0]);
  }

  shareUrl(): string {
    return buildShareUrl(location.href, this.toViewState());
  }

  /* -------------------------------------------------------------- persist */

  save(): void {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(this.toViewState()));
    } catch {
      /* private browsing, quota — not worth interrupting the user over */
    }
  }

  private restore(): void {
    const fromUrl = readHashState(location.hash);
    if (fromUrl) {
      this.applyViewState(fromUrl);
      return;
    }
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ViewState;
        if (parsed && typeof parsed.cx === 'string') {
          this.applyViewState(parsed);
          return;
        }
      }
    } catch {
      /* fall through to the default view */
    }
    this.applyPreset('mandelbrot', PRESETS.mandelbrot[0]);
  }

  /* ------------------------------------------------------------ reference */

  /**
   * A Newton reference, seeded somewhere the map is defined.
   *
   * Any point in the frame serves — the delta is exact relative to whatever
   * reference it is measured from — so this tries seeds until one gives an
   * orbit that stays inside float32, and records where it ended up so the
   * shader knows where d starts. The view centre fails outright on every
   * Newton preset, since they all open on the origin.
   */
  private newtonOrbit(
    ctx: FixedCtx,
    power: number,
    relaxation: number,
    iterations: number,
  ): ReferenceOrbit {
    let last: ReferenceOrbit | null = null;
    for (const seed of REFERENCE_SEEDS) {
      this.refShift = seed;
      last = newtonReference(
        ctx,
        this.vp.cx + this.vp.normToOffset(seed[0]),
        this.vp.cy + this.vp.normToOffset(seed[1]),
        power,
        relaxation,
        iterations,
      );
      if (!last.polefault) return last;
    }
    // Every seed faulted: the whole frame is inside the pole's blast radius.
    // Render with the last one rather than nothing.
    return last as ReferenceOrbit;
  }

  private ensureReference(): void {
    if (!this.usesPerturbation) return;

    const { mode, iterations, params } = this.settings;
    const ctx = this.vp.ctx;
    const unchanged =
      this.refCx === this.vp.cx &&
      this.refCy === this.vp.cy &&
      this.refIter === iterations &&
      this.refMode === mode &&
      this.refPrecision === ctx.p &&
      (mode !== 'julia' || (this.refCr === params.cr && this.refCi === params.ci)) &&
      (mode !== 'newton' ||
        (this.refNewtonPower === params.newtonPower &&
          this.refRelaxation === params.relaxation));
    if (unchanged) return;

    const t0 = performance.now();
    let orbit: ReferenceOrbit;
    this.refShift = [0, 0];
    if (mode === 'julia') {
      orbit = juliaReference(
        ctx,
        this.vp.cx,
        this.vp.cy,
        ctx.fromString(params.cr),
        ctx.fromString(params.ci),
        iterations,
      );
    } else if (mode === 'newton') {
      orbit = this.newtonOrbit(ctx, params.newtonPower, params.relaxation, iterations);
    } else {
      orbit = mandelbrotReference(ctx, this.vp.cx, this.vp.cy, iterations);
    }
    this.lastOrbitMs = performance.now() - t0;
    this.lastOrbitLength = orbit.length;
    this.referenceEscaped = orbit.escaped;

    this.renderer.setReference(orbit);

    this.refCx = this.vp.cx;
    this.refCy = this.vp.cy;
    this.refIter = iterations;
    this.refMode = mode;
    this.refPrecision = ctx.p;
    this.refCr = params.cr;
    this.refCi = params.ci;
    this.refNewtonPower = params.newtonPower;
    this.refRelaxation = params.relaxation;
    this.dirty = true;
  }

  /* ----------------------------------------------------------------- loop */

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  resize(): void {
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.applyBackingSize();
  }

  /**
   * Size the drawing buffer. Below 1.0 the browser scales the result up to fill
   * the canvas, so a moving view costs a fraction of the fragment work and the
   * softness disappears the instant it settles.
   */
  private applyBackingSize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.cssW * dpr * this.renderScale));
    const h = Math.max(1, Math.round(this.cssH * dpr * this.renderScale));
    this.renderer.resize(w, h);
    this.dirty = true;
  }

  private frame(ts: number): void {
    const dt = Math.min(0.1, (ts - (this.prevTs || ts)) / 1000);
    this.prevTs = ts;

    // Steering is applied every frame rather than per keypress, so holding a
    // key glides instead of stepping — and it runs alongside the descent rather
    // than cancelling it.
    if (this.steer.x !== 0 || this.steer.y !== 0) {
      // `steer` is camera velocity; panning moves the view the other way.
      const k = STEER_SPEED * this.speedScale * dt;
      this.vp.pan(-this.steer.x * k, -this.steer.y * k);
      this.dirty = true;
    }

    const totalThrust = this.zoomVelocity + this.heldThrust * this.speedScale;
    if (totalThrust !== 0) {
      const [ax, ay] = this.anchor();
      this.vp.zoomAt(ax, ay, totalThrust * dt);
      this.zoomVelocity = decayFlight(this.zoomVelocity, dt, false);
      this.dirty = true;
    }

    if (this.vp.step(0.2)) this.dirty = true;

    if (this.settings.flowSpeed !== 0) {
      this.flowPhase = (this.flowPhase + dt * this.settings.flowSpeed * 0.08) % 1;
      this.dirty = true;
    }

    if (this.settings.hueSpin !== 0) {
      this.hueSpinPhase = (this.hueSpinPhase + dt * this.settings.hueSpin / 360) % 1;
      this.dirty = true;
    }

    // Visualizers have no camera to settle — they are meant to keep moving,
    // so every frame is dirty for as long as that category is active.
    if (this.settings.category === 'visual') {
      this.visualTime += dt;
      this.dirty = true;
    }

    const wantScale = this.moving ? this.motionScale : 1;
    if (Math.abs(wantScale - this.renderScale) > 0.02) {
      this.renderScale = wantScale;
      this.applyBackingSize();
    }

    if (this.dirty) {
      this.ensureReference();
      this.drawFrame();
      this.dirty = false;
    }

    this.frames++;
    if (ts - this.fpsMark >= 400) {
      this.fps = Math.round((this.frames * 1000) / (ts - this.fpsMark));
      this.frames = 0;
      this.fpsMark = ts;
      // Only steer the motion scale from frames that were actually under load.
      if (this.moving) this.motionScale = adaptScale(this.motionScale, this.fps);
      this.onFrame?.();
      this.save();
    }

    requestAnimationFrame((t) => this.frame(t));
  }

  private drawFrame(): void {
    if (this.settings.category === 'visual') {
      this.drawVisualFrame();
      return;
    }

    const { mant, exp } = this.vp.scaleParts();
    const ctx = this.vp.ctx;
    const cxNum = ctx.toNumber(this.vp.cx);
    const cyNum = ctx.toNumber(this.vp.cy);
    const hiX = Math.fround(cxNum);
    const hiY = Math.fround(cyNum);
    const { params, mode } = this.settings;

    let shaderMode: number;
    if (mode === 'newton') shaderMode = SHADER_MODE.newton;
    else if (mode === 'julia') shaderMode = SHADER_MODE.julia;
    else shaderMode = params.power === 2 ? SHADER_MODE.mandelbrot : SHADER_MODE.mandelbrotPower;

    this.renderer.draw({
      shaderMode,
      maxIter: this.settings.iterations,
      // Supersampling while the view is already soft is wasted work.
      antialias: this.settings.antialias && !this.moving,
      scaleMant: mant,
      scaleExp: exp,
      refShift: this.refShift,
      centerHi: [hiX, hiY],
      centerLo: [cxNum - hiX, cyNum - hiY],
      directScale: this.vp.halfHeightFloat(),
      power: params.power,
      newtonPower: params.newtonPower,
      relaxation: params.relaxation,
      colorDensity: this.settings.colorDensity,
      flowPhase: this.flowPhase,
      hueSpin: this.hueSpinPhase,
    });
  }


  async toggleAudio(): Promise<boolean> {
    if (this.audioEnabled) {
      this.disableAudio();
      return false;
    } else {
      return await this.enableAudio();
    }
  }

  private disableAudio(): void {
    this.audioEnabled = false;
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    if (this.audioSourceNode) {
      this.audioSourceNode.disconnect();
      this.audioSourceNode = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
    }
    this.audioCtx = null;
    this.audioAnalyser = null;
    this.markDirty();
  }

  private async enableAudio(): Promise<boolean> {
    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioStream = stream;
      
      this.audioAnalyser = this.audioCtx.createAnalyser();
      this.audioAnalyser.fftSize = 256;
      this.audioAnalyser.smoothingTimeConstant = 0.75;
      
      this.audioSourceNode = this.audioCtx.createMediaStreamSource(stream);
      this.audioSourceNode.connect(this.audioAnalyser);
      
      this.audioDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
      this.audioEnabled = true;
      this.markDirty();
      return true;
    } catch (err) {
      console.error('Failed to capture audio stream:', err);
      this.disableAudio();
      return false;
    }
  }

  private drawVisualFrame(): void {
    const { visualMode, visualParams } = this.settings;
    
    let audioLevel = 0;
    const audioBands: [number, number, number] = [0, 0, 0];
    
    if (this.audioEnabled && this.audioAnalyser) {
      this.audioAnalyser.getByteFrequencyData(this.audioDataArray);
      
      let sum = 0;
      const len = this.audioDataArray.length;
      for (let i = 0; i < len; i++) {
        sum += this.audioDataArray[i];
      }
      audioLevel = sum / (len * 255.0); // 0..1 range
      
      // Bands mapping: low (0..20%), mid (20..65%), high (65..100%)
      const lowCut = Math.floor(len * 0.2);
      const midCut = Math.floor(len * 0.65);
      
      let lowSum = 0;
      for (let i = 0; i < lowCut; i++) lowSum += this.audioDataArray[i];
      
      let midSum = 0;
      for (let i = lowCut; i < midCut; i++) midSum += this.audioDataArray[i];
      
      let highSum = 0;
      for (let i = midCut; i < len; i++) highSum += this.audioDataArray[i];
      
      const lowNorm = lowCut > 0 ? (lowSum / lowCut) / 255.0 : 0;
      const midNorm = (midCut - lowCut) > 0 ? (midSum / (midCut - lowCut)) / 255.0 : 0;
      const highNorm = (len - midCut) > 0 ? (highSum / (len - midCut)) / 255.0 : 0;
      
      // Amplify and clamp bands using dynamic audioGain multiplier
      audioBands[0] = Math.min(2.0, lowNorm * 3.0 * this.audioGain);  // Bass boost
      audioBands[1] = Math.min(2.0, midNorm * 2.5 * this.audioGain);  // Mid
      audioBands[2] = Math.min(2.0, highNorm * 2.0 * this.audioGain); // Treble
      
      audioLevel = Math.min(1.8, audioLevel * 2.2 * this.audioGain);
      
      // Force app frame rendering since audio changes continuously
      this.dirty = true;
    }
    
    this.renderer.drawVisual({
      vmode: VISUAL_SHADER_MODE[visualMode] ?? VISUAL_SHADER_MODE.flow,
      time: this.visualTime,
      speed: visualParams.speed,
      warp: visualParams.warp,
      complexity: visualParams.complexity,
      symmetry: visualParams.symmetry,
      zoom: visualParams.zoom,
      colorDensity: this.settings.colorDensity,
      flowPhase: this.flowPhase,
      hueSpin: this.hueSpinPhase,
      audioLevel,
      audioBands,
    });
  }

  /* --------------------------------------------------------------- export */

  /** Render once at `scale`× with antialiasing on, and hand back a PNG blob URL. */
  exportPng(scale = 2): string {
    const canvas = this.renderer.gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aa = this.settings.antialias;

    const target = Math.round(Math.max(this.cssW, this.cssH) * dpr * scale);
    const safe = Math.min(1, this.renderer.maxDimension / Math.max(1, target));

    this.settings.antialias = true;
    this.interactUntil = 0;
    this.stopFlight();
    this.renderer.resize(
      Math.round(this.cssW * dpr * scale * safe),
      Math.round(this.cssH * dpr * scale * safe),
    );
    this.drawFrame();
    const url = canvas.toDataURL('image/png');

    this.settings.antialias = aa;
    this.applyBackingSize();
    return url;
  }
}
