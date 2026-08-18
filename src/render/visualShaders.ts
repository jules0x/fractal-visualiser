/**
 * GLSL ES 3.00 sources for the visualizer engine.
 *
 * These are a different animal from the fractal shaders next door: no camera,
 * no arbitrary precision, no reference orbit. Each mode is a small closed-form
 * or noise-based field re-evaluated every frame from `u_time`, so the whole
 * thing morphs continuously on its own — the "visual delight" is the default
 * state, not something you have to fly into.
 *
 * The four sliders (speed / warp / complexity / symmetry) are shared across
 * every mode so the panel can stay generic. `u_audioLevel` and `u_audioBands`
 * are wired through but fed zero for now; they are the seam a future audio
 * analyser hangs off — every render function already has a spot where a beat
 * or a band would nudge it, so turning that on later is a matter of filling in
 * those two uniforms from an AnalyserNode, not touching the shaders again.
 */

export const MODE_FLOW = 0;
export const MODE_PLASMA = 1;
export const MODE_KALEIDO = 2;
export const MODE_MANDALA = 3;
export const MODE_TUNNEL = 4;
export const MODE_CYBERGRID = 5;
export const MODE_COSMIC = 6;
export const MODE_NEBULA = 7;
export const MODE_SPIRAL = 8;

export const VISUAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

out vec4 fragColor;

uniform vec2  u_resolution;
uniform int   u_vmode;
uniform float u_time;

// --- shared sliders ---------------------------------------------------------
uniform float u_speed;
uniform float u_warp;
uniform float u_complexity;
uniform float u_symmetry;
uniform float u_zoom;            // view scale: 1 is the default framing, bigger is closer in

// --- colour ------------------------------------------------------------------
uniform sampler2D u_palette;
uniform float u_colorDensity;
uniform float u_flowPhase;
uniform float u_hueSpin;         // turns, continuous hue rotation on top of the LUT

// --- future audio reactivity -------------------------------------------------
// Silent (0) until a source is wired up. u_audioLevel is overall energy;
// u_audioBands is (low, mid, high), each 0..~1.5.
uniform float u_audioLevel;
uniform vec3  u_audioBands;

/* ==========================================================================
 * 2D simplex noise — Ian McEwan / Ashima Arts. Widely used, public domain.
 * ========================================================================== */
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/* Fractal Brownian motion: 'octaves' layers of noise at doubling frequency and
 * halving amplitude. 'octaves' is runtime-controlled (the Complexity slider),
 * capped at 6 — past that the extra layers cost more than they change. */
float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return sum;
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

vec3 palette(float t) {
  vec3 c = texture(u_palette, vec2(fract(t), 0.5)).rgb;
  return hueRotate(c, u_hueSpin);
}

/* ==========================================================================
 * Flow field — two fbm layers, one warping the sampling coordinate of the
 * other, advected across the screen over time. The classic "ink in water"
 * look: u_warp controls how hard the flow bends, u_complexity the detail.
 * ========================================================================== */
vec3 renderFlow(vec2 uv, float t) {
  int oct = clamp(int(u_complexity), 1, 6);
  float bass = u_audioBands.x;
  vec2 p = uv * (1.2 + 0.15 * u_complexity);

  vec2 warp = vec2(
    fbm(p + vec2(0.0, t * 0.15), oct),
    fbm(p + vec2(5.2, -t * 0.13), oct)
  );
  p += warp * (u_warp + bass * 0.6) * 1.4;

  float n1 = fbm(p + vec2(t * 0.25, -t * 0.18) * u_speed, oct);
  float n2 = fbm(p * 1.7 + 3.1 + vec2(-t * 0.2, t * 0.22) * u_speed, oct);
  float field = n1 * 0.6 + n2 * 0.4;

  float tcol = (field * 0.5 + 0.5 + u_audioLevel * 0.35) * u_colorDensity + u_flowPhase;
  return palette(tcol);
}

/* ==========================================================================
 * Plasma — layered sine interference, each layer's own coordinate frame bent
 * a little by the last, so it reads as a single liquid surface rather than a
 * flat grid of waves. u_complexity picks the layer count.
 * ========================================================================== */
vec3 renderPlasma(vec2 uv, float t) {
  int layers = clamp(int(u_complexity) + 2, 3, 8);
  float mid = u_audioBands.y;
  vec2 p = uv * (2.0 + u_warp);
  float tt = t * u_speed;
  float v = 0.0;

  for (int i = 0; i < 8; i++) {
    if (i >= layers) break;
    float fi = float(i + 1);
    v += sin(p.x * fi * 1.3 + tt * (0.6 + fi * 0.11));
    v += sin(p.y * fi * 1.1 - tt * (0.5 + fi * 0.09));
    v += sin((p.x + p.y) * fi * 0.7 + tt * 0.4);
    p += (0.15 * u_warp + mid * 0.1) * vec2(sin(p.y * 1.7 + tt), cos(p.x * 1.7 - tt));
  }
  v /= float(layers) * 2.4;

  float tcol = (v * 0.5 + 0.5 + u_audioLevel * 0.35) * u_colorDensity + u_flowPhase;
  return palette(tcol);
}

/* ==========================================================================
 * Kaleidoscope — the view is folded into 'symmetry' pie-slice mirrors before
 * anything else runs, then an fbm field and a slow ring pattern are blended
 * inside that single wedge. Because the fold happens first, the field itself
 * can drift freely and the symmetry never breaks.
 * ========================================================================== */
vec3 renderKaleido(vec2 uv, float t) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float treble = u_audioBands.z;
  float folds = max(2.0, floor(u_symmetry));
  float seg = 6.28318530718 / folds;

  a = mod(a + t * 0.05 * u_speed, seg);
  a = abs(a - seg * 0.5);

  vec2 p = vec2(cos(a), sin(a)) * r * (2.0 + u_warp);
  p += vec2(t * 0.1, -t * 0.08) * u_speed;

  int oct = clamp(int(u_complexity), 1, 6);
  float n = fbm(p * 2.2 + r * 1.5, oct);
  float rings = sin(r * (6.0 + u_complexity) - t * u_speed * (1.5 + treble)) * 0.5 + 0.5;
  float field = mix(n * 0.5 + 0.5, rings, 0.35);

  float tcol = (field + u_audioLevel * 0.3) * u_colorDensity + u_flowPhase;
  return palette(tcol);
}

/* ==========================================================================
 * Mandala — a second variation on the fold: two independent mirror-folds at
 * different counts and rotation directions are layered in the same wedge,
 * which is what turns a single kaleidoscope into a flower with inner petals.
 * A slow radial breathing pulse (u_warp, nudged by treble) keeps the whole
 * thing from ever quite settling into a static rosette.
 * ========================================================================== */
vec3 renderMandala(vec2 uv, float t) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float treble = u_audioBands.z;
  float folds = max(3.0, floor(u_symmetry));
  float seg = 6.28318530718 / folds;

  float a1 = mod(a + t * 0.04 * u_speed, seg);
  a1 = abs(a1 - seg * 0.5);

  // A second fold at twice the count, turning the other way, is the petal.
  float seg2 = seg * 0.5;
  float a2 = mod(a - t * 0.07 * u_speed, seg2);
  a2 = abs(a2 - seg2 * 0.5);

  float pulse = 0.15 * (u_warp + treble) * sin(t * u_speed * 0.6);
  vec2 p1 = vec2(cos(a1), sin(a1)) * (r + pulse) * (2.0 + u_warp);
  vec2 p2 = vec2(cos(a2), sin(a2)) * r * (3.0 + u_warp * 1.5);

  int oct = clamp(int(u_complexity), 1, 6);
  float n1 = fbm(p1 * 1.8 + t * 0.05 * u_speed, oct);
  float n2 = fbm(p2 * 2.4 - t * 0.06 * u_speed, oct);
  float petals = sin(a * folds * 0.5 + r * (5.0 + u_complexity) - t * u_speed) * 0.5 + 0.5;

  float field = n1 * 0.4 + n2 * 0.3 + petals * 0.3;
  float tcol = (field + u_audioLevel * 0.3) * u_colorDensity + u_flowPhase;
  return palette(tcol);
}

/* ==========================================================================
 * Cosmic Mandala — a high-energy dramatic variation of the mandala.
 * Features explosive bass-driven zoom pulses, glowing neon lines, and light rays.
 * ========================================================================== */
vec3 renderCosmic(vec2 uv, float t) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  
  float bass = u_audioBands.x;
  float mid = u_audioBands.y;
  float treble = u_audioBands.z;
  
  float folds = max(3.0, floor(u_symmetry));
  float seg = 6.28318530718 / folds;
  
  // Dynamic zoom/pulsing driven by bass
  float zoomPulse = 1.0 - bass * 0.22;
  uv *= zoomPulse;
  r = length(uv);
  
  // Radial symmetry fold with rotation
  float a1 = mod(a + t * 0.05 * u_speed + bass * 0.08, seg);
  a1 = abs(a1 - seg * 0.5);
  
  // Second fold rotating in the opposite direction
  float seg2 = seg * 0.5;
  float a2 = mod(a - t * 0.08 * u_speed - mid * 0.08, seg2);
  a2 = abs(a2 - seg2 * 0.5);
  
  // Coordinate sets for complex shapes
  vec2 p1 = vec2(cos(a1), sin(a1)) * r;
  vec2 p2 = vec2(cos(a2), sin(a2)) * r;
  
  // Create recursive folds / kaleidoscope fractal structure
  // Dramatic glowing concentric rings with wave patterns
  float ringFreq = 12.0 + u_complexity * 4.0;
  
  // Sharp concentric lines (neon look)
  float lines = 1.0 - smoothstep(0.0, 0.08 + treble * 0.15, abs(sin(r * ringFreq - t * u_speed * 4.0 + bass * 2.0) - 0.5));
  
  // Petal structures
  float petal1 = abs(sin(p1.x * (4.0 + u_complexity) + t * 0.5)) * (1.0 - r * 0.4);
  float petal2 = abs(cos(p2.y * (6.0 + u_complexity) - t * 0.7)) * (1.0 - r * 0.4);
  
  // Dramatic light rays shooting from center
  float rays = pow(abs(cos(a * folds + sin(r * 4.0 - t * 2.0) * 0.5)), 6.0 + u_complexity) * (0.15 + bass * 0.85) * (1.0 / (r + 0.04));
  
  // Glowing core
  float core = smoothstep(0.25 + bass * 0.15, 0.0, r);
  
  // Combine fields into a dramatic high-contrast signal
  float field = mix(petal1 * 0.35 + petal2 * 0.35, lines * 0.55, 0.5) + rays * 0.28 + core * 0.22;
  
  // Color mapping with audio level scaling
  float tcol = (field + u_audioLevel * 0.5) * u_colorDensity + u_flowPhase;
  vec3 col = palette(tcol);
  
  // Add a dramatic neon bloom/flicker overlay based on treble and bass
  col += vec3(0.4, 0.15, 0.7) * rays * 0.35;
  col += vec3(0.05, 0.65, 0.85) * lines * 0.25 * (0.5 + treble * 0.5);
  col += vec3(0.85, 0.08, 0.35) * core * 0.4 * (0.5 + bass * 0.5);
  
  // Vignette to frame the dramatic center
  col *= smoothstep(1.8, 0.4, r);
  
  return col;
}

/* ==========================================================================
 * Infinity Tunnel — a 3D perspective cybernetic tunnel. Maps flat screen UVs
 * to cylinder space (depth = 1/r, angle = atan(y,x)), spiraling outwards.
 * Grid segments are modulated by high and low audio frequencies.
 * ========================================================================== */
vec3 renderTunnel(vec2 uv, float t) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  
  float bass = u_audioBands.x;
  float mid = u_audioBands.y;
  float treble = u_audioBands.z;
  
  // 3D coordinates in tunnel space
  float z = 1.0 / max(0.01, r) + t * u_speed * 1.5;
  // Twist the tunnel along its length (helix/spiral)
  float angle = a + sin(z * 0.18 + t * 0.4) * (0.4 + u_warp * 0.3) + bass * 0.15;
  
  // Infinite repetition / grid pattern
  float folds = max(4.0, floor(u_symmetry));
  float gridX = sin(angle * folds);
  float gridZ = sin(z * (6.0 + u_complexity));
  
  // Neon grid lines
  float grid = smoothstep(0.65 - treble * 0.15, 0.92, gridX * gridZ);
  
  // Ripples travelling down the tunnel
  float ripple = sin(z * 3.5 - t * u_speed * 5.0) * 0.5 + 0.5;
  
  // Combine visual components
  float field = mix(grid, ripple, 0.28) + (bass * 0.25 * (1.0 / (r + 0.08)));
  
  float tcol = field * u_colorDensity + u_flowPhase + z * 0.04;
  vec3 col = palette(tcol);
  
  // Add dark depth at center (vanishing point)
  col *= smoothstep(0.02, 0.35, r);
  
  // Add bright beat flashes
  col += vec3(0.08, 0.75, 0.9) * grid * (0.4 + treble * 0.6);
  col += vec3(0.9, 0.15, 0.55) * (bass * 0.35) * (1.0 / (r + 0.03));
  
  return col;
}

/* ==========================================================================
 * Cyber Grid — a futuristic perspective floor/ceiling synthwave grid.
 * Fades out towards the horizon and features beats pulsing waves up the tiles.
 * ========================================================================== */
vec3 renderCyberGrid(vec2 uv, float t) {
  float bass = u_audioBands.x;
  float mid = u_audioBands.y;
  float treble = u_audioBands.z;
  
  // Perspective horizon shift
  uv.y -= 0.12 * (1.0 - u_warp * 0.2);
  
  float ay = abs(uv.y);
  if (ay < 0.015) {
    return vec3(0.0); // Horizon void
  }
  
  // Projection mapping
  float z = 1.0 / ay;
  float x = uv.x * z;
  
  // Grid tiling with derivatives for smooth anti-aliased lines
  float spacingX = 1.5;
  float spacingZ = 0.8;
  float gridX = abs(fract(x * spacingX) - 0.5) / fwidth(x * spacingX);
  float gridZ = abs(fract(z * spacingZ - t * u_speed * 1.5) - 0.5) / fwidth(z * spacingZ);
  
  float lineX = 1.0 - min(gridX, 1.0);
  float lineZ = 1.0 - min(gridZ, 1.0);
  float grid = max(lineX, lineZ);
  
  // Fade grid into distance (horizon fog)
  grid *= smoothstep(0.0, 0.8, ay * 1.2);
  
  // Beat reaction glow expanding from horizon
  float beatGlow = 0.025 * (bass + mid) * (1.0 / (ay + 0.015));
  
  float field = grid * 0.55 + beatGlow;
  float tcol = field * u_colorDensity + u_flowPhase + x * 0.015;
  vec3 col = palette(tcol);
  
  // Synthwave aesthetic coloring: hot magenta and electric cyan
  col += vec3(0.85, 0.0, 0.45) * lineZ * 0.35 * (1.0 + bass);
  col += vec3(0.0, 0.75, 0.95) * lineX * 0.35;
  col += vec3(0.95, 0.45, 0.0) * beatGlow * 0.75;
  
  return col;
}

/* ==========================================================================
 * Liquid Nebula — a swirling cosmic gas cloud. Smooth coordinate domain warp
 * using multi-layered fractal noise, erupting on bass frequencies.
 * ========================================================================== */
vec3 renderNebula(vec2 uv, float t) {
  float bass = u_audioBands.x;
  float mid = u_audioBands.y;
  float treble = u_audioBands.z;
  
  int oct = clamp(int(u_complexity), 1, 6);
  vec2 p = uv * (1.0 + u_warp * 0.25);
  
  float w1 = fbm(p + t * u_speed * 0.1, oct);
  p.x += w1 * (0.3 + bass * 0.55);
  
  float w2 = fbm(p + vec2(4.8, -t * u_speed * 0.12), oct);
  p.y += w2 * (0.3 + mid * 0.55);
  
  float field = fbm(p * 2.0 + t * u_speed * 0.15, oct) * 0.5 + 0.5;
  
  float r = length(uv);
  float swirl = sin(r * (8.0 + u_complexity * 2.0) - t * u_speed * 3.0 + field * 4.0) * 0.5 + 0.5;
  
  float finalVal = mix(field, swirl, 0.35 + treble * 0.22) + u_audioLevel * 0.35;
  
  float tcol = finalVal * u_colorDensity + u_flowPhase;
  vec3 col = palette(tcol);
  
  col += vec3(0.95, 0.08, 0.28) * pow(field, 4.0) * bass * 0.75;
  col += vec3(0.08, 0.78, 0.95) * pow(swirl, 3.0) * treble * 0.65;
  
  return col;
}

/* ==========================================================================
 * Spiral Mandala — a logarithmic spiral variation of the mandala.
 * Spirals twist and curl dynamically to bass and high frequencies, creating moiré.
 * ========================================================================== */
vec3 renderSpiral(vec2 uv, float t) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  
  float bass = u_audioBands.x;
  float mid = u_audioBands.y;
  float treble = u_audioBands.z;
  
  float folds = max(3.0, floor(u_symmetry));
  
  // Spiral mapping: log-polar spiral coordinates
  float spiralFactor = 2.5 + u_warp * 1.5;
  float wind = a * folds + log(r + 0.05) * spiralFactor - t * u_speed * 2.0 - bass * 1.5;
  
  // Create interleaved spiral waves
  float spiral1 = sin(wind);
  float spiral2 = sin(wind * 2.0 + t * 0.5);
  
  // Fine, detailed line patterns (moiré lines)
  float lines = 1.0 - smoothstep(0.0, 0.06 + treble * 0.12, abs(spiral1 - 0.5));
  float lines2 = 1.0 - smoothstep(0.0, 0.04 + mid * 0.1, abs(spiral2 - 0.5));
  
  // Rotate space slightly differently for a secondary layer
  float a2 = a + sin(r * 3.0 - t) * 0.3;
  float petals = sin(a2 * folds * 1.5 - t * u_speed) * 0.5 + 0.5;
  
  // Glowing dots/sparks along the spiral arms
  float dots = abs(sin(log(r) * 12.0 - a * folds + t * u_speed * 4.0)) * lines;
  
  // Central vortex glow
  float core = smoothstep(0.2 + bass * 0.1, 0.0, r) * (1.0 + bass);
  
  float field = lines * 0.35 + lines2 * 0.25 + petals * 0.2 + dots * 0.25 + core * 0.15;
  float tcol = field * u_colorDensity + u_flowPhase + log(r) * 0.05;
  vec3 col = palette(tcol);
  
  // Add detailed glowing accents
  col += vec3(0.1, 0.7, 0.95) * lines2 * (0.4 + treble * 0.6);
  col += vec3(0.95, 0.3, 0.1) * dots * (0.4 + bass * 0.6);
  col += vec3(0.8, 0.1, 0.95) * core * 0.5;
  
  // Frame with vignette
  col *= smoothstep(1.8, 0.35, r);
  
  return col;
}

vec3 sampleVisual(vec2 fragPos) {
  float minDim = min(u_resolution.x, u_resolution.y);
  vec2 uv = (fragPos - u_resolution * 0.5) / (minDim * 0.5);
  uv /= max(0.05, u_zoom);

  if (u_vmode == ${MODE_FLOW}) return renderFlow(uv, u_time);
  else if (u_vmode == ${MODE_PLASMA}) return renderPlasma(uv, u_time);
  else if (u_vmode == ${MODE_KALEIDO}) return renderKaleido(uv, u_time);
  else if (u_vmode == ${MODE_MANDALA}) return renderMandala(uv, u_time);
  else if (u_vmode == ${MODE_COSMIC}) return renderCosmic(uv, u_time);
  else if (u_vmode == ${MODE_TUNNEL}) return renderTunnel(uv, u_time);
  else if (u_vmode == ${MODE_CYBERGRID}) return renderCyberGrid(uv, u_time);
  else if (u_vmode == ${MODE_NEBULA}) return renderNebula(uv, u_time);
  else return renderSpiral(uv, u_time);
}

void main() {
  fragColor = vec4(sampleVisual(gl_FragCoord.xy), 1.0);
}`;
