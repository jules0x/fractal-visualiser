# AETHER

A fractal explorer that keeps going after float64 runs out.

Zoom depth in a conventional GPU renderer stops around 10<sup>13</sup>–10<sup>14</sup>,
where the coordinates of neighbouring pixels stop being distinguishable and the
image goes to mush. AETHER computes one arbitrary-precision reference orbit per
frame on the CPU and lets the GPU track only each pixel's small deviation from
it, which keeps every per-pixel number inside ordinary float32 no matter how
deep the view goes. The engine is verified against exact arbitrary-precision
ground truth at 10<sup>250</sup>.

## Running it

Node 22 or newer. With [fnm](https://github.com/Schniz/fnm) the version pins
itself from `.node-version`:

```bash
fnm use --install-if-missing
npm install
npm run dev      # local dev server
npm test         # engine verification, no build step needed
npm run build    # type-check, then a static bundle in dist/
```

`npm run build` produces a plain static bundle. The workflow in
`.github/workflows/deploy.yml` publishes it to GitHub Pages on every push to
`main`; enable Pages with "GitHub Actions" as the source and it needs nothing
else.

## How the deep zoom works

**Reference orbit, on the CPU.** `src/core/fixed.ts` implements binary
fixed-point arithmetic over `BigInt`: a value is an integer mantissa with an
implicit scale of 2<sup>-p</sup>, and `p` is derived from the current zoom depth
rather than fixed. `src/core/reference.ts` iterates a single orbit — the view
centre — at that precision. It is one orbit per frame, not one per pixel, so
even 400-bit arithmetic is cheap: about 5 ms for 8000 iterations, which the HUD
shows live.

**Delta iteration, on the GPU.** Writing `z = Z + d` for the reference orbit `Z`
and a pixel's deviation `d` turns the Mandelbrot recurrence into

```
d ← 2·Z·d + d² + c
```

`d` is tiny, so it survives in float32 where the absolute coordinate would not.
The reference orbit is uploaded as an `RG32F` texture and read with
`texelFetch`.

**Scaled exponents.** At 10<sup>100</sup> the starting `d` is around
2<sup>-333</sup>, well under float32's smallest subnormal. So `d` is carried as
`D · 2^k` — a float32 mantissa kept near 1 and an integer exponent — and
renormalised whenever `D` drifts. Every power-of-two factor in the recurrence
then stays inside float32's exponent range, and terms that genuinely are
negligible underflow to zero, which is the right answer anyway.

**Rebasing.** When `|z|` falls below `|d|` the delta loses all its significant
digits; this is what produces the blotchy "glitch" artefacts perturbation
renderers are known for. Following Zhuoran's method, the iterate is re-expressed
against `Z₀` and the reference index restarts. `z` itself is untouched — only
its decomposition changes — so the fix costs nothing and needs no separate
glitch-detection pass.

**Bailout at 256, not 2.** The textbook escape radius makes the smooth-colouring
term inaccurate and puts the escape test right where float32 cannot decide it.

## Newton, and why its delta is multiplicative

Newton's method on `z^p − 1` rearranges to `N(z) = A z + B z^-q` with
`A = 1 − a/p`, `B = a/p`, `q = p − 1`: one linear term and one pole, which is
the form the perturbation algebra wants. Working the delta through gives

```
d' = N(Z + d) − N(Z) = d · [ A − B·P(e) / ( Z^(q+1) (1 + e·P) ) ],   e = d/Z
```

where `P(e) = Σ C(q,k) e^(k-1)` is what remains of `(1+e)^q − 1` once the factor
of `e` is taken out by hand. That is the whole trick: computing `(Z+d)^q − Z^q`
numerically would subtract two nearly equal numbers of size 1 to get an answer of
size 10<sup>-200</sup>, and doing the cancellation algebraically instead means
no step ever loses a digit. As `e → 0` the bracket collapses to `N'(Z)`, so the
linearised and exact regimes are one expression with no crossover to tune.

Two things fall out of the delta being *multiplicative* rather than additive.
It cannot be annihilated the way a Mandelbrot delta is when `|z|` drops below
`|d|`, so **Newton needs no rebasing at all**. And the reference orbit converges,
so it is short — usually fifteen or twenty points before it lands on a root and
stops, after which the shader simply holds that point.

The one thing this arrangement is fussy about is where the reference *starts*.
`N` has no value at `z = 0`, so a view centred on the origin — which every
Newton preset is — kills the orbit at step zero and stops every pixel on its
first iteration. The reference is only a helper, though, and any nearby point
does the job equally well, so a pole fault re-seeds it half a screen off centre
and tells the shader where `d` is now measured from.

Everything the shader needs from `Z` — `Z^-(q+1)` and `1/Z` — arrives
precomputed in the reference texture. Newton never rebases, so on iteration `i`
every pixel in the frame is at reference index `min(i, last)`, the *same* one:
that work is one answer per iteration, not one per pixel. It is what keeps the
inner loop free of transcendentals, and it also removes an overflow, since an
orbit thrown out to `|Z| = 10⁵` has a `Z¹²` float32 cannot hold but a reciprocal
that merely underflows to the zero which is the right answer anyway.

On the CPU side the same quantity has the opposite hazard. Fixed point holds
*absolute* precision, so `|Z|²` vanishes while `Z` is still well resolved — at
91 bits, `|Z| = 10⁻⁶` leaves `Z⁵` with no significant bits at all. So the
reciprocal is taken first and raised to the power second, and it is computed by
cancelling the scale algebraically, `(x << 2p) / (x² + y²)`, rather than
dividing by a `norm2` that has already collapsed.

Past `|d| = |Z|/2` the series is the wrong tool — nothing cancels there any more,
and its top term goes as `e^(q-1)`, which for degree twelve overflows float32
outright. Beyond that threshold the two pole terms are differenced directly.
Powers of `Z` and `z` also carry their magnitude as an integer exponent rather
than in the float, because an orbit that grazes the pole is thrown out to `|Z|`
in the hundred thousands on the next step, and `|Z|^12` of that is nowhere near
representable.

## What is not covered

- **Non-quadratic Mandelbrot** (`z^p + c`, p ≠ 2) has no perturbation
  formulation here and falls back to a double-single shader path with the usual
  ~10<sup>13</sup> ceiling. The readout says which path is live.
- **Newton at high degree gives up a few boundary pixels.** The Julia set of
  `z^3 − 1` pushes neighbouring points apart by roughly a factor of two per
  iteration; by `z^12 − 1` it is nearer 1.3, so a pixel spends four times as
  long near the boundary and float32's 10<sup>-7</sup> accumulates over all of
  it. Around 5% of boundary pixels can come down on the wrong side of a basin.
  This does not grow with depth — it is the same at 10<sup>3</sup> as at
  10<sup>40</sup> — and degrees 3 and 4 are exact.
- **Newton at depth wants a large iteration budget.** A delta of
  10<sup>-250</sup> has to be amplified back to order 1 before a pixel can fall
  into a different basin from the reference, which takes on the order of a
  thousand iterations. The old float32 path converged in thirty because it could
  not see anything that small. The neighbourhood of the pole is worse again:
  `N` throws a point at 10<sup>-6</sup> out to 10<sup>26</sup>, and it comes
  back only by a factor of `A` a time — some three hundred iterations before
  anything has settled. Zoom onto the origin with a budget of ninety and you get
  a smooth flower, which is the picture of an orbit still in flight rather than
  a rendering fault.
- **Escape values drift on the busiest pixels.** Deltas are float32, so after
  thousands of chaotic iterations the *value* can be off by a percent or two —
  the error tracks how often a pixel had to rebase. Which side of the set a
  pixel lands on is always right, so the shape is correct and the shading of a
  few high-iteration pixels is approximate. Fixing it means double-single
  deltas in the shader, at a large cost in frame rate.

## Sharing a view

"Copy link" packs the whole state into the URL fragment. The centre travels as a
decimal **string** rather than a float — at depth a float64 no longer separates
neighbouring views, so a link built from one would quietly land somewhere else.
Nothing is sent to a server; the fragment never leaves the browser.

## Presets

Every built-in location is documented, with its source in the note that appears
when you pick it. Mandelbrot coordinates come from Robert Munafo's
[Mu-Ency](http://www.mrob.com/pub/muency.html), which names each feature and
gives its exact centre and radius — including the period-1312 island at the end
of the Seahorse Valley descent, at radius 1.172e-17, which is past what float64
can address. Julia constants are the classical named sets as given by
[MathWorld](https://mathworld.wolfram.com/JuliaSet.html). Newton entries are the
canonical `z^p − 1` root cases and the standard relaxed variants.

## Palettes

Ten ramps — six originals plus Rainbow, Ultra Fractal, Fire and Electric Blue —
each four OKLCH stops interpolated in OKLCH and looping back to the
first, baked to a 1024-entry lookup texture at load. Interpolating perceptually
rather than in sRGB is what stops the midpoints sliding through grey, and the
loop is what lets the flow animation scroll forever without a seam. Colours
outside sRGB have their chroma reduced with hue and lightness held, rather than
being clipped per channel.

## Tests

`npm test` runs the engine verification — no browser, no build.

The load-bearing one is `test/perturbation.test.ts`, which re-implements the
fragment shader's inner loop in JavaScript with `Math.fround` on every operation
so the arithmetic matches float32 exactly, including underflow, then compares
against ground truth computed the slow exact way in `BigInt`. It runs at
10<sup>17</sup>, 10<sup>40</sup>, 10<sup>100</sup> and 10<sup>250</sup>, and
separately over a genuinely fractal deep view where dwells run to five figures.
If the delta recurrence, the rebasing rule or the exponent bookkeeping in
`shaders.ts` is wrong, it fails.

`test/newton.test.ts` does the same for Newton, comparing both things the shader
renders — which root a pixel lands on and how long it took — against exact
orbits. Its centres are found by bisecting until two basins straddle the view,
so the frame is guaranteed to contain a boundary rather than a flat wash;
otherwise agreement would prove nothing.

Elsewhere: the fixed-point layer is checked against Munafo's identity that
`dwell(-3/4 + 10⁻ⁿi)` reproduces the digits of π; the camera is checked by
confirming that zooming pins the complex point under the cursor at any depth;
palettes are checked for gamut, seamlessness and the sRGB primaries.

## Layout

```
src/core/      fixed-point arithmetic, reference orbits, camera
src/render/    GLSL, WebGL2 plumbing, OKLCH palettes
src/state/     presets, URL state, saved views
src/ui/        two-tier control panel, pointer and keyboard input
test/          engine verification
```

## Driving it

The keys are the ones games already taught you, and there are only six:

| | |
| --- | --- |
| `W` `A` `S` `D` | move — or drag the canvas |
| `Q` `E` | zoom out / in — or scroll |
| `shift` | faster |
| `alt` | finer |
| `space` | stop |
| `H` | hide the panel |

They are printed at the bottom of the panel, so there is nothing to memorise.

**Movement keys are held, not tapped**, and they run alongside a zoom rather
than cancelling it — you steer while descending. Dragging the canvas doesn't
interrupt a descent either.

**Scrolling adds thrust, not a fixed step.** A flick launches a descent that
coasts down over a couple of seconds; keep scrolling and it accelerates, up to a
cap. Holding `Q` or `E` gives a steady speed instead.

**Zoom converges on the pointer by default**, which is what maps have trained
everyone to expect. Switch it to the centre crosshair in the panel if you'd
rather keep the pointer free — that also gets steadier at depth, where a small
hand movement covers a lot of ground. The preference is stored separately from
view state, so a shared link never changes how someone else's controls behave.

### Shape controls at depth

The Julia constant, the exponent and Newton's relaxation use sliders whose track
covers a *window* around the current value rather than the whole range, and
which recentre when you let go. An absolute slider has a fixed resolution — a
few thousand steps across its track — and sixty orders of magnitude down the
structure responds to changes finer than one of those steps, so the control can
only jump past everything worth seeing. The window narrows with depth, keeping
one sweep of the track worth roughly the same amount of visible change at every
scale.

## Frame rate

While the view is moving it renders at a reduced backing-store scale and the
browser scales up; the moment it settles it snaps to full resolution. The scale
is a closed loop on measured frame rate, floored at a quarter. Fragment cost
goes with pixel count, so halving the scale quarters the work — and a soft image
that keeps up beats a sharp one that stutters. Supersampling is skipped entirely
while moving, since it is wasted on an image that is already soft.
