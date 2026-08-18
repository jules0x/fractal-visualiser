# Aether Rebuild — Plan

Locked in from our discussion: max feasible zoom depth without tanking performance, two-tier control panel, no strong aesthetic direction (keep refining current cinematic look), presets researched and curated by me.

## 1. Deep zoom (the core fix)

Current pixelation ceiling (~10^13–10^14) is because the shader emulates precision with two float32s (double-single, ~46 bits of mantissa) — that runs out fast. The fix isn't more precision bits, it's a different algorithm:

- **CPU**: compute one reference orbit per interaction using BigInt-based arbitrary-precision fixed-point arithmetic. Precision (bits) scales automatically with zoom depth — no hard ceiling.
- **GPU**: each pixel only computes its small *delta* from that reference orbit (perturbation theory), which stays within normal float32 range regardless of zoom depth. This is the same technique tools like Kalles Fraktaler use for zooms past 10^1000.
- **Rebasing**: when a pixel's delta grows too close to the reference orbit's magnitude, swap in a fresh nearby reference orbit. Keeps things stable without building a full glitch-detection/correction pass (that's a bigger project — skipping it for now per "don't overload it," can revisit later if artifacts bother you).
- Net effect: reference-orbit computation is cheap (once per frame, not per pixel) even at high precision, so this should comfortably reach 10^100+ zoom while staying interactive.

## 2. Shareable state via URL

- Center coordinates become arbitrary-precision (BigInt/decimal strings) at depth, so the URL encodes them as strings, not floats — plus zoom (exponent+mantissa), mode, iterations, palette, and mode params, base64-packed into the URL.
- Opening a link deserializes straight into the engine and updates every control to match.
- "Copy Link" becomes the primary way to share a view; a small "My Presets" (local, fewer than today) stays for personal saves.

## 3. UI — two-tier panel

- **Always-visible compact bar**: mode switch, live zoom/coordinate readout, palette swatches, preset picker, copy-link button.
- **Collapsible "Advanced" drawer** (closed by default): iterations, exponent/relaxation, color density, flow speed, auto-zoom.
- Auto-zoom re-centers continuously on the live mouse position instead of a fixed point set when you started dragging.
- All drag/slider inputs scale sensitivity down as zoom deepens (roughly dividing the raw input delta by log10(zoom)), so fine control doesn't get lost once you're deep in.

## 4. Presets

Several current names look invented rather than sourced (e.g. "Frost Crystal Nebula," "Feathered Dragon") — I'll research and swap in a tight set (~6 per mode) of real, documented locations: known Mandelbrot mini-sets and valleys, standard Julia constants, canonical Newton root cases. Will show you the list with sources before finalizing.

## 5. Palettes

Current palettes use a raw cosine-gradient trick, which can look muddy. Below are 10 fresh candidates, each a perceptually-smooth OKLCH ramp (5 stops, first ≈ last so it loops seamlessly for the flow-animation feature — no muddy dip through gray at the wrap point). Mark any you want cut; the rest carry forward into the rebuild as-is, OKLCH stops included so they can go straight into code.

### Aurora Violet
indigo → violet → pink → lavender
`linear-gradient(90deg, #11004c 0%, #6928b0 25%, #d469cc 50%, #d8bfff 75%, #11004c 100%)`
`oklch(0.18 0.14 280) | oklch(0.45 0.20 300) | oklch(0.68 0.18 330) | oklch(0.85 0.10 300) | oklch(0.18 0.14 280)`

### Solar Flare
maroon → orange → gold → pale yellow
`linear-gradient(90deg, #330000 0%, #990000 25%, #dc7f00 50%, #f8dc90 75%, #330000 100%)`
`oklch(0.16 0.13 25) | oklch(0.42 0.19 40) | oklch(0.68 0.18 70) | oklch(0.90 0.10 90) | oklch(0.16 0.13 25)`

### Abyssal Teal
near-black navy → teal → cyan → white
`linear-gradient(90deg, #00062d 0%, #005871 25%, #00abad 50%, #b6f1f4 75%, #00062d 100%)`
`oklch(0.14 0.10 240) | oklch(0.40 0.14 210) | oklch(0.65 0.16 195) | oklch(0.92 0.06 200) | oklch(0.14 0.10 240)`

### Neon Cyber
magenta → purple → cyan → white
`linear-gradient(90deg, #3d003e 0%, #6407af 25%, #0087f8 50%, #a1ebff 75%, #3d003e 100%)`
`oklch(0.20 0.20 330) | oklch(0.42 0.22 300) | oklch(0.62 0.20 250) | oklch(0.90 0.08 220) | oklch(0.20 0.20 330)`

### Toxic Bloom
near-black green → lime → magenta → hot pink
`linear-gradient(90deg, #001400 0%, #178b00 25%, #c2009c 50%, #ff6fc0 75%, #001400 100%)`
`oklch(0.15 0.10 150) | oklch(0.55 0.24 135) | oklch(0.55 0.24 340) | oklch(0.75 0.20 350) | oklch(0.15 0.10 150)`

### Royal Gilt
obsidian → bronze → gold → cream
`linear-gradient(90deg, #180600 0%, #6b3a00 25%, #c09000 50%, #f1e4bf 75%, #180600 100%)`
`oklch(0.15 0.05 70) | oklch(0.40 0.10 65) | oklch(0.68 0.14 85) | oklch(0.92 0.05 90) | oklch(0.15 0.05 70)`

### Glacier
deep navy → blue → ice cyan → white
`linear-gradient(90deg, #000437 0%, #005098 25%, #18b1cd 50%, #d9f5fa 75%, #000437 100%)`
`oklch(0.16 0.10 260) | oklch(0.42 0.15 245) | oklch(0.70 0.12 215) | oklch(0.95 0.03 210) | oklch(0.16 0.10 260)`

### Ember Ash
charcoal → ember red → amber → pale peach
`linear-gradient(90deg, #150a08 0%, #890014 25%, #db5800 50%, #ffcca2 75%, #150a08 100%)`
`oklch(0.16 0.02 30) | oklch(0.38 0.18 20) | oklch(0.62 0.19 50) | oklch(0.88 0.08 60) | oklch(0.16 0.02 30)`

### Deep Ocean
black → deep blue → teal → seafoam
`linear-gradient(90deg, #000313 0%, #00386e 25%, #008994 50%, #61d7b2 75%, #000313 100%)`
`oklch(0.10 0.05 250) | oklch(0.32 0.14 235) | oklch(0.55 0.15 200) | oklch(0.80 0.12 170) | oklch(0.10 0.05 250)`

### Orchid Dusk
plum → magenta → coral → peach
`linear-gradient(90deg, #2e003b 0%, #9c0064 25%, #ed5350 50%, #ffbd8e 75%, #2e003b 100%)`
`oklch(0.20 0.14 320) | oklch(0.45 0.20 350) | oklch(0.65 0.19 25) | oklch(0.85 0.10 55) | oklch(0.20 0.14 320)`

## 6. Stack

Moving from the single `app.js` to a small Vite + TypeScript setup — still ships as a static bundle to GitHub Pages, no server, no dedicated app, just easier to maintain the BigInt/perturbation math than one 1100-line file. Flagging this as a default; will proceed unless you'd rather stay single-file.

## Sequencing

1. Strip dead code from current `app.js` (quick, standalone — can do independent of everything else)
2. Scaffold Vite project, port existing renderer as a working baseline
3. Build perturbation engine + BigInt reference orbit, replace double-single shader path
4. URL state encode/decode + copy-link UI
5. Two-tier panel rebuild + adaptive input sensitivity + mouse-anchored auto-zoom
6. Research and swap in curated real presets
7. New palette set
8. Polish pass, deploy to GitHub Pages

## Still open (will decide by feel, will show you before locking in)

- Exact palette and preset lists
- Precise adaptive-sensitivity curve
