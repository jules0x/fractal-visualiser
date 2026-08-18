/**
 * Canvas interaction.
 *
 * The scheme is deliberately the one people already know from games: WASD to
 * move, Q and E to zoom, shift to hurry, and the mouse to do the same things
 * more directly. That is six things to remember instead of twenty, and they are
 * printed at the bottom of the panel anyway.
 *
 * Movement keys are held rather than tapped, and they run *alongside* a zoom
 * rather than cancelling it — so you can steer while descending, which is the
 * whole point of a flight model. Dragging the canvas does not interrupt the
 * descent either.
 */

import type { App } from '../app.ts';
import { HELD_THRUST, sensitivityScale, thrustFromWheel } from '../core/tuning.ts';
import type { Panel } from './panel.ts';
import { toast } from './widgets.ts';

const MOVE_KEYS: Record<string, [number, number]> = {
  w: [0, 1],
  a: [-1, 0],
  s: [0, -1],
  d: [1, 0],
  arrowup: [0, 1],
  arrowleft: [-1, 0],
  arrowdown: [0, -1],
  arrowright: [1, 0],
};

const ZOOM_KEYS: Record<string, number> = { e: 1, q: -1 };

export function attachInput(app: App, canvas: HTMLCanvasElement, panel: Panel): void {
  const held = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();
  let panning = false;
  let last = { x: 0, y: 0 };
  let pinchDist = 0;

  const metrics = () => {
    const r = canvas.getBoundingClientRect();
    return { r, half: Math.min(r.width, r.height) * 0.5 };
  };

  const applyHeld = () => {
    // The visualizer engine has no camera — WASD/QE have nothing to drive.
    if (app.settings.category !== 'fractal') {
      app.steer = { x: 0, y: 0 };
      app.heldThrust = 0;
      return;
    }

    let x = 0;
    let y = 0;
    for (const k of held) {
      const m = MOVE_KEYS[k];
      if (m) {
        x += m[0];
        y += m[1];
      }
    }
    const len = Math.hypot(x, y) || 1;
    app.steer = { x: x / len, y: y / len };

    let thrust = 0;
    for (const k of held) thrust += ZOOM_KEYS[k] ?? 0;
    app.heldThrust = Math.max(-1, Math.min(1, thrust)) * HELD_THRUST;

    if (app.steer.x || app.steer.y || app.heldThrust) app.nudge();
  };

  const setModifiers = (e: KeyboardEvent | PointerEvent | WheelEvent) => {
    app.speedScale = e.shiftKey ? 2.8 : e.altKey ? 0.28 : 1;
  };

  /* ------------------------------------------------------------- pointer */

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setModifiers(e);

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      panning = false;
      return;
    }
    panning = true;
    last = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    setModifiers(e);
    const { r, half } = metrics();
    app.pointer = {
      nx: (e.clientX - r.left - r.width * 0.5) / half,
      ny: (r.height * 0.5 - (e.clientY - r.top)) / half,
      inside: true,
    };

    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // The visualizer engine has no camera to pan, pinch or zoom.
    if (app.settings.category !== 'fractal') return;

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && dist > 0) {
        app.vp.zoomAt(app.pointer.nx, app.pointer.ny, Math.log2(dist / pinchDist));
        app.nudge();
      }
      pinchDist = dist;
      return;
    }

    if (!panning) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };

    if (e.shiftKey && app.settings.mode === 'julia') {
      const k = 0.0015 * sensitivityScale(app.vp.log2Zoom) * (e.altKey ? 0.1 : 1);
      app.settings.params.cr = clampStr(parseFloat(app.settings.params.cr) + dx * k);
      app.settings.params.ci = clampStr(parseFloat(app.settings.params.ci) - dy * k);
      panel.refresh();
    } else {
      // Note: no stopFlight here. Dragging steers the descent, it doesn't end it.
      app.vp.pan(dx / half, -dy / half);
    }
    app.nudge();
  });

  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      panning = false;
      canvas.classList.remove('dragging');
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    app.pointer.inside = false;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setModifiers(e);
      if (app.settings.category === 'visual') {
        // No camera to fly, but the pattern itself can still be scaled.
        const vp = app.settings.visualParams;
        const step = thrustFromWheel(e.deltaY, e.deltaMode) * app.speedScale;
        vp.zoom = Math.max(0.1, Math.min(10, vp.zoom * Math.pow(2, step * 0.18)));
        app.markDirty();
        return;
      }
      app.thrust(thrustFromWheel(e.deltaY, e.deltaMode) * app.speedScale);
    },
    { passive: false },
  );

  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (app.settings.category !== 'fractal') return;
    app.vp.zoomAt(app.pointer.nx, app.pointer.ny, e.shiftKey ? -1.5 : 1.5);
    app.nudge();
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ------------------------------------------------------------ keyboard */

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.metaKey || e.ctrlKey) return;

    setModifiers(e);
    const k = e.key.toLowerCase();

    if (MOVE_KEYS[k] || ZOOM_KEYS[k]) {
      e.preventDefault();
      if (!held.has(k)) {
        held.add(k);
        applyHeld();
      }
      return;
    }

    const visual = app.settings.category === 'visual';

    switch (k) {
      case ' ':
        e.preventDefault();
        app.stopFlight();
        toast('Stopped');
        break;
      case '1':
        if (visual) panel.setVisualMode('flow');
        else panel.setMode('mandelbrot');
        break;
      case '2':
        if (visual) panel.setVisualMode('plasma');
        else panel.setMode('julia');
        break;
      case '3':
        if (visual) panel.setVisualMode('kaleido');
        else panel.setMode('newton');
        break;
      case '4':
        if (visual) panel.setVisualMode('mandala');
        break;
      case '5':
        if (visual) panel.setVisualMode('cosmic');
        break;
      case '6':
        if (visual) panel.setVisualMode('tunnel');
        break;
      case '7':
        if (visual) panel.setVisualMode('cybergrid');
        break;
      case '8':
        if (visual) panel.setVisualMode('nebula');
        break;
      case '9':
        if (visual) panel.setVisualMode('cascade');
        break;
      case 'v':
        panel.setCategory(visual ? 'fractal' : 'visual');
        toast(visual ? 'Fractal engine' : 'Visualizer engine');
        break;
      case '0':
        app.resetView();
        panel.refreshControls();
        break;
      case 'h':
        document.body.classList.toggle('ui-hidden');
        break;
      default:
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    setModifiers(e);
    const k = e.key.toLowerCase();
    if (held.delete(k)) applyHeld();
  });

  // Tabbing away mid-flight would otherwise leave a key stuck down.
  window.addEventListener('blur', () => {
    held.clear();
    applyHeld();
    app.speedScale = 1;
  });
}

function clampStr(v: number): string {
  return Math.min(2, Math.max(-2, v)).toFixed(15);
}
