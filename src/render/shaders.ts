/** GLSL ES 3.00 sources for the AETHER renderer. */

import { BAILOUT, BAILOUT_SQ } from '../core/fixed.ts';

// Explicit location so the fractal and visualizer programs agree on it
// without a lookup, and can therefore share one VAO.
export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/** Mode constants, shared with the TypeScript side. */
export const MODE_MANDELBROT = 0;
export const MODE_JULIA = 1;
export const MODE_NEWTON = 2;
export const MODE_MANDELBROT_POWER = 3;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

out vec4 fragColor;

uniform vec2  u_resolution;
uniform int   u_mode;
uniform int   u_maxIter;
uniform int   u_aa;              // samples per axis (1 or 2)

// --- perturbation inputs ---------------------------------------------------
// Reference orbit. RG32F and one texel per point for the escape-time modes;
// RGBA32F and two for Newton, which needs the step and the reciprocal powers
// as well. Fetching rgba from a two-channel texture yields (r, g, 0, 1), so a
// single sampler and a single expression serve both.
uniform sampler2D u_ref;
uniform int   u_refLen;
uniform int   u_refTexW;
uniform vec2  u_z0;              // Z_0 of the reference orbit
uniform int   u_scaleExp;        // E, where view half-height = u_scaleMant * 2^-E
uniform float u_scaleMant;       // in [1, 2)
uniform vec2  u_refShift;        // where Z_0 sits, in normalised view units
uniform int   u_refStride;       // texels per orbit point: 1 narrow, 2 wide

// --- direct (shallow) path inputs -----------------------------------------
uniform vec2  u_centerHi;
uniform vec2  u_centerLo;
uniform float u_directScale;     // view half-height as a plain float
uniform float u_power;
uniform float u_newtonPower;
uniform float u_relaxation;

// --- colour ----------------------------------------------------------------
uniform sampler2D u_palette;     // 1024x1 RGBA8, wrapping
uniform float u_colorDensity;
uniform float u_flowPhase;
uniform float u_hueSpin;         // turns (0..1), continuous hue rotation on top of the LUT

const float LOG2 = 0.6931471805599453;
const float BAILOUT_SQ = ${BAILOUT_SQ}.0;
const float LOG_BAILOUT = ${Math.log(BAILOUT)};

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cdiv(vec2 a, vec2 b) {
  float den = dot(b, b);
  return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / den;
}

/* Texel t of the orbit texture. Orbit point n starts at t = u_refStride * n. */
vec4 refTexel(int t) {
  return texelFetch(u_ref, ivec2(t % u_refTexW, t / u_refTexW), 0);
}

vec2 refZ(int i) {
  return refTexel(u_refStride * i).rg;
}

/* ==========================================================================
 * Perturbation core.
 *
 * Every pixel tracks only its delta d from the reference orbit Z:
 *
 *     z_n = Z_n + d_n,   d_{n+1} = 2 Z_n d_n + d_n^2 + c
 *
 * d starts astronomically small at depth (10^-100 and beyond), far below what
 * float32 can hold, so it is carried in a scaled form
 *
 *     d = D * 2^k     with D a float32 mantissa kept near 1, k an int exponent
 *
 * and renormalised whenever D drifts. Every power-of-two factor in the
 * recurrence stays inside float32's exponent range, so the delta iteration
 * never underflows no matter how deep the view goes.
 *
 * Rebasing (Zhuoran's method): whenever |z| drops below |d| — the situation
 * that makes the delta lose all its significant digits and produces the classic
 * perturbation "glitch" blobs — we re-express the same iterate against Z_0 and
 * restart the reference index. z itself is unchanged; only its decomposition
 * into Z + d is. This also covers running off the end of a reference orbit that
 * escaped early.
 * ========================================================================== */
float perturbEscape(vec2 c0, bool addC) {
  int E = u_scaleExp;
  vec2 D = c0;
  int k = -E;
  // Mandelbrot has d_0 = 0, so d_1 = c and we enter the loop already at n = 1.
  // Julia's d_0 is the pixel's own offset from the centre, so it starts at 0.
  int m = addC ? 1 : 0;
  vec2 Z0 = u_z0;

  // Mandelbrot's first tested iterate is index 1, so it gets one fewer pass to
  // land on the same budget as a direct escape-time loop.
  int limit = addC ? u_maxIter - 1 : u_maxIter;

  // Track the minimum squared magnitude of z across all iterates. Interior points
  // never escape; their orbit spirals toward (or cycles near) a periodic attractor.
  // The closest approach to the attractor is a smooth function over the interior
  // that varies by basin — which is what we use to colour the inside of the set.
  float minZ2 = 1.0e9;

  for (int n = 0; n < limit; n++) {
    vec2 Z = refZ(m);
    float s = exp2(float(k));       // underflows cleanly to 0.0 when very deep
    vec2 z = Z + D * s;
    float z2 = dot(z, z);

    // Update minimum only after the first few iterates so the orbit has had
    // a chance to leave the transient region near z = 0.
    if (n >= 3) minZ2 = min(minZ2, z2);

    if (z2 > BAILOUT_SQ) {
      // Normalised iteration count for continuous colouring. Measured against
      // the bailout radius so it goes smoothly to zero at the crossing.
      // Mandelbrot enters the loop one iteration in, so the true index is n+1.
      float idx = addC ? float(n) + 1.0 : float(n);
      float lz = log(z2) * 0.5;
      float nu = log(lz / LOG_BAILOUT) / LOG2;
      return idx + 1.0 - nu;
    }

    float dmag = length(D) * s;
    if (z2 < dmag * dmag || m + 1 >= u_refLen) {
      D = z - Z0;
      k = 0;
      m = 0;
      Z = Z0;
    }

    vec2 D2 = vec2(D.x * D.x - D.y * D.y, 2.0 * D.x * D.y);
    vec2 next = 2.0 * cmul(Z, D) + D2 * exp2(float(k));
    if (addC) next += c0 * exp2(float(-E - k));
    D = next;
    m += 1;

    // Renormalise the mantissa back toward 1 and fold the shift into k.
    float a = max(abs(D.x), abs(D.y));
    if (a > 0.0) {
      int e = int(floor(log2(a)));
      if (e > 24 || e < -24) {
        D *= exp2(float(-e));
        k += e;
      }
    }
  }
  // Encode minZ2 into the return value: interior returns are always < -1.
  // shade() will recover it as -(iter + 1.0).
  return -1.0 - minZ2;
}

/* ==========================================================================
 * Emulated double precision, used only by the shallow direct path for
 * non-quadratic Mandelbrot, which has no perturbation formulation here.
 * ========================================================================== */
struct ds { float hi; float lo; };

ds ds_set(float a) { return ds(a, 0.0); }

ds ds_add(ds a, ds b) {
  float s = a.hi + b.hi;
  float v = s - a.hi;
  float e = (a.hi - (s - v)) + (b.hi - v) + a.lo + b.lo;
  float hi = s + e;
  return ds(hi, e - (hi - s));
}

vec2 directCoord(vec2 norm) {
  ds x = ds_add(ds_set(norm.x * u_directScale), ds(u_centerHi.x, u_centerLo.x));
  ds y = ds_add(ds_set(norm.y * u_directScale), ds(u_centerHi.y, u_centerLo.y));
  return vec2(x.hi + x.lo, y.hi + y.lo);
}

vec2 cpow(vec2 z, float p) {
  float r = length(z);
  if (r == 0.0) return vec2(0.0);
  float th = atan(z.y, z.x);
  return pow(r, p) * vec2(cos(p * th), sin(p * th));
}

float directMandelbrotPower(vec2 c) {
  vec2 z = vec2(0.0);
  float minZ2 = 1.0e9;
  for (int n = 0; n < u_maxIter; n++) {
    float z2 = dot(z, z);
    // Skip n=0 where z=0 to avoid anchoring the minimum at the origin.
    if (n >= 3) minZ2 = min(minZ2, z2);
    if (z2 > BAILOUT_SQ) {
      float lz = log(z2) * 0.5;
      float nu = log(lz / LOG_BAILOUT) / log(u_power);
      return float(n) + 1.0 - nu;
    }
    z = cpow(z, u_power) + c;
  }
  return -1.0 - minZ2;
}

/* Continuous hue rotation, applied after the palette lookup rather than by
 * re-baking the LUT every frame. 'turns' is a fraction of a full rotation;
 * the matrix is the standard SVG/CSS feColorMatrix hueRotate formula, which
 * degrades gracefully to the identity at turns = 0. */
vec3 hueRotate(vec3 c, float turns) {
  float a = turns * 6.28318530718;
  float cosA = cos(a);
  float sinA = sin(a);
  mat3 m = mat3(
    0.213 + cosA * 0.787 - sinA * 0.213,
    0.213 - cosA * 0.213 + sinA * 0.143,
    0.213 - cosA * 0.213 - sinA * 0.787,

    0.715 - cosA * 0.715 - sinA * 0.715,
    0.715 + cosA * 0.285 + sinA * 0.140,
    0.715 - cosA * 0.715 + sinA * 0.715,

    0.072 - cosA * 0.072 + sinA * 0.928,
    0.072 - cosA * 0.072 - sinA * 0.283,
    0.072 + cosA * 0.928 + sinA * 0.072
  );
  return clamp(m * c, 0.0, 1.0);
}

/* ==========================================================================
 * Newton perturbation.
 *
 * Written as N(z) = A z + B z^-q  (A = 1 - a/p, B = a/p, q = p-1), the delta
 * from a reference orbit Z_{n+1} = N(Z_n) comes out *multiplicative*:
 *
 *     d' = N(Z + d) - N(Z)
 *        = A d + B[(Z+d)^-q - Z^-q]
 *        = d [ A - B P / ( Z^(q+1) (1 + e P) ) ],      e = d / Z
 *
 * where P(e) = sum_{k=1..q} C(q,k) e^(k-1). P is what is left of
 * (1+e)^q - 1 after the factor of e is taken out by hand — which is the whole
 * trick. Computing (Z+d)^q - Z^q numerically would subtract two nearly equal
 * numbers of size 1 to get an answer of size 10^-200; doing the cancellation
 * algebraically instead means no step of this ever loses a significant digit.
 *
 * Two consequences worth stating. First, at e -> 0 the bracket collapses to
 * A - qB/Z^(q+1), which is exactly N'(Z) — the linearised and exact regimes are
 * one expression, so there is no crossover to tune. Second, because d is only
 * ever multiplied, it cannot be annihilated the way a Mandelbrot delta is when
 * |z| falls below |d|. Newton therefore needs no rebasing at all.
 *
 * The series is only the right way to compute this while d is small. Once the
 * delta has grown to the size of the reference there is no cancellation left to
 * dodge, and the series is actively harmful: its top term goes as e^(q-1),
 * which for a degree of twelve overflows float32 and poisons the pixel with a
 * NaN. Past |d| = |Z|/2 the two pole terms are simply differenced instead.
 * Both forms are the same identity; they differ only in which one rounds well.
 *
 * d is carried as D * 2^k with D a float32 mantissa near 1, so the exponent
 * range of float32 never enters into how deep the view can go.
 *
 * Everything this loop needs from Z arrives precomputed. Newton never rebases,
 * so on iteration i every pixel in the frame is at reference index
 * min(i, last) — the same one — and Z^-(q+1) and 1/Z are one answer per
 * iteration rather than one per pixel. That is what keeps this loop free of
 * transcendentals: no log2, no exp2, no chain of powers, one divide.
 * ========================================================================== */
vec4 newtonPerturbShade(vec2 d0) {
  int q = int(u_newtonPower + 0.5) - 1;
  float ratio = u_relaxation / u_newtonPower;
  float A = 1.0 - ratio;
  float B = ratio;

  vec2 D = d0;
  int k = -u_scaleExp;
  // Held across iterations and refreshed only when k moves, which is rare.
  float s = exp2(float(k));       // underflows cleanly to 0.0 when very deep
  int m = 0;
  int last = max(0, u_refLen - 1);

  float n = 0.0;
  vec2 z = vec2(0.0);

  for (int i = 0; i < u_maxIter; i++) {
    int at = u_refStride * m;
    vec4 row = refTexel(at);
    vec4 aux = refTexel(at + 1);
    vec2 Z = row.rg;
    vec2 refStep = row.ba;        // Z_{m+1} - Z_m, differenced at full precision
    vec2 V = aux.rg;              // Z^-(q+1)
    vec2 invZ = aux.ba;           // 1/Z

    vec2 d = D * s;
    z = Z + d;
    n = float(i);

    // A zero reciprocal is how the reference reports the pole, where N has no
    // value and neither does the delta factor. Tested componentwise, because a
    // legitimately tiny reciprocal squares to nothing.
    if (invZ.x == 0.0 && invZ.y == 0.0) break;

    vec2 e = cmul(d, invZ);
    vec2 Dn;

    if (dot(e, e) < 0.25) {
      // |d| < |Z|/2. P by Horner from the top coefficient down, generating the
      // binomials as we go: C(q,j) = C(q,j+1) * (j+1) / (q-j).
      vec2 P = vec2(1.0, 0.0);      // C(q,q) = 1
      float cb = 1.0;
      for (int j = q - 1; j >= 1; j--) {
        cb = cb * float(j + 1) / float(q - j);
        P = vec2(cb, 0.0) + cmul(e, P);
      }

      vec2 den = vec2(1.0, 0.0) + cmul(e, P);   // = (1+e)^q
      if (dot(den, den) == 0.0) break;
      Dn = cmul(D, vec2(A, 0.0) - B * cmul(V, cdiv(P, den)));
    } else {
      // The delta is the size of the reference. d' = A d + B(z^-q - Z^-q) with
      // both terms taken at face value: nothing cancels here, and the series
      // would overflow. |d| this large also means |d| ~ |Z| ~ 1, so s is near 1
      // and dividing by it is safe however deep the view is.
      vec2 zq = vec2(1.0, 0.0);
      for (int j = 0; j < q; j++) zq = cmul(zq, z);
      float zq2 = dot(zq, zq);
      if (zq2 == 0.0) break;
      // Overflowing to zero is the right answer for a pixel thrown far out: its
      // pole term really has died.
      vec2 zpole = zq2 > 3.0e38 ? vec2(0.0) : cdiv(vec2(1.0, 0.0), zq);
      Dn = A * D + (B / s) * (zpole - cmul(V, Z));
    }

    // Anything that still went to infinity or NaN is a pixel the map has thrown
    // somewhere float32 cannot follow. Stop it rather than smear a NaN.
    if (!(dot(Dn, Dn) < 3.0e38)) break;

    vec2 dn = Dn * s;

    // The pixel's own Newton step, assembled from the reference's step and the
    // change in the delta. Deep inside a basin the delta term underflows and
    // this is just the reference's step, which is the right answer: that pixel
    // is indistinguishable from the reference at this scale.
    vec2 stepv = (refStep + (dn - d)) / u_relaxation;

    D = Dn;
    m = min(m + 1, last);

    if (dot(stepv, stepv) < 1e-12) {
      z = refZ(m) + dn;
      break;
    }

    // Renormalise the mantissa back toward 1 and fold the shift into k. Tested
    // against plain bounds rather than by taking a logarithm, so the common
    // case — the mantissa is still fine — costs a comparison.
    float a = max(abs(D.x), abs(D.y));
    if (a > 33554432.0 || (a < 5.9604645e-8 && a > 0.0)) {
      int ex = int(floor(log2(a)));
      D *= exp2(float(-ex));
      k += ex;
      s = exp2(float(k));
    }
  }

  // A pixel flung past float32 by the pole has no argument to speak of; fall
  // back to the reference's, which is where it was last meaningfully placed.
  if (!(dot(z, z) < 3.0e38)) z = refZ(m);

  // Hue from the root's argument, shaded by how fast it converged.
  float t = (atan(z.y, z.x) + 3.14159265) / 6.28318531 + n * 0.02 * u_colorDensity;
  vec3 rgb = texture(u_palette, vec2(fract(t + u_flowPhase), 0.5)).rgb;
  return vec4(hueRotate(rgb, u_hueSpin), 1.0);
}

/* Escape counts grow fast with depth, so the ramp is driven by sqrt(iter):
   banding stays legible at 200 iterations and at 20000. */
vec3 shade(float iter) {
  if (iter < -0.5) {
    // Interior point. Recover the minimum squared orbit radius encoded by
    // perturbEscape as -(minZ2 + 1): the fourth-root spreads the distribution
    // so subtle differences in basin depth are visible, and the +0.5 offset
    // shifts the palette to a complementary hue so interior and exterior
    // colours are naturally distinct.
    float minZ2 = -(iter + 1.0);
    float t = pow(clamp(minZ2, 0.0, 4.0) * 0.25, 0.25) * 0.4 * u_colorDensity + u_flowPhase + 0.5;
    vec3 col = hueRotate(texture(u_palette, vec2(fract(t), 0.5)).rgb, u_hueSpin);
    // Dim the interior so the luminous boundary filaments still read as
    // the brightest part of the image.
    return col * 0.38;
  }
  float t = sqrt(max(iter, 0.0)) * 0.09 * u_colorDensity + u_flowPhase;
  return hueRotate(texture(u_palette, vec2(fract(t), 0.5)).rgb, u_hueSpin);
}

vec4 sampleAt(vec2 fragPos) {
  float minDim = min(u_resolution.x, u_resolution.y);
  vec2 norm = (fragPos - u_resolution * 0.5) / (minDim * 0.5);

  if (u_mode == ${MODE_MANDELBROT}) {
    return vec4(shade(perturbEscape(norm * u_scaleMant, true)), 1.0);
  } else if (u_mode == ${MODE_JULIA}) {
    return vec4(shade(perturbEscape(norm * u_scaleMant, false)), 1.0);
  } else if (u_mode == ${MODE_NEWTON}) {
    // d_0 is measured from Z_0, which is not always the view centre: a view
    // sitting on the pole needs its reference seeded somewhere else.
    return newtonPerturbShade((norm - u_refShift) * u_scaleMant);
  } else {
    return vec4(shade(directMandelbrotPower(directCoord(norm))), 1.0);
  }
}

void main() {
  if (u_aa <= 1) {
    fragColor = sampleAt(gl_FragCoord.xy);
    return;
  }
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      acc += sampleAt(gl_FragCoord.xy + vec2(float(i) * 0.5 - 0.25, float(j) * 0.5 - 0.25));
    }
  }
  fragColor = acc * 0.25;
}`;
