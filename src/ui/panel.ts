/**
 * The control panel: a fixed column down the right-hand edge.
 *
 * Every control here is a plain labelled slider, segmented button or checkbox —
 * the point is that you should be able to look at it once and know what it
 * does, without learning a key first. Keys exist, but only for flying, and the
 * whole set is printed at the bottom of the panel so there is nothing to
 * memorise.
 */

import type { App } from '../app.ts';
import { iterationsFromSlider, sensitivityScale, sliderFromIterations } from '../core/tuning.ts';
import { DYNAMIC_PALETTES, PALETTES, paletteCssGradient } from '../render/palettes.ts';
import { PRESETS } from '../state/presets.ts';
import {
  MODE_LABELS,
  MODES,
  VISUAL_MODE_LABELS,
  VISUAL_MODES,
  type Category,
  type FractalMode,
  type VisualMode,
} from '../state/types.ts';
import type { ZoomAnchor } from '../state/prefs.ts';
import { deletePersonal, loadPersonal, savePersonal } from '../state/personal.ts';
import { el, relativeSlider, slider, toast, type SliderHandle } from './widgets.ts';

const CATEGORY_LABELS: Record<Category, string> = { fractal: 'Fractal', visual: 'Visualizer' };

export class Panel {
  private readonly app: App;
  private readonly readout = document.getElementById('readout') as HTMLElement;
  private readonly root = document.getElementById('panel') as HTMLElement;

  private sliders: SliderHandle[] = [];
  private presetSelect: HTMLSelectElement | null = null;
  private categoryButtons = new Map<Category, HTMLButtonElement>();
  private modeButtons = new Map<FractalMode, HTMLButtonElement>();
  private visualModeButtons = new Map<VisualMode, HTMLButtonElement>();
  private anchorButtons = new Map<ZoomAnchor, HTMLButtonElement>();
  private swatchButtons = new Map<string, HTMLButtonElement>();

  constructor(app: App) {
    this.app = app;
    this.build();
    app.onFrame = () => this.refresh();
    this.refresh();
  }

  /* ---------------------------------------------------------------- build */

  private build(): void {
    const app = this.app;
    const s = () => app.settings;
    const changed = () => {
      app.markDirty();
      app.nudge();
    };

    this.sliders = [];
    this.presetSelect = null;
    this.modeButtons.clear();
    this.visualModeButtons.clear();
    this.categoryButtons.clear();
    this.root.replaceChildren();

    /* -- engine ------------------------------------------------------------ */

    const categorySeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Engine' });
    for (const cat of ['fractal', 'visual'] as Category[]) {
      const b = el('button', {
        type: 'button',
        'aria-pressed': String(s().category === cat),
        text: CATEGORY_LABELS[cat],
      });
      b.addEventListener('click', () => this.setCategory(cat));
      this.categoryButtons.set(cat, b);
      categorySeg.append(b);
    }
    this.root.append(el('section', { class: 'group' }, [categorySeg]));

    if (s().category === 'fractal') this.buildFractalSections();
    else this.buildVisualSections();

    /* -- colour ----------------------------------------------------------- */

    const swatches = el('div', { class: 'swatches', role: 'group', 'aria-label': 'Palette' });
    for (const p of PALETTES) {
      const b = el('button', {
        type: 'button',
        class: 'swatch',
        title: p.name,
        'aria-label': p.name,
        'aria-pressed': String(s().palette === p.id),
        style: `background: ${paletteCssGradient(p)}`,
      });
      b.addEventListener('click', () => this.setPalette(p.id));
      this.swatchButtons.set(p.id, b);
      swatches.append(b);
    }

    // A second row: picking one of these sets the ramp *and* starts it
    // spinning at a good starting rate — a shortcut, not a fixed pairing.
    // The Spin speed slider below controls the actual rate for any palette,
    // static or dynamic, and can push well past what these presets start at.
    // The CSS animation on `.swatch.dynamic` is just a preview; the real spin
    // happens on the GPU once selected, via u_hueSpin.
    const dynamicSwatches = el('div', {
      class: 'swatches',
      role: 'group',
      'aria-label': 'Dynamic palette',
    });
    for (const p of DYNAMIC_PALETTES) {
      const b = el('button', {
        type: 'button',
        class: 'swatch dynamic',
        title: `${p.name} — starts spinning at ${p.spin}°/s`,
        'aria-label': p.name,
        'aria-pressed': String(s().palette === p.id),
        style: `background: ${paletteCssGradient(p)}`,
      });
      b.addEventListener('click', () => this.setDynamicPalette(p.id, p.spin));
      this.swatchButtons.set(p.id, b);
      dynamicSwatches.append(b);
    }

    const density = slider({
      label: 'Colour bands',
      min: 0.05,
      max: 5,
      step: 0.05,
      get: () => s().colorDensity,
      set: (v) => (s().colorDensity = v),
      format: (v) => v.toFixed(2),
      onChange: changed,
    });
    const flow = slider({
      label: 'Colour flow',
      min: -5,
      max: 5,
      step: 0.1,
      get: () => s().flowSpeed,
      set: (v) => (s().flowSpeed = v),
      format: (v) => (Math.abs(v) < 0.05 ? 'off' : v.toFixed(1)),
      onChange: changed,
    });
    // Independent of which palette is selected — spins any ramp, static or
    // dynamic. Deliberately a wider range than the dynamic presets start at,
    // since a preset is a starting point, not a ceiling.
    const spin = slider({
      label: 'Spin speed',
      min: -300,
      max: 300,
      step: 5,
      get: () => s().hueSpin,
      set: (v) => (s().hueSpin = v),
      format: (v) => (Math.abs(v) < 2.5 ? 'off' : `${v.toFixed(0)}°/s`),
      onChange: changed,
    });
    this.sliders.push(density, flow, spin);

    this.root.append(
      el('section', { class: 'group' }, [
        el('h2', { text: 'Colour' }),
        swatches,
        el('div', { class: 'subhead', text: 'Dynamic' }),
        dynamicSwatches,
        density.root,
        flow.root,
        spin.root,
      ]),
    );

    /* -- actions ---------------------------------------------------------- */

    const mk = (label: string, fn: (e: MouseEvent) => void, title?: string) => {
      const b = el('button', { type: 'button', class: 'btn', text: label, title });
      b.addEventListener('click', fn);
      return b;
    };

    this.root.append(
      el('section', { class: 'group' }, [
        el('h2', { text: 'This view' }),
        el('div', { class: 'buttons' }, [
          mk('Copy link', () => void this.copyLink()),
          mk(
            'Save view',
            (e) => (e.shiftKey ? this.deleteSaved() : this.saveCurrent()),
            'Shift-click to delete a saved view',
          ),
          mk('Export PNG', () => this.exportPng()),
          mk('Reset', () => {
            this.app.resetView();
            this.refreshControls();
          }),
        ]),
      ]),
    );

    /* -- keys ------------------------------------------------------------- */

    const keys: Array<[string[], string]> =
      s().category === 'fractal'
        ? [
            [['W', 'A', 'S', 'D'], 'move — or drag'],
            [['Q', 'E'], 'zoom out / in — or scroll'],
            [['shift'], 'faster'],
            [['alt'], 'finer'],
            [['space'], 'stop'],
            [['1', '2', '3'], 'switch fractal'],
            [['V'], 'visualizer engine'],
            [['H'], 'hide panel'],
          ]
        : [
            [['1', '2', '3', '4'], 'switch visualizer'],
            [['V'], 'fractal engine'],
            [['H'], 'hide panel'],
          ];
    const legend = el('div', { class: 'keys' });
    for (const [ks, what] of keys) {
      const line = el('div');
      for (const k of ks) line.append(el('kbd', { text: k }));
      line.append(el('span', { text: what }));
      legend.append(line);
    }
    this.root.append(legend);

    this.syncChrome();
  }

  /** Mode buttons, presets, zoom-anchor, iterations and shape sliders — the fractal engine's own controls. */
  private buildFractalSections(): void {
    const app = this.app;
    const s = () => app.settings;
    const changed = () => {
      app.markDirty();
      app.nudge();
    };
    // Shape controls narrow their window as the view deepens.
    const span = (base: number) => () => base * sensitivityScale(app.vp.log2Zoom);
    const digits = () => Math.min(15, Math.max(3, Math.ceil(app.vp.log2Zoom * 0.30103) + 2));

    const modeSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Fractal' });
    for (const mode of MODES) {
      const b = el('button', {
        type: 'button',
        'aria-pressed': String(s().mode === mode),
        text: MODE_LABELS[mode],
      });
      b.addEventListener('click', () => this.setMode(mode));
      this.modeButtons.set(mode, b);
      modeSeg.append(b);
    }

    this.presetSelect = el('select', { 'aria-label': 'Jump to a location' }) as HTMLSelectElement;
    this.presetSelect.addEventListener('change', () => this.onPresetChange());

    this.root.append(
      el('section', { class: 'group' }, [
        el('h2', { text: 'Fractal' }),
        modeSeg,
        this.presetSelect,
      ]),
    );

    /* -- zoom ------------------------------------------------------------- */

    const anchorSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Zoom towards' });
    for (const [anchor, label] of [
      ['cursor', 'Cursor'],
      ['centre', 'Centre'],
    ] as Array<[ZoomAnchor, string]>) {
      const b = el('button', {
        type: 'button',
        'aria-pressed': String(app.prefs.zoomAnchor === anchor),
        text: label,
      });
      b.addEventListener('click', () => this.setAnchor(anchor));
      this.anchorButtons.set(anchor, b);
      anchorSeg.append(b);
    }

    this.root.append(
      el('section', { class: 'group' }, [el('h2', { text: 'Zoom towards' }), anchorSeg]),
    );

    /* -- detail ----------------------------------------------------------- */

    const iterations = slider({
      label: 'Iterations',
      min: 0,
      max: 1,
      step: 0.001,
      get: () => sliderFromIterations(s().iterations),
      set: (v) => (s().iterations = iterationsFromSlider(v)),
      format: () => String(s().iterations),
      onChange: changed,
    });
    this.sliders.push(iterations);

    const aa = el('input', { type: 'checkbox', checked: s().antialias }) as HTMLInputElement;
    aa.addEventListener('change', () => {
      s().antialias = aa.checked;
      changed();
    });

    this.root.append(
      el('section', { class: 'group' }, [
        el('h2', { text: 'Detail' }),
        iterations.root,
        el('label', { class: 'check' }, [aa, document.createTextNode('Antialias when still')]),
      ]),
    );

    /* -- shape ------------------------------------------------------------ */

    const shape: HTMLElement[] = [];
    if (s().mode === 'julia') {
      for (const [key, label] of [
        ['cr', 'Constant c — real'],
        ['ci', 'Constant c — imaginary'],
      ] as Array<['cr' | 'ci', string]>) {
        const h = relativeSlider({
          label,
          min: -2,
          max: 2,
          span: span(0.35),
          get: () => parseFloat(s().params[key]),
          set: (v) => (s().params[key] = v.toFixed(15)),
          format: (v) => v.toFixed(digits()),
          onChange: changed,
        });
        this.sliders.push(h);
        shape.push(h.root);
      }
    } else if (s().mode === 'mandelbrot') {
      const h = slider({
        label: 'Exponent p in z^p + c',
        min: 1,
        max: 8,
        step: 0.1,
        get: () => s().params.power,
        set: (v) => (s().params.power = Math.round(v * 10) / 10),
        format: (v) => v.toFixed(1),
        onChange: changed,
      });
      this.sliders.push(h);
      shape.push(h.root);
    } else {
      const degree = slider({
        label: 'Degree p in z^p − 1',
        min: 2,
        max: 12,
        step: 1,
        get: () => s().params.newtonPower,
        set: (v) => (s().params.newtonPower = Math.round(v)),
        format: (v) => String(Math.round(v)),
        onChange: changed,
      });
      const relax = relativeSlider({
        label: 'Relaxation a',
        min: 0.1,
        max: 2.5,
        span: span(0.5),
        get: () => s().params.relaxation,
        set: (v) => (s().params.relaxation = v),
        format: (v) => v.toFixed(4),
        onChange: changed,
      });
      this.sliders.push(degree, relax);
      shape.push(degree.root, relax.root);
    }

    this.root.append(el('section', { class: 'group' }, [el('h2', { text: 'Shape' }), ...shape]));

    this.populatePresets();
  }

  /** Visualizer mode buttons and the four generic motion sliders. */
  private buildVisualSections(): void {
    const app = this.app;
    const s = () => app.settings;
    const changed = () => {
      app.markDirty();
      app.nudge();
    };

    const modeSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Visualizer' });
    for (const mode of VISUAL_MODES) {
      const b = el('button', {
        type: 'button',
        'aria-pressed': String(s().visualMode === mode),
        text: VISUAL_MODE_LABELS[mode],
      });
      b.addEventListener('click', () => this.setVisualMode(mode));
      this.visualModeButtons.set(mode, b);
      modeSeg.append(b);
    }

    const audioSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Audio Reactive' });
    const audioBtn = el('button', {
      type: 'button',
      'aria-pressed': String(app.audioEnabled),
      text: app.audioEnabled ? '🎤 Microphone: ON' : '🎤 Microphone: OFF',
    });
    audioBtn.addEventListener('click', async () => {
      await app.toggleAudio();
      this.refreshControls(); // Rebuild panel to show/hide sensitivity slider
    });
    audioSeg.append(audioBtn);

    const audioControls: HTMLElement[] = [audioSeg];
    if (app.audioEnabled) {
      const audioSens = slider({
        label: 'Mic Sensitivity',
        min: 0.05,
        max: 2.0,
        step: 0.05,
        get: () => app.audioGain,
        set: (v) => (app.audioGain = v),
        format: (v) => `${(v * 100).toFixed(0)}%`,
        onChange: changed,
      });
      this.sliders.push(audioSens);
      audioControls.push(el('div', { style: 'margin-top: 10px;' }, [audioSens.root]));
    }

    this.root.append(
      el('section', { class: 'group' }, [
        el('h2', { text: 'Visualizer' }),
        modeSeg,
        el('div', { style: 'margin-top: 8px;' }, audioControls),
      ]),
    );

    /* -- motion ------------------------------------------------------------ */

    const vp = () => s().visualParams;
    const motion: HTMLElement[] = [];

    const speed = slider({
      label: 'Speed',
      min: 0.05,
      max: 4,
      step: 0.05,
      get: () => vp().speed,
      set: (v) => (vp().speed = v),
      format: (v) => `${v.toFixed(2)}×`,
      onChange: changed,
    });
    const warp = slider({
      label: 'Warp',
      min: 0,
      max: 3,
      step: 0.05,
      get: () => vp().warp,
      set: (v) => (vp().warp = v),
      format: (v) => v.toFixed(2),
      onChange: changed,
    });
    const complexity = slider({
      label: 'Complexity',
      min: 1,
      max: 8,
      step: 1,
      get: () => vp().complexity,
      set: (v) => (vp().complexity = Math.round(v)),
      format: (v) => String(Math.round(v)),
      onChange: changed,
    });
    const zoom = slider({
      label: 'Zoom',
      min: 0.15,
      max: 8,
      step: 0.05,
      get: () => vp().zoom,
      set: (v) => (vp().zoom = v),
      format: (v) => `${v.toFixed(2)}×`,
      onChange: changed,
    });
    this.sliders.push(speed, warp, complexity, zoom);
    motion.push(speed.root, warp.root, complexity.root, zoom.root);

    // Only the fold-based modes read the fold count — hiding it elsewhere
    // keeps the panel from asking about a knob that would otherwise do nothing.
    if (s().visualMode === 'kaleido' || s().visualMode === 'mandala' || s().visualMode === 'cosmic' || s().visualMode === 'tunnel') {
      const symmetry = slider({
        label: 'Symmetry',
        min: 2,
        max: 16,
        step: 1,
        get: () => vp().symmetry,
        set: (v) => (vp().symmetry = Math.round(v)),
        format: (v) => `${Math.round(v)}-fold`,
        onChange: changed,
      });
      this.sliders.push(symmetry);
      motion.push(symmetry.root);
    }

    this.root.append(el('section', { class: 'group' }, [el('h2', { text: 'Motion' }), ...motion]));
  }

  /* ------------------------------------------------------------- presets */

  private populatePresets(): void {
    const sel = this.presetSelect;
    if (!sel) return;
    sel.replaceChildren(el('option', { value: '', text: 'Jump to a location…' }));

    const builtin = el('optgroup', { label: 'Documented locations' });
    PRESETS[this.app.settings.mode].forEach((p, i) => {
      builtin.append(el('option', { value: `b:${i}`, title: p.note, text: p.name }));
    });
    sel.append(builtin);

    const mine = loadPersonal();
    if (mine.length) {
      const group = el('optgroup', { label: 'My views' });
      mine.forEach((p) => group.append(el('option', { value: `p:${p.name}`, text: p.name })));
      sel.append(group);
    }
    sel.value = '';
  }

  private onPresetChange(): void {
    const sel = this.presetSelect;
    if (!sel) return;
    const v = sel.value;
    if (!v) return;
    if (v.startsWith('b:')) {
      const preset = PRESETS[this.app.settings.mode][Number(v.slice(2))];
      if (preset) {
        this.app.applyPreset(this.app.settings.mode, preset);
        toast(preset.note);
      }
    } else {
      const found = loadPersonal().find((p) => p.name === v.slice(2));
      if (found) {
        this.app.applyViewState(found.state);
        toast(`Loaded “${found.name}”`);
      }
    }
    sel.value = '';
    sel.blur();
    this.refreshControls();
  }

  /* -------------------------------------------------------------- actions */

  setCategory(category: Category): void {
    if (this.app.settings.category === category) return;
    this.app.settings.category = category;
    this.app.stopFlight();
    this.app.markDirty();
    this.refreshControls();
  }

  setMode(mode: FractalMode): void {
    if (this.app.settings.mode === mode) return;
    this.app.settings.mode = mode;
    this.app.applyPreset(mode, PRESETS[mode][0]);
    this.refreshControls();
  }

  setVisualMode(mode: VisualMode): void {
    if (this.app.settings.visualMode === mode) return;
    this.app.settings.visualMode = mode;
    this.app.markDirty();
    this.refreshControls();
  }

  private setAnchor(anchor: ZoomAnchor): void {
    this.app.setZoomAnchor(anchor);
    this.syncChrome();
    toast(anchor === 'cursor' ? 'Zooming towards the pointer' : 'Zooming towards the crosshair');
  }

  /**
   * Palette and spin are independent axes: this only changes the ramp, so
   * spinning a static swatch (via the Spin speed slider) works too.
   */
  setPalette(id: string): void {
    this.app.settings.palette = id;
    this.app.renderer.setPalette(id);
    this.app.markDirty();
    this.syncChrome();
  }

  /** A shortcut that sets the ramp and seeds a starting spin rate together. */
  setDynamicPalette(id: string, spin: number): void {
    this.app.settings.palette = id;
    this.app.settings.hueSpin = spin;
    this.app.renderer.setPalette(id);
    this.app.markDirty();
    this.syncChrome();
  }

  async copyLink(): Promise<void> {
    const url = this.app.shareUrl();
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied — carries the exact coordinates, at full precision.');
    } catch {
      toast('Copy blocked by the browser; the address bar now holds the link.');
    }
  }

  private saveCurrent(): void {
    const name = window.prompt('Name this view');
    if (!name?.trim()) return;
    savePersonal(name, this.app.toViewState());
    this.populatePresets();
    toast(`Saved “${name.trim()}”`);
  }

  exportPng(): void {
    toast('Rendering export…');
    // Let the toast paint before the synchronous 2× render blocks the thread.
    window.setTimeout(() => {
      const a = el('a', {
        href: this.app.exportPng(2),
        download: `aether-${this.app.settings.category === 'visual' ? this.app.settings.visualMode : this.app.settings.mode}-${Date.now()}.png`,
      });
      a.click();
    }, 40);
  }

  /** Offered from the preset list rather than a button, since it is rare. */
  deleteSaved(): void {
    const mine = loadPersonal();
    if (!mine.length) {
      toast('Nothing saved yet.');
      return;
    }
    const name = window.prompt(`Delete which?\n\n${mine.map((p) => p.name).join('\n')}`);
    if (!name?.trim()) return;
    deletePersonal(name.trim());
    this.populatePresets();
    toast(`Deleted “${name.trim()}”`);
  }

  /* ------------------------------------------------------------- refresh */

  refreshControls(): void {
    this.build();
    this.refresh();
  }

  private syncChrome(): void {
    for (const [cat, b] of this.categoryButtons) {
      b.setAttribute('aria-pressed', String(this.app.settings.category === cat));
    }
    for (const [mode, b] of this.modeButtons) {
      b.setAttribute('aria-pressed', String(this.app.settings.mode === mode));
    }
    for (const [mode, b] of this.visualModeButtons) {
      b.setAttribute('aria-pressed', String(this.app.settings.visualMode === mode));
    }
    for (const [anchor, b] of this.anchorButtons) {
      b.setAttribute('aria-pressed', String(this.app.prefs.zoomAnchor === anchor));
    }
    for (const [id, b] of this.swatchButtons) {
      b.setAttribute('aria-pressed', String(this.app.settings.palette === id));
    }
    document.body.classList.toggle('anchor-cursor', this.app.prefs.zoomAnchor === 'cursor');
    document.body.classList.toggle('category-visual', this.app.settings.category === 'visual');
  }

  refresh(): void {
    const app = this.app;

    if (app.settings.category === 'visual') {
      this.readout.replaceChildren(
        el('div', { class: 'zoom', text: VISUAL_MODE_LABELS[app.settings.visualMode] }),
        el('div', { class: 'meta', text: `${app.fps} fps` }),
      );
      for (const h of this.sliders) h.sync();
      return;
    }

    const vp = app.vp;
    const dg = vp.displayDigits;

    const speed = app.zoomVelocity + app.heldThrust * app.speedScale;
    const flight = speed === 0 ? '' : `  ${speed > 0 ? '▼' : '▲'} ${Math.abs(speed).toFixed(1)}`;

    const meta = [
      app.usesPerturbation ? `${vp.ctx.p} bits` : 'float64 path',
      `${app.fps} fps`,
    ];
    if (app.renderScale < 0.99) meta.push(`${Math.round(app.renderScale * 100)}%`);

    this.readout.replaceChildren(
      el('div', { class: 'zoom', text: vp.zoomLabel + flight }),
      el('div', {
        class: 'coord',
        text: `${vp.ctx.toString(vp.cx, dg)}\n${vp.ctx.toString(vp.cy, dg)}i`,
        style: 'white-space: pre-line',
      }),
      el('div', { class: 'meta', text: meta.join(' · ') }),
    );

    for (const h of this.sliders) h.sync();
  }
}
