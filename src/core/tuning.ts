/**
 * Response curves for the controls. Pure functions, so they can be tested
 * without a browser.
 */

/** Lowest and highest iteration budget the control will reach. */
export const ITER_MIN = 80;
export const ITER_MAX = 6000;

/**
 * Map a 0..1 slider position to an iteration budget.
 *
 * Linear was the wrong shape: nearly all the useful range lives under about
 * 1500, so a straight mapping put every setting worth having in the first
 * fifteenth of the travel and spent the rest on values that only cost frame
 * rate. The exponent pushes the fine control down where the work happens —
 * half travel lands near 1400, not 3000.
 */
export function iterationsFromSlider(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return Math.round(ITER_MIN + (ITER_MAX - ITER_MIN) * Math.pow(clamped, 2.2));
}

/** Inverse of `iterationsFromSlider`, for putting the control back in place. */
export function sliderFromIterations(iterations: number): number {
  const clamped = Math.min(ITER_MAX, Math.max(ITER_MIN, iterations));
  return Math.pow((clamped - ITER_MIN) / (ITER_MAX - ITER_MIN), 1 / 2.2);
}

/**
 * How much to damp a control that reshapes the pattern, at a given depth.
 *
 * At the surface a Julia constant wants moving in steps of about 0.01. Sixty
 * orders of magnitude down, the visible structure responds to changes far
 * smaller than that, and an undamped control jumps straight past everything
 * worth seeing. Scaling by decimal depth keeps one drag worth roughly the same
 * fraction of the visible structure at every scale.
 */
export function sensitivityScale(log2Zoom: number): number {
  const decades = Math.max(0, log2Zoom) * 0.30103;
  return 1 / (1 + decades);
}

/** Zoom velocity decays to half in this many seconds once you stop pushing. */
export const FLIGHT_HALF_LIFE = 2.2;
/** Sustained speed while a zoom key is held, in powers of two per second. */
export const HELD_THRUST = 2.2;
/** Fastest sustained descent, in powers of two per second. */
export const FLIGHT_MAX = 6;

/**
 * Apply one frame of damping to a zoom velocity, snapping to a standstill once
 * it is too slow to be worth a redraw.
 */
export function decayFlight(velocity: number, dt: number, hold: boolean): number {
  if (hold) return velocity;
  const next = velocity * Math.pow(0.5, dt / FLIGHT_HALF_LIFE);
  return Math.abs(next) < 0.01 ? 0 : next;
}

/**
 * Turn a wheel or trackpad gesture into a change in zoom velocity.
 *
 * Browsers report wildly different units for the same physical gesture, so the
 * delta is normalised before it becomes thrust. Pushing keeps adding speed up
 * to the cap, which is what makes a repeated flick feel like accelerating
 * rather than like a series of jumps.
 */
export function thrustFromWheel(deltaY: number, deltaMode: number): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  const normalised = (-deltaY * unit) / 120;
  return Math.max(-3, Math.min(3, normalised)) * 0.9;
}

export function clampFlight(velocity: number): number {
  return Math.max(-FLIGHT_MAX, Math.min(FLIGHT_MAX, velocity));
}

/**
 * Pick a render scale from the frame rate.
 *
 * Fragment cost goes with the pixel count, so halving the scale quarters the
 * work. While the view is moving a soft image that keeps up beats a sharp one
 * that stutters; the moment it settles the caller asks for 1.0 again.
 *
 * The recovery threshold used to be 75 fps, which on a 60 Hz display is not a
 * number that can ever be reported: vsync caps the frame rate at the refresh
 * rate, so the condition to climb back was unreachable and the first stutter of
 * a session dropped the resolution permanently. That is the whole of why a
 * moment of load read as "it is pixelated now" rather than "it goes soft while
 * I move". The threshold has to sit below the refresh rate to be reachable at
 * all. Falling was also three times quicker than climbing; the two now move at
 * the same rate.
 *
 * Some gap between the thresholds is necessary — without it the scale would
 * flip up and down every sample at the crossover — and settling inside it is
 * the correct outcome rather than a failure: it means this is the resolution at
 * which the machine holds that frame rate. The gap is 48 to 55 now, where it
 * used to be 40 to 75, wide enough to strand a view that was comfortably fast.
 */
const SCALE_DOWN_FPS = 48;
const SCALE_UP_FPS = 55;
const SCALE_STEP = 1.18;

export function adaptScale(current: number, fps: number): number {
  let next = current;
  if (fps < SCALE_DOWN_FPS) next = current / SCALE_STEP;
  else if (fps > SCALE_UP_FPS) next = current * SCALE_STEP;
  return Math.max(0.25, Math.min(1, next));
}
