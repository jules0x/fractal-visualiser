/** DOM helpers and the two slider flavours the panel uses. */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

let toastTimer = 0;

export function toast(message: string): void {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 1900);
}

export interface SliderHandle {
  root: HTMLElement;
  sync(): void;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
  format(v: number): string;
  onChange(): void;
}

function shell(label: string, valueNode: HTMLElement, input: HTMLInputElement): HTMLElement {
  return el('div', { class: 'field' }, [
    el('div', { class: 'top' }, [el('label', { text: label }), valueNode]),
    input,
  ]);
}

/** An ordinary absolute slider. */
export function slider(o: SliderOptions): SliderHandle {
  const value = el('span', { class: 'value', text: o.format(o.get()) });
  const input = el('input', {
    type: 'range',
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.get(),
    'aria-label': o.label,
  }) as HTMLInputElement;

  input.addEventListener('input', () => {
    o.set(parseFloat(input.value));
    value.textContent = o.format(o.get());
    o.onChange();
  });

  return {
    root: shell(o.label, value, input),
    sync() {
      if (document.activeElement !== input) input.value = String(o.get());
      value.textContent = o.format(o.get());
    },
  };
}

export interface RelativeSliderOptions {
  label: string;
  /** Hard limits the value may never leave. */
  min: number;
  max: number;
  /** Half-width of the window the slider spans, re-read as the view deepens. */
  span(): number;
  get(): number;
  set(v: number): void;
  format(v: number): string;
  onChange(): void;
}

/**
 * A slider whose track covers a window around the current value rather than the
 * parameter's whole range, and which recentres when you let go.
 *
 * This is how the shape controls stay usable at depth. An absolute slider four
 * units wide has a fixed resolution — a few thousand steps across its track —
 * and sixty orders of magnitude down, the structure responds to changes finer
 * than one of those steps, so the control can only jump straight past
 * everything worth seeing. Narrowing the window with depth keeps one full sweep
 * of the track worth roughly the same amount of visible change at every scale.
 */
export function relativeSlider(o: RelativeSliderOptions): SliderHandle {
  const value = el('span', { class: 'value', text: o.format(o.get()) });
  const input = el('input', {
    type: 'range',
    'aria-label': o.label,
  }) as HTMLInputElement;

  let dragging = false;

  const recentre = () => {
    const v = o.get();
    const s = Math.max(1e-15, o.span());
    const lo = Math.max(o.min, v - s);
    const hi = Math.min(o.max, v + s);
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(Math.max(1e-18, (hi - lo) / 2000));
    input.value = String(v);
    value.textContent = o.format(v);
  };

  input.addEventListener('input', () => {
    o.set(parseFloat(input.value));
    value.textContent = o.format(o.get());
    o.onChange();
  });

  // Recentre only once the gesture ends, so the track doesn't shift underfoot.
  input.addEventListener('pointerdown', () => (dragging = true));
  const release = () => {
    if (!dragging) return;
    dragging = false;
    recentre();
  };
  input.addEventListener('pointerup', release);
  input.addEventListener('pointercancel', release);
  input.addEventListener('blur', release);
  input.addEventListener('keyup', () => !dragging && recentre());

  recentre();

  return {
    root: shell(o.label, value, input),
    sync() {
      if (!dragging && document.activeElement !== input) recentre();
      else value.textContent = o.format(o.get());
    },
  };
}
