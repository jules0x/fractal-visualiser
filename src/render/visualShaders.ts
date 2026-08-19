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
export const MODE_DROSTE = 9;
export const MODE_PHYLLOTAXIS = 10;
export const MODE_DOMAIN = 11;
export const MODE_VORONOI = 12;
export const MODE_ATTRACTOR = 13;
export const MODE_RORSCHACH = 14;
export const MODE_SIERPINSKI = 15;
export const MODE_LIGHTNING = 16;
export const MODE_MULTIPLY_RIDGE = 17;
export const MODE_ISOCONTOUR = 18;
export const MODE_CURL_FLOW = 19;
export const MODE_REACTION_WEB = 20;
export const MODE_ORBIT_TRAP = 21;
export const MODE_CELL_WALL = 22;
export const MODE_TRANSIT_TRAP = 23;

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

/* ==========================================================================
 * Droste / Infinite Mirror Zoom — log-polar self-similar tiling.
 * Transforms the screen into a repeating spiral where each ring is a smaller
 * copy of the whole scene, producing the "image inside image" falling-forever
 * effect. Complexity controls the number of tiles per ring; warp adds a
 * rotational offset that lets the spiral spin.
 * ========================================================================== */
vec3 renderDroste(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  // Log-polar mapping: r→log(r), a→a/2π, then tile.
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Prevent singularity at the origin.
  r = max(r, 0.001);

  // Droste scale ratio — controls how many levels repeat before looping back.
  // Higher complexity → more tightly packed rings.
  float scaleRatio = 1.0 + 0.7 * u_complexity;
  float lnRatio    = log(scaleRatio);

  // Map to log-polar with time-driven descent so it scrolls forever.
  float s = log(r) / lnRatio - t * u_speed * 0.4 - bass * 0.2;
  float wrap = fract(s);        // [0,1) — which ring we are in
  float tileA = a / (2.0 * 3.14159265) + u_warp * wrap * 0.25
                + t * u_speed * 0.08;

  // Reconstruct a 2D coordinate inside a single tile and then paint it
  // with the same fbm/ring combo used by Kaleido — reusing existing code.
  float reconstructR = exp(wrap * lnRatio);
  float reconstructA = tileA * 2.0 * 3.14159265;
  vec2  p = vec2(cos(reconstructA), sin(reconstructA)) * reconstructR
            * (1.5 + u_warp * 0.5);

  // Inner pattern — concentric rings + fbm noise inside each tile.
  int oct = clamp(int(u_complexity), 1, 6);
  float n    = fbm(p * 1.8 + t * u_speed * 0.07, oct);
  float rings = sin(wrap * 3.14159265 * 2.0 * (2.0 + u_complexity) + t * u_speed) * 0.5 + 0.5;

  // Blend: nearer to tile edge = more ring structure, centre = more noise.
  float edge  = 1.0 - abs(wrap * 2.0 - 1.0);   // peaks at 0.5, zero at edges
  float field = mix(rings, n * 0.5 + 0.5, edge * 0.6);

  // Add faint radial flare on treble.
  float flare = pow(max(0.0, cos(a * (4.0 + u_complexity) + t)), 8.0) * treble * 0.3;

  float tcol = (field + flare + u_audioLevel * 0.3) * u_colorDensity + u_flowPhase;
  return palette(tcol);
}

/* ==========================================================================
 * Phyllotaxis / Sunflower Spiral — golden-angle petal packing.
 * Places N dots at the golden angle (≈137.5°) apart, at radius ∝ sqrt(n),
 * reproducing the exact pattern of sunflower seeds and dahlia petals.
 * Each dot glows with a colour from the palette; the whole thing rotates and
 * breathes. Complexity controls dot count/density, symmetry adds extra
 * mirroring folds, warp morphs the spiral arm tightness.
 * ========================================================================== */
vec3 renderPhyllotaxis(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Golden angle in radians.
  const float GOLDEN = 2.39996322972865332;

  // How many seed points to sum over — more = denser, slower.
  // We keep this low (≤80) to stay fast even on mobile.
  float dotCount = 20.0 + u_complexity * 12.0;
  float breathing = 1.0 + 0.12 * sin(t * u_speed * 0.7) * (1.0 + bass);

  float glow = 0.0;
  float colAcc = 0.0;

  for (int i = 0; i < 80; i++) {
    if (float(i) >= dotCount) break;
    float fi   = float(i);
    float dotR = sqrt(fi / dotCount) * breathing * (1.0 + u_warp * 0.35);
    float dotA = fi * GOLDEN + t * u_speed * 0.25;
    vec2  dotPos = vec2(cos(dotA), sin(dotA)) * dotR;
    float dist = length(uv - dotPos);
    float radius = 0.025 + 0.018 * sin(fi * 0.7 + t) + treble * 0.01;
    glow   += exp(-dist * dist / (radius * radius)) * (0.8 + 0.2 * sin(fi * 0.31));
    colAcc += exp(-dist * dist / (radius * radius * 4.0)) * (fi / dotCount);
  }

  // Symmetry folds around the center.
  float folds = max(1.0, floor(u_symmetry * 0.5));
  float symGlow = glow;
  for (float f = 1.0; f < 8.0; f++) {
    if (f >= folds) break;
    float flipA = a + f * (2.0 * 3.14159265 / folds);
    vec2 flipped = vec2(cos(flipA), sin(flipA)) * r;
    float gf = 0.0;
    for (int i = 0; i < 80; i++) {
      if (float(i) >= dotCount) break;
      float fi   = float(i);
      float dotR = sqrt(fi / dotCount) * breathing * (1.0 + u_warp * 0.35);
      float dotA = fi * GOLDEN + t * u_speed * 0.25;
      vec2  dotPos = vec2(cos(dotA), sin(dotA)) * dotR;
      float dist = length(flipped - dotPos);
      float radius = 0.025 + 0.018 * sin(fi * 0.7 + t);
      gf += exp(-dist * dist / (radius * radius));
    }
    symGlow += gf;
  }
  symGlow /= (folds + 1.0);

  float field = clamp(symGlow * 0.5, 0.0, 1.5);
  float tcol  = (colAcc * 0.7 + field * 0.3 + u_audioLevel * 0.2) * u_colorDensity + u_flowPhase;
  vec3 col = palette(tcol);

  // Saturate bright petals.
  col *= 0.5 + field * 0.9;
  col += vec3(0.4, 0.1, 0.0) * (1.0 - exp(-field * 0.5)) * bass * 0.5;

  // Dark background where no petals reach.
  col *= smoothstep(0.0, 0.04, field);
  return col;
}

/* ==========================================================================
 * Domain Coloring — visualises a complex function f(z) by mapping each pixel
 * to a complex number and colouring by argument (→ hue) and magnitude (→
 * brightness / contour lines). Looks like stained-glass mandalas. Different
 * functions are blended according to the complexity slider so the scene morphs
 * continuously between them.
 *
 * Functions available (blended):
 *   low complexity  → z^n - 1  (Newton basins)
 *   mid complexity  → sin(z)
 *   high complexity → z^n + sin(z) / z
 * ========================================================================== */
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cdiv(vec2 a, vec2 b) {
  float d = dot(b,b); return vec2(dot(a,b), a.y*b.x - a.x*b.y)/d;
}
vec2 cpow(vec2 z, float n) {
  float r = length(z);
  float a = atan(z.y, z.x);
  return pow(r, n) * vec2(cos(a*n), sin(a*n));
}
vec2 csin(vec2 z) {
  return vec2(sin(z.x)*cosh(z.y), cos(z.x)*sinh(z.y));
}

vec3 renderDomain(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  // Map UV to complex plane, animated slow rotation and zoom.
  float scale = 2.5 / max(0.5, u_zoom) * (1.0 + u_warp * 0.3);
  float rot   = t * u_speed * 0.08;
  vec2 z = vec2(
    uv.x * cos(rot) - uv.y * sin(rot),
    uv.x * sin(rot) + uv.y * cos(rot)
  ) * scale;

  float n = max(2.0, u_complexity + 1.5);

  // Evaluate two functions and blend by complexity.
  // f1 = z^n - 1 (produces Newton fractal basins when iterated, but we
  //                just use its value for colouring).
  vec2 f1 = cpow(z, n) - vec2(1.0, 0.0);

  // f2 = sin(z) — produces infinite repeating symmetric pattern.
  vec2 f2 = csin(z * (0.8 + u_warp * 0.15) + vec2(t * u_speed * 0.05, 0.0));

  // f3 = z^n + sin(z)*c — hybrid.
  float c3 = u_complexity / 6.0;
  vec2 f3 = cpow(z, n) + cmul(csin(z), vec2(cos(t*0.2), sin(t*0.17))) * (0.5 + u_warp);

  float t01 = clamp(u_complexity / 3.0 - 1.0, 0.0, 1.0);
  float t12 = clamp(u_complexity / 3.0 - 2.0, 0.0, 1.0);
  vec2 fz = mix(mix(f1, f2, t01), f3, t12);

  // Domain coloring: hue from argument, brightness from log-magnitude contours.
  float arg  = atan(fz.y, fz.x);           // -π .. π
  float mag  = log(length(fz) + 0.001);

  float hue  = arg / (2.0 * 3.14159265) + 0.5;  // 0..1
  // Contour lines at each integer of log|f| — the classic zebra stripes.
  float contour = abs(fract(mag * 0.5) * 2.0 - 1.0);  // sawtooth 0..1
  float bright  = mix(0.5, 1.0, contour);              // modulate brightness

  // Colour: use the palette for hue cycling, then modulate by domain-coloring brightness.
  float tcol = (hue + u_flowPhase + u_audioLevel * 0.3) * u_colorDensity;
  vec3 col = palette(tcol) * bright;

  // Extra highlight on branch cuts and poles.
  float poles = 1.0 / (length(fz) + 0.05);
  col += palette(tcol + 0.3) * clamp(poles * 0.12, 0.0, 0.8) * (1.0 + bass * 0.5);

  return clamp(col, 0.0, 1.5);
}

/* ==========================================================================
 * Voronoi Kaleidoscope — Voronoi cell boundaries mirrored inside a radial
 * kaleidoscope fold. Each cell edge glows with a colour, the cells themselves
 * are darkened, producing a stained-glass / dragonfly-wing aesthetic.
 * ========================================================================== */
vec2 voronoiHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

vec3 renderVoronoi(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(2.0, floor(u_symmetry));
  float seg   = 3.14159265 * 2.0 / folds;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Kaleidoscope fold first.
  float af = mod(a + t * 0.04 * u_speed, seg);
  af = abs(af - seg * 0.5);
  vec2 folded = vec2(cos(af), sin(af)) * r * (2.5 + u_warp);

  // Voronoi in the folded space.
  float cellScale = 1.5 + u_complexity * 0.4;
  vec2 pv = folded * cellScale;
  vec2 pi = floor(pv);
  vec2 pf = fract(pv) - 0.5;

  float minDist1 = 1e9, minDist2 = 1e9;
  vec2  nearCell = vec2(0.0);

  for (int dx = -1; dx <= 1; dx++) {
    for (int dy = -1; dy <= 1; dy++) {
      vec2 neighbour = vec2(float(dx), float(dy));
      vec2 h = voronoiHash(pi + neighbour);
      // Animate cell centres with a slow drift.
      h = 0.5 + 0.5 * sin(h * 6.28318 + t * u_speed * 0.4);
      vec2  diff = neighbour - pf + h;
      float d    = dot(diff, diff);
      if (d < minDist1) { minDist2 = minDist1; minDist1 = d; nearCell = h; }
      else if (d < minDist2) { minDist2 = d; }
    }
  }
  minDist1 = sqrt(minDist1);
  minDist2 = sqrt(minDist2);

  // Edge distance — thin bright lines between cells.
  float edge = minDist2 - minDist1;
  float lineGlow = 1.0 - smoothstep(0.0, 0.06 + treble * 0.08, edge);

  // Cell interior shading.
  float interior = minDist1 * 0.6;

  // Colour by distance to nearest cell centre (smooth gradient inside each cell).
  float tcol = (nearCell.x * 0.5 + interior * 0.4 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;
  vec3 cellColor = palette(tcol) * (0.3 + interior * 0.7);
  vec3 edgeColor = palette(tcol + 0.3) * (1.5 + bass * 0.8);

  // Vignette.
  float vig = smoothstep(1.6, 0.3, r);

  return (cellColor + edgeColor * lineGlow) * vig;
}

/* ==========================================================================
 * Strange Attractor — Clifford attractor density field rendered by
 * accumulating many orbit steps and mapping the log-density to a palette.
 * The four parameters a/b/c/d oscillate slowly with time, keeping the attractor
 * morphing between different shapes without ever going static.
 * ========================================================================== */
vec3 renderAttractor(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  // Clifford attractor parameters — slow smooth oscillation.
  float spd = u_speed * 0.18;
  float a = 1.5  + 0.9 * sin(t * spd * 1.0  + u_warp * 0.5);
  float b = -1.8 + 0.9 * cos(t * spd * 0.7  + u_warp);
  float c = 1.6  + 0.7 * sin(t * spd * 1.3  + 1.0);
  float d = 0.9  + 0.9 * cos(t * spd * 0.9  + 2.0);

  // Accumulate density by iterating many steps and checking how close each
  // orbit point is to this pixel. 64 steps per pixel keeps it fast.
  int steps = clamp(int(u_complexity) * 10 + 20, 20, 64);
  float scale = 2.2 / max(0.05, u_zoom) * (1.0 + u_warp * 0.2);

  float density = 0.0;
  float colAcc  = 0.0;
  // Seed: deterministic from uv so every pixel follows its own short orbit.
  vec2 pos = uv * (1.0 + sin(t * 0.1) * 0.1);

  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    // Clifford iteration.
    float xn = sin(a * pos.y) + c * cos(a * pos.x);
    float yn = sin(b * pos.x) + d * cos(b * pos.y);
    pos = vec2(xn, yn);

    // How close is the orbit to this pixel's uv?
    vec2 screen = pos / scale;
    float dist = length(screen - uv);
    float r    = 0.018 + 0.01 * sin(float(i) + t);
    float w    = exp(-dist * dist / (r * r)) * (1.0 - float(i) / float(steps) * 0.5);
    density  += w;
    colAcc   += w * (float(i) / float(steps));
  }

  density = clamp(density, 0.0, 4.0);
  float logDensity = log(1.0 + density * 3.0) / log(1.0 + 3.0 * 4.0);

  float tcol = (colAcc / max(density, 0.01) * 0.8 + u_flowPhase + u_audioLevel * 0.25) * u_colorDensity;
  vec3 col = palette(tcol);

  // Bright hot-spots where density is highest.
  col *= 0.1 + logDensity * 1.4;
  col += palette(tcol + 0.15) * (logDensity * logDensity) * (0.5 + bass * 0.5);
  col += vec3(1.0) * pow(logDensity, 6.0) * (0.6 + treble * 0.4);

  return col;
}

/* ==========================================================================
 * Rorschach Biomorph — symmetric ink-blot driven by escape-time of a complex
 * transcendental iteration (z ← sin(z) + c). The left half is computed, then
 * mirrored. High-symmetry adds kaleidoscope folds on top of the bilateral mirror.
 * Warp shifts the Julia constant c; complexity controls iteration depth.
 * ========================================================================== */
vec3 renderRorschach(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  // Bilateral symmetry — fold x.
  float folds = max(1.0, floor(u_symmetry * 0.5));
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float seg = 3.14159265 / folds;   // half-angle per fold
  float af  = mod(abs(a), seg);
  af = min(af, seg - af);
  vec2 sym = vec2(cos(af), sin(af)) * r;

  // Julia constant oscillates with warp and time.
  vec2 c = vec2(
    sin(t * u_speed * 0.11 + u_warp * 1.2) * 0.7,
    cos(t * u_speed * 0.09 + u_warp * 0.8) * 0.35 + 0.1
  );

  // Biomorph iteration: z ← sin(z) + c
  // Escape when |z|>10; smooth iteration count.
  vec2  z    = sym * (2.5 / max(0.5, u_zoom));
  float iter = 0.0;
  float maxIt = max(8.0, u_complexity * 6.0 + 8.0);
  const float BAIL = 10.0;
  bool escaped = false;

  for (int i = 0; i < 48; i++) {
    if (float(i) >= maxIt) break;
    // z ← sin(z) + c
    z = csin(z) + c;
    float mag2 = dot(z, z);
    if (mag2 > BAIL * BAIL) {
      // Smooth escape count.
      iter = float(i) + 1.0 - log(log(sqrt(mag2)) / log(BAIL)) / log(2.0);
      escaped = true;
      break;
    }
  }

  float field;
  if (!escaped) {
    // Interior: use final |z| for a gentle gradient (like Mandelbrot interior).
    field = length(z) / BAIL;
  } else {
    field = iter / maxIt;
  }

  // Add radial vignette so the edges don't just cut off.
  float vig = smoothstep(1.8, 0.2, r);

  // Treble accent — fine internal structure.
  field += treble * 0.06 * sin(field * 30.0);

  float tcol = (field + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;
  vec3 col = palette(tcol);

  // Interior glow.
  if (!escaped) {
    col = mix(col, palette(tcol + 0.5) * (0.5 + bass * 0.5), 0.5);
  }

  return col * vig;
}

/* ==========================================================================
 * Sierpiński Triangle — rendered via the "escape-time IFS" technique.
 *
 * For each pixel we apply the inverse of one of the three similarity maps
 *   T0: z → 2z              (zoom out from vertex 0)
 *   T1: z → 2z - v1         (zoom out from vertex 1)
 *   T2: z → 2z - v2         (zoom out from vertex 2)
 * repeatedly.  If the point never lands in the filled triangle after
 * maxIter steps it is considered interior (inside a hole); otherwise
 * the iteration count gives a smooth depth value we map to colour.
 *
 * Symmetry: the three vertices can be rotated so the triangle spins.
 * Warp adds a smooth domain-twist so the straight edges curve like a
 * living organism.  Complexity sets iteration depth; speed drives the
 * slow rotation and breathing.
 * ========================================================================== */
vec3 renderSierpinski(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  // Slow rotation driven by speed + a very gentle bass nudge.
  float angle = t * u_speed * 0.12 + bass * 0.05;
  float symFolds = max(1.0, floor(u_symmetry / 2.0));

  // Optional domain warp — twists the plane before the IFS runs.
  vec2 warped = uv;
  if (u_warp > 0.01) {
    float wx = snoise(uv * 1.4 + vec2(t * u_speed * 0.07, 0.0));
    float wy = snoise(uv * 1.4 + vec2(0.0, t * u_speed * 0.07));
    warped += vec2(wx, wy) * u_warp * 0.18;
  }

  // Scale so the triangle fits inside the unit circle.
  // A breathing pulse on u_warp / bass keeps it alive.
  float breathe = 1.0 + 0.06 * sin(t * u_speed * 0.5) * (1.0 + bass * 0.4);
  vec2 p = warped * 1.55 * breathe;

  // Rotate the whole thing.
  float ca = cos(angle), sa = sin(angle);
  p = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);

  // Three vertices of the outer triangle, evenly spaced.
  // We pick angles at 90°, 210°, 330° so one vertex points up.
  const float PI2 = 6.28318530718;
  vec2 v0 = vec2(cos(PI2 * 0.0 / 3.0 + 1.5708), sin(PI2 * 0.0 / 3.0 + 1.5708));
  vec2 v1 = vec2(cos(PI2 * 1.0 / 3.0 + 1.5708), sin(PI2 * 1.0 / 3.0 + 1.5708));
  vec2 v2 = vec2(cos(PI2 * 2.0 / 3.0 + 1.5708), sin(PI2 * 2.0 / 3.0 + 1.5708));

  // Apply kaleidoscope fold if symmetry > 2 so the triangle tiles.
  if (symFolds > 1.0) {
    float a = atan(p.y, p.x);
    float r = length(p);
    float seg = PI2 / (symFolds * 2.0);
    a = mod(a, PI2 / symFolds);
    a = abs(a - PI2 / (symFolds * 2.0));
    p = vec2(cos(a), sin(a)) * r;
  }

  // IFS escape-time loop.
  int maxIter = clamp(int(u_complexity) * 2 + 6, 6, 18);
  float iter = 0.0;
  bool inside = true;

  vec2 q = p;
  for (int i = 0; i < 18; i++) {
    if (i >= maxIter) break;

    // Find nearest vertex.
    float d0 = dot(q - v0, q - v0);
    float d1 = dot(q - v1, q - v1);
    float d2 = dot(q - v2, q - v2);

    // Inverse contraction: zoom out from the nearest vertex.
    if (d0 <= d1 && d0 <= d2) {
      q = q * 2.0 - v0;
    } else if (d1 <= d2) {
      q = q * 2.0 - v1;
    } else {
      q = q * 2.0 - v2;
    }

    // Once q escapes the bounding triangle (rough test: r > 1.2) we know
    // this pixel is in a "hole" — record depth and stop.
    if (dot(q, q) > 1.44) {
      iter = float(i) + 1.0 - log(dot(q, q)) * 0.5;
      inside = false;
      break;
    }
  }

  if (inside) {
    // Deep interior: glow subtly with a different palette offset.
    float deepVal = length(q) * 0.4;
    float tcol = (deepVal + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;
    vec3 col = palette(tcol) * (0.15 + bass * 0.1);
    return col;
  }

  // Smooth escape depth → palette.
  float depth = iter / float(maxIter);

  // Edge glow: narrow band just inside each triangle boundary.
  float edge = 1.0 - smoothstep(0.0, 0.08 + treble * 0.08, fract(iter));
  float edgeBright = edge * (1.0 + treble * 0.8);

  float tcol = (depth + u_flowPhase + u_audioLevel * 0.25) * u_colorDensity;
  vec3 col = palette(tcol);

  // Bright, glowing edges.
  col += palette(tcol + 0.25) * edgeBright * 0.9;

  // Very fine sub-triangle shimmer on treble.
  col += vec3(0.9, 0.95, 1.0) * pow(edge, 4.0) * treble * 0.6;

  // Vignette.
  float vig = smoothstep(1.9, 0.2, length(uv));
  return col * vig;
}

/* ==========================================================================
 * Lichtenberg Lightning — ridged FBM electric discharge.
 *
 * Trick: flipping noise to 1 - |n| creates sharp bright ridges on a dark
 * field that naturally branch and meander like real lightning arcs.
 * Stacking multiple warped octaves at different scales gives the fractal
 * branching pattern. A rapid hash-flicker simulates the random restrike
 * timing of real discharges; a soft Gaussian halo adds the characteristic
 * blue-purple corona glow around each bolt.
 *
 * Speed:      flicker rate and drift velocity
 * Warp:       how violently bolts bend and fork
 * Complexity: octave depth (more = finer branching)
 * Symmetry:   radial copies of the bolt tree (try 1 for single strike,
 *             6 for a radial starburst)
 * ========================================================================== */

// Hash for per-frame flicker — returns 0..1 pseudorandom from a float.
float hash11(float n) { return fract(sin(n) * 43758.5453); }

// Ridged noise: 1 - |snoise| — sharp bright ridges on a dark background.
float ridgeNoise(vec2 p) { return 1.0 - abs(snoise(p)); }

// Multi-octave ridged FBM — the key to fractal branching.
float ridgeFbm(vec2 p, int octaves) {
  float sum   = 0.0;
  float amp   = 0.5;
  float freq  = 1.0;
  float prev  = 1.0;   // weight previous ridge to amplify crossings
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = ridgeNoise(p * freq);
    sum  += n * n * amp * prev;  // n*n sharpens the ridges; prev boosts forks
    prev  = n;
    freq *= 2.07;
    amp  *= 0.5;
  }
  return sum;
}

vec3 renderLightning(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(1.0, floor(u_symmetry));
  float seg   = 6.28318530718 / folds;

  // Optional radial symmetry fold.
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float af = mod(a, seg);
  af = abs(af - seg * 0.5);
  vec2 p = vec2(cos(af), sin(af)) * r;

  // Radial bias: bolts travel outward from origin, so we stretch along r.
  float radialStretch = 1.0 + r * 1.4;
  vec2 stretched = p * vec2(1.0, radialStretch);

  // Domain warp — a slow drift that makes bolts writhe.
  int oct = clamp(int(u_complexity), 2, 8);
  float driftX = snoise(stretched * 0.9 + vec2(t * u_speed * 0.15, 0.4));
  float driftY = snoise(stretched * 0.9 + vec2(0.4, -t * u_speed * 0.13));
  vec2 warped = stretched + vec2(driftX, driftY) * u_warp * 0.55;

  // Primary bolt field: ridged FBM.
  float bolt = ridgeFbm(warped * (1.2 + u_warp * 0.3)
                        + vec2(t * u_speed * 0.04, -t * u_speed * 0.03), oct);

  // Sharpen heavily: power function collapses everything except the very
  // brightest ridge peaks into near-zero, leaving thin glowing lines.
  float sharpBolt = pow(clamp(bolt, 0.0, 1.0), 3.5 + u_complexity * 0.3);

  // ---- Flicker -----------------------------------------------------------
  float flickerBin  = floor(t * u_speed * 8.0);
  float sector      = floor(af / seg * 6.0);
  float flicker     = step(0.35, hash11(flickerBin * 7.3 + sector * 13.1 + r * 5.7));
  float flickerFast = step(0.25, hash11(flickerBin * 31.7 + r * 11.3 + treble));
  float flickerMask = max(flicker, flickerFast * 0.6);

  float bassBoost = 1.0 + bass * 1.2;
  float boltFinal = sharpBolt * flickerMask * bassBoost;

  // ---- Corona / halo -----------------------------------------------------
  float halo = pow(clamp(bolt * 0.8, 0.0, 1.0), 1.4) * 0.18 * flickerMask;

  // ---- Colour — all from palette -----------------------------------------
  float tcol = (bolt * 0.4 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;

  vec3 bgColor   = palette(tcol) * 0.04;
  vec3 haloColor = palette(tcol + 0.08) * halo * 2.2;
  vec3 boltColor = palette(tcol + 0.15) * boltFinal * 3.5;
  vec3 coreColor = mix(palette(tcol + 0.20), vec3(1.0), 0.55) * pow(boltFinal, 2.0) * 5.0;

  vec3 col = bgColor + haloColor + boltColor + coreColor;

  // Secondary branching: a finer-scale bolt on top for extra detail.
  float fineBolt = ridgeFbm(warped * 3.5 + vec2(-t * u_speed * 0.06, t * u_speed * 0.05),
                            min(oct, 5));
  fineBolt = pow(clamp(fineBolt, 0.0, 1.0), 6.0) * flickerMask * bassBoost;
    // Radial vignette.
  float vig = smoothstep(1.85, 0.05, r);
  col *= vig;

  return col;
}

/* ==========================================================================
 * Curl noise helper: 2D curl of a scalar noise field.
 * The resulting vector is divergence-free, so its streamlines are closed
 * loops — similar to magnetic field lines.  Curl = (df/dy, -df/dx).
 * ========================================================================== */
vec2 curlNoise(vec2 p, float drift) {
  float eps = 0.003;
  float n1 = snoise(p + vec2(0.0,  eps) + vec2(0.0, drift));
  float n2 = snoise(p - vec2(0.0,  eps) + vec2(0.0, drift));
  float n3 = snoise(p + vec2(eps,  0.0) + vec2(0.0, drift));
  float n4 = snoise(p - vec2(eps,  0.0) + vec2(0.0, drift));
  return vec2((n1 - n2) / (2.0 * eps), -(n3 - n4) / (2.0 * eps));
}

/* ==========================================================================
 * Multiply Ridge — two ridged FBM fields multiplied together.
 *
 * The PRODUCT is only bright where BOTH fields have a ridge simultaneously,
 * giving isolated, razor-thin filaments on a truly black background.
 * A small frequency offset between the two fields (1.07x) introduces a
 * beat/interference fringe that creates large-scale moiré structure on top
 * of the fine ridges.  Power-law sharpening (exponent up to ~12 via the
 * Complexity slider) makes dark areas absolutely black.
 * ========================================================================== */
vec3 renderMultiplyRidge(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(2.0, floor(u_symmetry));
  float seg   = 6.28318530718 / folds;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float af = mod(a, seg);
  af = abs(af - seg * 0.5);
  vec2 p = vec2(cos(af), sin(af)) * r;

  int oct = clamp(int(u_complexity), 2, 8);

  float wx = snoise(p * 0.8 + vec2(t * u_speed * 0.10,  0.3));
  float wy = snoise(p * 0.8 + vec2(0.3, -t * u_speed * 0.09));
  vec2 warped = p + vec2(wx, wy) * u_warp * 0.4;

  // Field 1: base frequency
  float f1 = ridgeFbm(warped * 1.8 + vec2(t * u_speed * 0.04, 0.0), oct);
  // Field 2: 1.07x frequency creates beat interference fringe
  float f2 = ridgeFbm(warped * 1.8 * 1.07 + vec2(0.0, t * u_speed * 0.035), oct);

  // Gain-boosted product: sharp intersections without collapsing to zero
  float combined = clamp(f1 * f2 * 2.5, 0.0, 1.0);

  // Power-law steepening: crisp glowing lines
  float sharpness = 1.8 + u_complexity * 0.35 + bass * 0.4;
  float bolt = pow(combined, sharpness);

  // Background/volume field: single-ridge blend prevents total darkness
  float ambientVol = clamp((f1 + f2) * 0.45, 0.0, 1.0);
  float volumeGlow = pow(ambientVol, 2.0) * 0.35;

  // Fine detail layer
  float fine = ridgeFbm(warped * 3.8 + vec2(-t * u_speed * 0.06, t * u_speed * 0.05), min(oct, 6));
  float fineBolt = pow(clamp(f1 * fine * 2.0, 0.0, 1.0), sharpness * 1.3);

  // Corona halo around the main structure
  float halo = pow(clamp(combined * 1.2, 0.0, 1.0), 1.2) * 0.45;

  float tcol = (combined * 0.5 + ambientVol * 0.3 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;

  // Rich base color output
  vec3 col = palette(tcol) * (0.08 + volumeGlow * 0.6);
  col += palette(tcol + 0.08) * halo * 2.8;
  col += palette(tcol + 0.15) * bolt * 5.0;
  col += mix(palette(tcol + 0.22), vec3(1.0), 0.65) * pow(bolt, 1.8) * 9.0;
  col += palette(tcol + 0.28) * fineBolt * 3.5;
  col += mix(palette(tcol + 0.35), vec3(1.0), 0.80) * pow(fineBolt, 2.2) * 7.0;

  col *= smoothstep(1.9, 0.05, r);
  return col;
}

/* ==========================================================================
 * Iso-Contour — gradient-magnitude contour lines.
 *
 * Instead of ridged FBM (which finds noise peaks), we compute the finite-
 * difference gradient of regular FBM and threshold it.  The result is
 * mathematically exact level-set contour lines: every contour has uniform
 * width and there is zero spatial bias.  Two frequencies at a small offset
 * (beat ratio controlled by Warp) produce a drifting interference fringe
 * that adds large-scale depth to the engraved appearance.
 * ========================================================================== */
vec3 renderIsoContour(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(2.0, floor(u_symmetry));
  float seg   = 6.28318530718 / folds;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float af = mod(a, seg);
  af = abs(af - seg * 0.5);
  vec2 p = vec2(cos(af), sin(af)) * r;

  int oct = clamp(int(u_complexity), 2, 8);

  float wx = snoise(p * 1.0 + vec2(t * u_speed * 0.08,  0.0));
  float wy = snoise(p * 1.0 + vec2(0.0, -t * u_speed * 0.07));
  vec2 warped = p + vec2(wx, wy) * u_warp * 0.35;

  // Central sample + two neighbours for gradient estimation.
  float ieps = 0.005;
  vec2 wt = vec2(t * u_speed * 0.04, 0.0);
  float n0 = fbm(warped * 2.0 + wt, oct);
  float nx = fbm((warped + vec2(ieps, 0.0)) * 2.0 + wt, oct);
  float ny = fbm((warped + vec2(0.0, ieps)) * 2.0 + wt, oct);
  float gradMag = length(vec2(nx - n0, ny - n0)) / ieps;

  // Primary iso-lines and a beat frequency offset.
  float freq1 = 3.0 + u_complexity * 0.8;
  float freq2 = freq1 * (1.0 + u_warp * 0.12);

  float lw   = 0.04 + treble * 0.02;
  float line1 = 1.0 - smoothstep(0.0, lw,
                  abs(fract(n0 * freq1 + t * u_speed * 0.10) - 0.5));
  float line2 = 1.0 - smoothstep(0.0, lw * 0.6,
                  abs(fract(n0 * freq2 - t * u_speed * 0.08) - 0.5));

  float field   = line1 * (1.0 + bass * 0.6) + line2 * 0.45;
  float gradEnh = clamp(gradMag * 0.3, 0.0, 1.0) * field;
  float halo    = pow(clamp(line1 * 0.5 + line2 * 0.3, 0.0, 1.0), 2.0) * 0.15;

  float tcol = (n0 * 0.5 + 0.5 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;

  vec3 col = palette(tcol) * 0.04;
  col += palette(tcol + 0.07) * halo * 2.0;
  col += palette(tcol + 0.13) * field * 3.5;
  col += mix(palette(tcol + 0.19), vec3(1.0), 0.45) * pow(field, 2.0) * 5.5;
  col += palette(tcol + 0.25) * gradEnh * 2.5;

  col *= smoothstep(1.9, 0.1, r);
  return col;
}

/* ==========================================================================
 * Curl Flow — divergence-free flow-line patterns.
 *
 * The curl (perpendicular gradient) of a scalar noise field is divergence-
 * free: its streamlines are closed loops, like magnetic field lines around
 * a wire or ocean gyres.  We modulate a ridged FBM with the curl magnitude
 * so the pattern follows these closed orbits rather than blobbily spreading.
 * A secondary curl at 2.3x scale adds fine filamentation.
 * ========================================================================== */
vec3 renderCurlFlow(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(2.0, floor(u_symmetry));
  float seg   = 6.28318530718 / folds;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float af = mod(a, seg);
  af = abs(af - seg * 0.5);
  vec2 p = vec2(cos(af), sin(af)) * r;

  int oct = clamp(int(u_complexity), 2, 8);
  float spd = u_speed * 0.10;

  // Primary curl at base scale.
  vec2 curl1 = curlNoise(p * 1.4 * (1.0 + u_warp * 0.25), t * spd);
  float curlMag1 = length(curl1);
  vec2 curlDir1  = curlMag1 > 0.001 ? curl1 / curlMag1 : vec2(1.0, 0.0);

  // Advect a ridged FBM along the curl flow lines.
  vec2 adv1  = p + curlDir1 * u_warp * 0.25 + vec2(t * spd * 0.3, 0.0);
  float ridge1 = ridgeFbm(adv1 * 2.0, oct);

  // Secondary curl at finer scale for sub-structure.
  vec2 curl2    = curlNoise(p * 3.2 + vec2(5.1, 2.7), t * spd * 0.7);
  float curlMag2 = length(curl2);

  // Field: ridge amplitude modulated by local curl magnitude.
  float field = ridge1 * (0.5 + clamp(curlMag1, 0.0, 1.0) * 0.5);
  float bolt  = pow(clamp(field, 0.0, 1.0), 3.5 + u_complexity * 0.4);

  // Fine curl filaments from secondary layer.
  float fine = pow(clamp(curlMag2 * 0.7, 0.0, 1.0), 2.5)
               * (0.3 + bass * 0.25 + treble * 0.1);

  float halo = pow(clamp(field, 0.0, 1.0), 1.3) * 0.18;

  float tcol = (curlMag1 * 0.35 + field * 0.35 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;

  vec3 col = palette(tcol) * 0.04;
  col += palette(tcol + 0.08) * halo * 2.2;
  col += palette(tcol + 0.15) * bolt * 4.5;
  col += mix(palette(tcol + 0.21), vec3(1.0), 0.50) * pow(bolt, 1.8) * 6.5;
  col += palette(tcol + 0.27) * fine * 2.2;

  col *= smoothstep(1.9, 0.05, r);
  return col;
}

/* ==========================================================================
 * Reaction Web — approximate Turing / reaction-diffusion patterns.
 *
 * True Gray-Scott requires a framebuffer; we approximate it by sampling FBM
 * at two very different scales.  The fine-scale activator wants to spot;
 * the coarse-scale inhibitor supplies a spatially-varying threshold that
 * breaks the pattern into organic cells.  The cell BOUNDARY (where
 * activator ~ threshold) is found via smoothstep and sharpened with a
 * finite-difference gradient — giving paper-thin glowing cell walls with
 * true darkness inside each cell, exactly like diatom skeletons or soap
 * foam.
 * ========================================================================== */
vec3 renderReactionWeb(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(2.0, floor(u_symmetry));
  float seg   = 6.28318530718 / folds;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float af = mod(a, seg);
  af = abs(af - seg * 0.5);
  vec2 p = vec2(cos(af), sin(af)) * r;

  int oct = clamp(int(u_complexity), 2, 8);
  float drift = t * u_speed * 0.055;

  // Activator: fine scale, drifts quickly.
  float fineScale = 3.5 + u_complexity * 0.4;
  vec2 pA = p * fineScale + vec2(drift, 0.0);
  // Non-linear self-warp creates the Turing instability (cells of varying size).
  float selfWarp = snoise(pA * 0.45 - vec2(0.0, drift * 0.6)) * u_warp * 0.5;
  pA += selfWarp;
  float activator = fbm(pA, oct) * 0.5 + 0.5;

  // Inhibitor: coarse scale, slow drift — sets spatially-varying threshold.
  float coarseScale = fineScale * 0.32;
  vec2 pI = p * coarseScale - vec2(0.0, drift * 0.7);
  float inhibitor = fbm(pI, max(oct - 1, 1)) * 0.5 + 0.5;

  // Signed distance to the cell boundary.
  float threshold  = inhibitor * (0.55 + u_warp * 0.2);
  float signedDist = activator - threshold;

  float bw       = 0.07 + treble * 0.05;
  float boundary = 1.0 - smoothstep(0.0, bw, abs(signedDist));
  float interior = smoothstep(0.04, 0.18, signedDist);

  // Gradient sharpening: peaks exactly on the cell wall.
  float reps = 0.004;
  float aL = fbm((p + vec2(-reps, 0.0)) * fineScale + vec2(drift, 0.0), oct) * 0.5 + 0.5;
  float aR = fbm((p + vec2( reps, 0.0)) * fineScale + vec2(drift, 0.0), oct) * 0.5 + 0.5;
  float aU = fbm((p + vec2(0.0,  reps)) * fineScale + vec2(drift, 0.0), oct) * 0.5 + 0.5;
  float aD = fbm((p - vec2(0.0,  reps)) * fineScale + vec2(drift, 0.0), oct) * 0.5 + 0.5;
  float wallGrad = length(vec2(aR - aL, aU - aD)) / (2.0 * reps);
  float sharpWall = boundary * clamp(wallGrad * 0.5, 0.0, 2.0);

  float tcol = (activator * 0.4 + inhibitor * 0.25 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;

  vec3 col = palette(tcol) * interior * 0.22;
  col += palette(tcol + 0.30) * (1.0 - interior) * 0.07;
  col += palette(tcol + 0.14) * boundary * 2.8;
  col += mix(palette(tcol + 0.21), vec3(1.0), 0.40)
         * sharpWall * (3.5 + bass * 1.2);
  col += palette(tcol + 0.08) * sharpWall * (1.2 + bass * 0.6);

  col *= smoothstep(1.9, 0.1, r);
  return col;
}

/* ==========================================================================
 * Orbit Trap — Julia set with geometric trap coloring.
 *
 * We iterate z -> z^2 + c (Julia set) directly in the shader and track the
 * MINIMUM DISTANCE each orbit comes to three geometric shapes: a unit ring,
 * the two coordinate axes (a cross), and the origin (a point).  The trap
 * distance replaces the escape count as the color value.  Because we color
 * by proximity to a geometric feature rather than iteration depth, we get
 * sharp geometric SHAPES embedded recursively inside the Julia set — the
 * same branching fractal structure but expressed as neon lines rather than
 * coloured regions.  Complexity blends between the three trap types.
 * ========================================================================== */
vec3 renderOrbitTrap(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  // Slow rotation so the pattern never goes completely static.
  float ang = t * u_speed * 0.07;
  float ca = cos(ang), sa = sin(ang);
  vec2 ruv = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);

  float scale = 2.5 * (1.0 + u_warp * 0.18);
  vec2 z0 = ruv * scale;

  // Julia constant orbiting slowly through interesting parameter space.
  float jt  = t * u_speed * 0.11;
  float jr  = 0.75 + u_warp * 0.15;
  vec2 jc   = vec2(jr * cos(jt * 0.7 + 0.5), jr * sin(jt * 0.5 + 1.2));

  int maxIt    = clamp(int(u_complexity) * 6 + 6, 6, 60);
  const float BAIL = 4.0;

  float trapRing  = 1e9;
  float trapCross = 1e9;
  float trapPoint = 1e9;
  bool  escaped   = false;
  float smoothIt  = float(maxIt);
  vec2  zi        = z0;

  for (int oi = 0; oi < 60; oi++) {
    if (oi >= maxIt) break;
    zi = vec2(zi.x * zi.x - zi.y * zi.y, 2.0 * zi.x * zi.y) + jc;
    float mag2 = dot(zi, zi);
    float mag  = sqrt(mag2);
    trapRing   = min(trapRing,  abs(mag - 1.0));
    trapCross  = min(trapCross, min(abs(zi.x), abs(zi.y)));
    trapPoint  = min(trapPoint, mag);
    if (mag2 > BAIL * BAIL) {
      smoothIt = float(oi) + 1.0
                 - log(log(mag) / log(BAIL)) / log(2.0);
      escaped = true;
      break;
    }
  }

  // Blend trap types by complexity: ring -> cross -> point.
  float bl01 = clamp(u_complexity / 3.0 - 0.5, 0.0, 1.0);
  float bl12 = clamp(u_complexity / 3.0 - 1.5, 0.0, 1.0);
  float trap  = mix(mix(trapRing, trapCross, bl01), trapPoint, bl12);
  trap        = clamp(trap * 1.5, 0.0, 1.0);

  float tlw  = 0.045 + treble * 0.03;
  float line = 1.0 - smoothstep(0.0, tlw, trap);
  float ring = 1.0 - smoothstep(0.0, tlw * 0.5, abs(trap - 0.15));

  float depth = smoothIt / float(maxIt);
  float tcol  = (trap * 0.4 + depth * 0.3 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;
  float halo  = pow(clamp(1.0 - trap, 0.0, 1.0), 3.0) * 0.18;

  vec3 col = palette(tcol) * 0.05;
  col += palette(tcol + 0.08) * halo * 2.2;
  col += palette(tcol + 0.15) * line * 4.5;
  col += mix(palette(tcol + 0.21), vec3(1.0), 0.50) * pow(line, 2.0) * 7.0;
  col += palette(tcol + 0.27) * ring * 3.5;
  col += mix(palette(tcol + 0.33), vec3(1.0), 0.40) * pow(ring, 2.0) * 5.0;

  col *= smoothstep(1.9, 0.1, length(uv));
  return col;
}

/* ==========================================================================
 * Cell Wall — Voronoi cell-boundary gradient rendering.
 *
 * Rather than coloring each Voronoi cell by its distance to its seed (which
 * fills cells with colour), we color by the GRADIENT of the cell-distance
 * field — which is zero deep inside any cell and spikes to a maximum
 * exactly on the boundary between two cells.  This gives paper-thin glowing
 * walls with total darkness inside and outside, exactly like an insect wing,
 * a leaf vein network, or a cracked glaze.  A second Voronoi layer at 2.3x
 * finer scale adds secondary veins; their intersections multiply together
 * for a white-hot highlight at every junction.
 * ========================================================================== */
vec3 renderCellWall(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(2.0, floor(u_symmetry));
  float seg   = 6.28318530718 / folds;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float af = mod(a, seg);
  af = abs(af - seg * 0.5);
  vec2 p = vec2(cos(af), sin(af)) * r;

  float wx = snoise(p * 0.85 + vec2(t * u_speed * 0.06,  0.0));
  float wy = snoise(p * 0.85 + vec2(0.0, -t * u_speed * 0.05));
  vec2 pw = p + vec2(wx, wy) * u_warp * 0.30;

  float cellScale1 = 1.8 + u_complexity * 0.30;
  float cellScale2 = cellScale1 * 2.3;

  // Primary Voronoi: edge distance = distance to nearest boundary.
  vec2 pv1  = pw * cellScale1;
  vec2 pi1  = floor(pv1);
  vec2 pf1  = fract(pv1) - 0.5;
  float md1a = 1e9, md1b = 1e9;
  vec2 near1 = vec2(0.0);
  for (int dx1 = -1; dx1 <= 1; dx1++) {
    for (int dy1 = -1; dy1 <= 1; dy1++) {
      vec2 nb = vec2(float(dx1), float(dy1));
      vec2 h  = voronoiHash(pi1 + nb);
      h = 0.5 + 0.5 * sin(h * 6.28318 + t * u_speed * 0.30);
      vec2 diff = nb - pf1 + h;
      float d = dot(diff, diff);
      if (d < md1a) { md1b = md1a; md1a = d; near1 = h; }
      else if (d < md1b) { md1b = d; }
    }
  }
  float edge1 = sqrt(md1b) - sqrt(md1a);

  // Secondary finer Voronoi for the sub-vein network.
  vec2 pv2  = pw * cellScale2;
  vec2 pi2  = floor(pv2);
  vec2 pf2  = fract(pv2) - 0.5;
  float md2a = 1e9, md2b = 1e9;
  vec2 near2 = vec2(0.0);
  for (int dx2 = -1; dx2 <= 1; dx2++) {
    for (int dy2 = -1; dy2 <= 1; dy2++) {
      vec2 nb = vec2(float(dx2), float(dy2));
      vec2 h  = voronoiHash(pi2 + nb + vec2(17.3, 31.7));
      h = 0.5 + 0.5 * sin(h * 6.28318 + t * u_speed * 0.40 + 1.5);
      vec2 diff = nb - pf2 + h;
      float d = dot(diff, diff);
      if (d < md2a) { md2b = md2a; md2a = d; near2 = h; }
      else if (d < md2b) { md2b = d; }
    }
  }
  float edge2 = sqrt(md2b) - sqrt(md2a);

  float ww   = 0.05 + treble * 0.04;
  float wall1 = 1.0 - smoothstep(0.0, ww,        edge1);
  float wall2 = 1.0 - smoothstep(0.0, ww * 0.55, edge2);

  // Power-law steepening: pure black interior, brilliant wall.
  float shp  = 2.5 + u_complexity * 0.4;
  wall1 = pow(wall1, shp);
  wall2 = pow(wall2, shp);

  // Intersection: white-hot where both wall layers coincide.
  float xsect = wall1 * wall2 * (1.5 + bass * 1.0);

  float tcol = (near1.x * 0.4 + near2.x * 0.2 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;

  vec3 col = palette(tcol) * 0.04;
  col += palette(tcol + 0.10) * wall1 * 3.0;
  col += palette(tcol + 0.18) * wall2 * 2.2;
  col += mix(palette(tcol + 0.24), vec3(1.0), 0.52) * xsect * 6.0;
  col += palette(tcol + 0.32) * pow(wall1, 2.0) * 3.5;

  col *= smoothstep(1.9, 0.1, r);
  return col;
}

/* ==========================================================================
 * Transit Trap — Dual Julia orbit traps with adaptive transit deceleration.
 *
 * Two complementary Julia seeds (jcA and jcB) move in counter-phase orbits.
 * As they approach each other ("near transit"), an analytical time-warp function
 * smoothly decelerates the time step to 0.08x speed, dwelling on the intricate
 * interlock and magnetic filamentation between the two halves.
 * Out of transit, time fast-forwards at 3.2x speed through concentric ring traps
 * so there are no dull or empty moments.
 * ========================================================================== */
/* ==========================================================================
 * Transit Trap — Dual Julia orbit traps with plateau time-warping.
 *
 * Spends 75%+ of the cycle dwelling inside the preferred transit interlock
 * state (the glowing filigree crown), transitioning quickly between peaks
 * so you can admire, tweak, and snapshot the sweet spot without it fading.
 * ========================================================================== */
vec3 renderTransitTrap(vec2 uv, float t) {
  float bass   = u_audioBands.x;
  float treble = u_audioBands.z;

  float folds = max(1.0, floor(u_symmetry));
  float seg   = 6.28318530718 / folds;

  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float af = mod(a, seg);
  af = abs(af - seg * 0.5);
  vec2 p = vec2(cos(af), sin(af)) * r;

  // Time parameter with slow fundamental rate
  float tPhase = t * u_speed * 0.08;

  // Plateau time-warp: raising sine/cosine to power 0.28 flattens the peak,
  // making 75%+ of the animation cycle dwell right at the peak transit state!
  float s1 = sin(tPhase);
  float c1 = cos(tPhase * 0.75 + 0.4);

  float dwellS = sign(s1) * pow(abs(s1), 0.28);
  float dwellC = sign(c1) * pow(abs(c1), 0.28);

  // Twin Julia seeds positioned right at the sweet-spot parameter radius (~0.65)
  float orbR = 0.65 + 0.08 * sin(tPhase * 0.5);
  vec2 jcA = vec2(orbR * dwellC, orbR * dwellS);
  vec2 jcB = vec2(-orbR * dwellC, -orbR * dwellS);

  // Interpolated seed for Julia evaluation
  vec2 jc = mix(jcA, jcB, 0.5 + 0.35 * dwellS);

  float scale = 2.3 * (1.0 + u_warp * 0.15);
  vec2 z0 = p * scale;

  int maxIt = clamp(int(u_complexity) * 7 + 4, 4, 60);
  const float BAIL = 4.0;

  float trapPoint = 1e9;
  float trapRing = 1e9;
  float trapCross = 1e9;
  float trapBridge = 1e9;
  bool escaped = false;
  float smoothIt = float(maxIt);
  vec2 zi = z0;

  for (int oi = 0; oi < 60; oi++) {
    if (oi >= maxIt) break;
    zi = vec2(zi.x * zi.x - zi.y * zi.y, 2.0 * zi.x * zi.y) + jc;
    float mag2 = dot(zi, zi);
    float mag = sqrt(mag2);

    float dA = length(zi - jcA);
    float dB = length(zi - jcB);
    float dMin = min(dA, dB);

    // Trap 1: Point proximity to seeds
    trapPoint = min(trapPoint, dMin);

    // Trap 2: Concentric rings around seeds
    float rA = abs(dA - 0.45);
    float rB = abs(dB - 0.45);
    trapRing = min(trapRing, min(rA, rB));

    // Trap 3: Cross axes through seeds
    vec2 diffA = abs(zi - jcA);
    vec2 diffB = abs(zi - jcB);
    trapCross = min(trapCross, min(min(diffA.x, diffA.y), min(diffB.x, diffB.y)));

    // Trap 4: Connecting transit bridge beam between jcA and jcB
    vec2 ab = jcB - jcA;
    float tSeg = clamp(dot(zi - jcA, ab) / max(1e-5, dot(ab, ab)), 0.0, 1.0);
    float dBridge = length(zi - (jcA + tSeg * ab));
    trapBridge = min(trapBridge, dBridge);

    if (mag2 > BAIL * BAIL) {
      smoothIt = float(oi) + 1.0 - log(log(mag) / log(BAIL)) / log(2.0);
      escaped = true;
      break;
    }
  }

  // Combine traps: blend rings, bridge and cross traps for continuous glowing geometry
  float trapOut = mix(trapRing, trapPoint, 0.4);
  float trapIn = mix(min(trapPoint, trapBridge), trapCross, 0.3);
  
  // Dwell factor: 1.0 when at peak transit
  float dwellFactor = abs(dwellS * dwellC);
  float trapFinal = mix(trapOut, trapIn, dwellFactor);
  trapFinal = clamp(trapFinal * 1.5, 0.0, 1.0);

  // Line width: sharp glowing neon edges matching the user's screenshot
  float lw = (0.042 + treble * 0.03) * (0.75 + 0.25 * (1.0 - dwellFactor));
  float line = 1.0 - smoothstep(0.0, lw, trapFinal);
  float coreLine = 1.0 - smoothstep(0.0, lw * 0.35, trapFinal);

  // Flare multiplier during peak transit
  float transitFlare = dwellFactor * (1.5 + bass * 1.8);

  float depth = smoothIt / float(maxIt);
  float tcol = (trapFinal * 0.4 + depth * 0.3 + u_flowPhase + u_audioLevel * 0.2) * u_colorDensity;
  float halo = pow(clamp(1.0 - trapFinal, 0.0, 1.0), 2.8) * (0.22 + 0.35 * transitFlare);

  vec3 col = palette(tcol) * 0.05;
  col += palette(tcol + 0.08) * halo * 2.5;
  col += palette(tcol + 0.15) * line * (3.5 + 2.5 * dwellFactor);
  col += mix(palette(tcol + 0.22), vec3(1.0), 0.55 + 0.3 * transitFlare)
         * pow(line, 2.0) * (6.0 + 8.0 * transitFlare);
  col += mix(palette(tcol + 0.30), vec3(1.0), 0.82)
         * pow(coreLine, 3.0) * (8.0 + 12.0 * transitFlare);

  col *= smoothstep(1.9, 0.1, r);
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
  else if (u_vmode == ${MODE_SPIRAL}) return renderSpiral(uv, u_time);
  else if (u_vmode == ${MODE_DROSTE}) return renderDroste(uv, u_time);
  else if (u_vmode == ${MODE_PHYLLOTAXIS}) return renderPhyllotaxis(uv, u_time);
  else if (u_vmode == ${MODE_DOMAIN}) return renderDomain(uv, u_time);
  else if (u_vmode == ${MODE_VORONOI}) return renderVoronoi(uv, u_time);
  else if (u_vmode == ${MODE_ATTRACTOR}) return renderAttractor(uv, u_time);
  else if (u_vmode == ${MODE_RORSCHACH}) return renderRorschach(uv, u_time);
  else if (u_vmode == ${MODE_SIERPINSKI}) return renderSierpinski(uv, u_time);
  else if (u_vmode == ${MODE_LIGHTNING}) return renderLightning(uv, u_time);
  else if (u_vmode == ${MODE_MULTIPLY_RIDGE}) return renderMultiplyRidge(uv, u_time);
  else if (u_vmode == ${MODE_ISOCONTOUR}) return renderIsoContour(uv, u_time);
  else if (u_vmode == ${MODE_CURL_FLOW}) return renderCurlFlow(uv, u_time);
  else if (u_vmode == ${MODE_REACTION_WEB}) return renderReactionWeb(uv, u_time);
  else if (u_vmode == ${MODE_ORBIT_TRAP}) return renderOrbitTrap(uv, u_time);
  else if (u_vmode == ${MODE_CELL_WALL}) return renderCellWall(uv, u_time);
  else return renderTransitTrap(uv, u_time);
}

void main() {
  fragColor = vec4(sampleVisual(gl_FragCoord.xy), 1.0);
}`;
