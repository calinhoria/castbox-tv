# Proposed components — specification and engine notes

Status: **A1–A2 and `terrain` implemented** — see [Implemented](#implemented).
The rest is still design only. Section 0 is shared conventions; A is buildable
with the ops that exist today; B needs new engine state; C needs renderer/op
changes; D is cross-cutting engine work.

## Implemented

| component | ops used | notes |
|---|---|---|
| `dotmatrix` | `circle`, `rect` | Dim grid first (one command per cell), then lit cells painted over it. Cells are square — the fitted cell is the smaller of the two pitches — and the grid is centred. `cols * rows` is clamped to 2000 against the global command budget. |
| `rays` | `line`, `gradientLine`, `polygon` | One command per spoke: `line` plain, `gradientLine` when `gradient` is set (a 3-point polyline so the along-spoke gradient has a bbox, `gradientAngle` following the spoke), `polygon` triangle when `taper > 0`. Reuses `mirror`/`arcStart`/`pulseAmount` exactly as `radial_line` does. |
| `terrain` | `polygon`, `clipPush`, `clipPop` | 3D spectrum mountains over a shared history ring buffer. One stroked polyline per row (72 rows = 72 commands). Yaw → pitch → `1/(z+d)` perspective; rows sorted by post-rotation depth and drawn back to front, because yaw past 90° flips their order. |

`terrain` ships as its own component rather than B1's "Perspective mesh" style,
and it consumes the shared history buffer B1/B2 were going to need: the engine
owns a 128-row ring of raw `kBands`-wide frames, advanced once per frame at the
fastest `rowIntervalMs` any terrain asks for, and each component resamples it to
its own `terrainBands` on read. So a future `waterfall` or `trail` can share the
same buffer rather than owning a second one.

Four deviations from the draft, all forced by the engine:

- **`rows` and `bands` are registered as `terrainRows`/`terrainBands`.** `rows`
  already belongs to `dotmatrix`; prop ids are global, so the spec's names would
  have collided silently — `dotmatrix` would have read terrain's row count.
- **The budget is the point pool, not 20,000.** `kMaxPoints` is 8192, and
  `pushPoint()` *silently drops* overflow, which would shear the geometry with no
  error anywhere. Terrain clamps `rows` (then `bands`) so `rows * (bands + 2)`
  fits, and the test asserts the clamp rather than trusting it. The spec's
  128x192 with occlusion asks for 49,152 points.
- **`focal` is clamped** so a 20° FOV cannot make `tan(fov/2)` collapse and blow
  the projection up.
- **`avoidEdgeOn` scales the yaw rather than the speed.** Easing the spin rate
  near 90° would need a stateful speed integrator; multiplying the angle itself
  is one line and still passes through quickly.

Two smaller judgement calls: the beat impulse detects a rising edge on
`beatPulse` rather than adding new engine state, and rotation freezes on
`{playing} == 0` while the camera stays visible, as specified.

The prop lists follow the `SCHEMAS` conventions in `js/presets.js`, so each can
be pasted in with little rewriting. See [`PRESET_SPEC.md`](PRESET_SPEC.md) for
the format these produce.

## Corrections to the original draft

Checked against `engine/src/vze.cpp` and `js/renderer.js`. Three things in the
first draft were assumptions that turned out to be wrong:

1. **Budget.** There is no per-component 2,048-record cap. The engine has two
   *global* per-frame caps: `kMaxCmds = 20000` command records and
   `kMaxPoints = 8192` points. `pushCmd()` and `pushPoint()` return null/void
   when full, so every emit loop must check and `break`. A component that
   ignores this silently truncates the frame rather than throwing — which is
   exactly how the peak caps got buried earlier. Budget per component as
   *points* mostly, since polygon-heavy work shares one pool.

2. **`IMAGE` rotation cannot use spare field `P4`.** For the `image` op the
   fields are already fully committed: `P0` fit, `P1` cornerRadius, `P2` tint,
   `P3` blur, `P4` **flipX**, `P5` **flipY**, `ROLE` circle mask. `P4` is not
   spare — it is consumed by `image`, `cover`, `orb`, `radial_line` and the
   `progress` thumb. Vinyl (C1) needs a **new op** (e.g. `imageRot` carrying a
   rotation, or a widened stride) plus a renderer change on both backends.

3. **The op set is exactly 13**, and nothing rotates or captures:

   ```
   clear  rect  gradientRect  line  text  image  clipPush
   clipPop  circle  gradientLine  arc  polygon  radialGlow
   ```

   So `LAYER_BEGIN` / `LAYER_END` / `WEDGE_BLIT` (C2) are genuinely new, as is
   any rotation. `clipPush`/`clipPop` *do* exist, so the lyrics wipe (B3) is
   buildable as written.

Two overlaps worth deciding before we build, to avoid two ways of doing one
thing:

- **A6 `tunnel` vs `particles` mode 5 (Tunnel).** The particles component
  already has a tunnel kind with `speed`, `twist`-adjacent motion and
  `beatBoost`. A6 is richer (ring recycling, `depthCurve`, `fovKick`) but we
  should either upgrade the particle mode or add `tunnel` and leave particles
  alone — not both.
- **A1 `dotmatrix` vs `spectrum` `segmentShape`.** `segmentShape: 1` is already
  an LED dot grid with per-row colouring. `dotmatrix` differs mainly in being
  square-aware (`cols × rows` fitted) and having a dim "off" cell grid. Cheaper
  path: extend `spectrum` with `offColor`/`offOpacity` rather than adding a
  component.

Also note A1's peak caps inherit the fix we just made: caps are clamped against
the *drawn* tip (quantised to whole cells), which is always above the continuous
band value.

---

## 0. Shared conventions

- **Geometry:** every component takes the standard `geometry()` props (`x`,
  `y`, `w`, `h`, `opacity`) in 0–1 surface coordinates.
- **Colors:** every color prop accepts `{role}` tokens and hex values. The
  standard `colorProps` (`color`, `color2`, `gradient`, `gradientAngle`, `glow`)
  apply unless stated otherwise.
- **Response props:** `gain`, `smoothing` (attack) and `decay` mean the same as
  on `spectrum`. Defaults are 1.15, 0.55 and 0.82 unless stated.
- **Randomness:** any component with randomness gets `seed` (int, 0–9999,
  default 1). Output must be a pure function of `(seed, time, audio)`, so a
  preset looks the same on web and Android. `seed` does not exist yet — it needs
  registering in `kPropNames`.
- **Budget:** stay inside the global 20,000-command / 8,192-point caps. Check
  every `pushCmd`/`pushPoint` return and `break` out; clamp silently, never
  throw.
- **Prop format below:** `key` (min–max, default). Selects list their options in
  order, first option = value 0.
- **New props** must also be registered with `vze_prop_id`. `VizEngine.load()`
  cache-busts the wasm, so stale builds will not hide them.

---

## A. Buildable with existing ops

### A1. `dotmatrix`: LED grid equalizer

**Purpose:** a grid of lit and dim cells, one column per band, rows lighting from
the bottom.

| prop | range | default | notes |
|---|---|---|---|
| `cols` | 4–96 | 32 | columns = bands |
| `rows` | 2–48 | 16 | |
| `cellShape` | select | 0 | Circle, Square, Rounded square |
| `gap` | 0–0.8 | 0.2 | |
| `color` | colour | | bottom of the ramp |
| `color2` | colour | | top of the ramp, per row |
| `dimColor` | colour | `{text}` | unlit cells |
| `dimOpacity` | 0–0.5 | 0.07 | |
| `glow` | 0–30 | | lit cells only |
| `gain` `smoothing` `decay` | | 1.15 / 0.55 / 0.82 | standard |
| `logScale` | bool | true | |
| `bandStart` `bandEnd` | 0–1 | 0 / 1 | |
| `quantize` | bool | true | rows snap to whole cells |
| `peaks` | bool | false | |
| `peakFall` | 0–4 | 1.1 | |
| `peakColor` | colour | `#ffffff` | |

**Behavior:** each column's level is a band value in 0–1 and lights
`round(level * rows)` cells. Cells are square when `w/cols ≈ h/rows`; the fitted
cell size takes the smaller of the two.

**Ops:** `circle` or `rect`. Clamp `cols * rows ≤ 2000` *and* check the command
budget, because the dim grid plus the lit grid plus caps all come out of the
same 20,000.

**Seed:** `{ dimOpacity: 0.07, color: '#22e1ff', color2: '#ff2d95' }`

### A2. `rays`: sunburst

**Purpose:** spokes radiating from a centre, length driven by the spectrum. The
open counterpart to `radial_line`.

| prop | range | default |
|---|---|---|
| `count` | 8–360 | 96 |
| `innerRadius` | 0–0.95 | 0.25 |
| `length` | 0.02–1 | 0.5 |
| `strokeWidth` | 0.001–0.03 | 0.004 |
| `taper` | 0–1 | 0 (0 = uniform, 1 = tapers to a point) |
| `spin` | −2–2 rev/s | 0.05 |
| `spinBeat` | 0–1 | 0.3 (extra angular velocity on beat) |
| `mirror` | bool | false |
| `arcStart` | 0–360 | 0 |
| `arcSpan` | 30–360 | 360 |
| `pulseAmount` | 0–0.9 | 0.08 (scales inner radius on beat) |

Plus the standard colour and response props: `color` inner → `color2` outer when
`gradient` is set.

**Behavior:** band index maps to angle; `mirror` folds it about the vertical
axis exactly as `radial_line` does. Centre is the box centre, radius
`min(w,h)/2`. All of `mirror`, `arcStart`, `pulseAmount` already exist as props
on `cover`/`radial_line`/`orb`, so the naming is consistent.

**Ops:** `line`, or `polygon` when `taper > 0`.

### A4. `vu`: analogue needle meter

| prop | range | default |
|---|---|---|
| `source` | select | 0 — RMS, Peak, Bass, Mid, Treble |
| `arcSpan` | 60–180° | 100 |
| `ticks` | 5–31 | 11 |
| `majorEvery` | 1–10 | 5 |
| `minDb` | −60–−10 | −40 |
| `maxDb` | 0–6 | 3 |
| `redFrom` | 0–1 | 0.75 |
| `attackMs` | 10–1000 | 300 |
| `releaseMs` | 10–1000 | 300 |
| `overshoot` | 0–0.3 | 0.08 |
| `faceColor` | colour | `{surface}` |
| `tickColor` | colour | `{text}` |
| `redColor` | colour | |
| `needleColor` | colour | `{accent}` |
| `needleWidth` `pivotSize` | | |
| `showNumbers` `bezel` | bool | |

**Behavior:** level → dB, clamped, mapped linearly across the arc. Needle uses a
one-pole filter with separate attack and release, plus a small overshoot on
rises.

**Ops:** `arc` (face, bezel, red zone), `line` (ticks, needle), `circle`
(pivot), `text` (numbers).

*Renderer note:* the `arc` op strokes an **ellipse** at `(x, y, w, h)`, so a
circular sweep needs `w == h`; anything else comes out elliptical. The
`meter` component already covers linear and ring meters — `vu` earns its place
through dB ballistics and the needle, not through the scale.

### A5. `bolts`: lightning

| prop | range | default |
|---|---|---|
| `trigger` | select | 0 — Beat, Bass, Treble, RMS |
| `threshold` | 0–1 | 0.6 |
| `cooldownMs` | 50–1000 | 150 |
| `maxBolts` | 1–8 | 3 |
| `origin` | select | 0 — Top, Bottom, Left, Right, Center, Random |
| `segments` | 6–60 | 24 |
| `jitter` | 0–0.3 | 0.08 |
| `branches` | 0–6 | 2 |
| `branchChance` | 0–1 | 0.4 |
| `spread` | 0–1 | 0.3 |
| `lifetimeMs` | 80–800 | 250 |
| `flicker` | 0–1 | 0.5 |
| `afterglow` | 0–1 | 0.4 |
| `seed` | 0–9999 | 1 |
| `strokeWidth` `color` `color2` | | core, halo |
| `glow` | 0–30 | 18 |

**Behavior:** an onset spawns a polyline from `origin` toward a seeded target;
each midpoint is displaced perpendicular to the path by a decreasing amount
(midpoint displacement). Brightness flickers per frame and fades over the
lifetime.

**Ops:** `line` polylines, one per bolt and branch. Animate alpha over the
lifetime — the op carries colour alpha already, so no extra field is needed.

### A6. `tunnel`: wireframe warp

> Overlaps `particles` mode 5 (Tunnel) — see the overlap note above.

| prop | range | default |
|---|---|---|
| `sides` | 3–16 | 6 |
| `rings` | 4–40 | 18 |
| `depthCurve` | 0.5–4 | 2 (perspective exponent) |
| `speed` | −4–4 | 1 |
| `speedFromRms` | 0–3 | 1 |
| `twist` | −1–1 | 0.15 (turns across full depth) |
| `twistBeat` | 0–1 | 0.2 |
| `bandMod` | 0–1 | 0.4 (ring radius follows band energy) |
| `fovKick` | 0–0.5 | 0.15 (zoom burst on beat) |
| `fillRings` | bool | false |
| `strokeWidth` `color` `color2` `glow` `fade` | | 0.7 fade, near → far |

**Behavior:** rings spawn at depth 0 and advance toward the viewer. Screen scale
is `1 / depth^curve`, rings recycle as they pass, and the `bandMod` band index
comes from spawn order.

**Ops:** `polygon` per ring (stroked), plus optional `line` spokes. 40 rings ×
16 sides = 640 points, fine.

### A7. `lissajous`: XY scope

| prop | range | default |
|---|---|---|
| `delayMs` | 0.1–5 | 0.7 |
| `rotate45` | bool | true |
| `points` | 128–2048 | 1024 |
| `autoGain` | bool | true |
| `persistence` | 0–0.98 | 0.85 |
| `trailFrames` | 1–12 | 6 |
| `strokeWidth` `gain` `color` `color2` `glow` | | newest → oldest |

**Behavior:** with a mono feed, `x = s[n]` and `y = s[n − delay]` with
`delay = round(delayMs * sampleRate / 1000)`. Older frames are re-drawn at alpha
`persistence^age`. If stereo lands (D3), the preset switches to true L/R with
no delay.

**Ops:** `line` polyline plus the previous N frames; shares B2's short window
history.

---

## B. Needs new engine state

### B1. `waterfall`: spectrogram

**Engine state:** ring buffer `hist[rows][bands]`, a new row pushed every
`rowIntervalMs`. API: `vze_hist_config(rows, bands)`, `vze_hist_row(i)`.

| prop | range | default |
|---|---|---|
| `style` | select | 0 — Heatmap, Ridgelines, Perspective mesh |
| `rows` | 16–128 | 48 |
| `bands` | 16–128 | 64 |
| `rowIntervalMs` | 10–200 | 33 |
| `flow` | select | 0 — Up, Down, Left, Right |
| `heightScale` | 0–1 | 0.4 (ridgelines, mesh) |
| `pitch` | 0–70° | 35 (mesh only) |
| `rampMode` | select | 0 — Palette ramp, Two-color |
| `fillBelow` | bool | true |
| `gain` | | 1.15 |
| `floorDb` | −90–−30 | −70 |
| `glow` | 0–30 | |

Palette ramp is `bg → primary → secondary → accent` (the same six-stop ramp
`spectrum` gradientMode 2 already walks); `color`/`color2` are used for
Two-color.

**Ops:** per-row `gradientRect` (heatmap), per-row `polygon` (ridgelines, back
to front), `polygon` quad strip (mesh). 128 rows of `gradientRect` is 128
commands — cheap.

### B2. `trail`: phosphor scope

**Engine state:** history of the last N waveform windows, decimated to `points`
samples each. B1 and B2 want the same ring buffer, so build them together.

| prop | range | default |
|---|---|---|
| `source` | select | 0 — Waveform, Spectrum curve |
| `frames` | 2–32 | 12 |
| `decay` | 0.5–0.98 | 0.8 |
| `points` | 64–512 | 192 |
| `stableTrigger` | bool | true (aligns each window on a rising zero crossing) |
| `depthOffsetY` | 0–0.2 | 0.02 (shifts ghosts up for a 3D look) |
| `strokeWidth` `color` `color2` `glow` `gain` | | newest → oldest |

### B3. `lyrics`: synced lyrics

**Host work, no audio-path change:** parse LRC in the host, then publish `lyric`,
`lyricPrev`, `lyricNext`, `lyricIndex` and `lyricProgress` (0–1 within the
current line) with `setVar` each frame.

| prop | range | default |
|---|---|---|
| `visibleLines` | 1–7 odd | 3 |
| `activeScale` | 1–2 | 1.3 |
| `inactiveOpacity` | 0–1 | 0.4 |
| `falloff` | 0–1 | 0.5 |
| `transition` | select | 0 — Crossfade, Slide |
| `transitionMs` | 100–800 | 300 |
| `syncOffsetMs` | −2000–2000 | 0 |
| `highlight` | select | 0 — Whole line, Karaoke wipe |
| `fallbackText` | text | shown when no lyrics exist |

Plus the `text` props: `font`, `weight`, `align`, `valign`, `letterSpacing`,
the shadow group and `glow`.

**Ops:** `text` per line, and `clipPush`/`clipPop` for the wipe — both exist.
The wipe fills `color` over `color2` using `lyricProgress` and a clip rect.

### B4. `chroma`: pitch-class display

**Engine state:** the current 2048-sample window is too coarse for low notes
(bins are ~21.5 Hz wide at 44.1 kHz). Keep an 8192-sample ring, run a
4096-point FFT every few frames, then fold bins into 12 pitch classes. Add
`vze_chroma(i)` and publish `{note}` and `{key}` (Krumhansl–Schmuckler).

| prop | range | default |
|---|---|---|
| `layout` | select | 0 — Bars, Wheel |
| `notation` | select | 0 — C–B, Do–Si |
| `a4Hz` | 415–466 | 440 |
| `lowHz` | 55–200 | 65 |
| `highHz` | 1000–4200 | 2000 |
| `highlightDominant` | bool | true |
| `showLabels` | bool | true |
| `labelSize` | | |
| `gain` `smoothing` `decay` | | 1.15 / 0.7 / 0.9 |

### B5. `waveform_track`: whole-track waveform

**Engine state:** `vze_peaks_set(ptr, n)` takes a host-decoded min/max pair
array (`n` between 512 and 4096). The host decodes once per file with
`decodeAudioData`.

| prop | range | default |
|---|---|---|
| `style` | select | 0 — Bars, Mirrored fill, Line |
| `bars` | 40–400 | 160 |
| `barWidth` | 0.1–1 | 0.7 |
| `roundness` | 0–1 | 0.5 |
| `color` | colour | played |
| `color2` | colour | unplayed |
| `unplayedOpacity` | 0–0.5→1 | 0.35 |
| `cursor` | bool | true |
| `cursorColor` `cursorWidth` | | |
| `liveFallback` | select | 1 — Flat, Fill as it plays |

**Behavior:** split point is `positionSec / durationSec` from the existing vars.
Read-only, so no seeking.

---

## C. Needs renderer and op changes

### C1. `vinyl`: turntable

**New op required — see correction 2 above.** `IMAGE` has no free field:
`P4`/`P5` are flipX/flipY. Either add an `imageRot` op carrying a rotation, or
widen the command stride and give every backend a rotation-aware image path.

| prop | range | default |
|---|---|---|
| `rpm` | select | 0 — 33⅓, 45, 78 |
| `onlyWhenPlaying` | bool | true |
| `inertiaMs` | 200–3000 | 900 |
| `bassWobble` | 0–0.02 | 0.004 |
| `grooves` | 4–40 | 18 |
| `discColor` | colour | `{bg}` |
| `grooveColor` | colour | |
| `sheen` | 0–1 | 0.25 (two rotating low-alpha wedges) |
| `labelScale` | 0.15–0.5 | 0.32 |
| `labelImage` | image | `{cover}`, rotates with the disc |
| `tonearm` | bool | false |
| `armColor` `armLength` | | |
| `shadow` | bool | true |

**Behavior:** the arm sweeps from outer to inner groove as
`positionSec / durationSec` advances and lifts off when `{playing}` is `0`.

**Ops:** `circle` (disc, rings), `arc` (grooves, sheen), rotated `image`
(label), `line` + `circle` (arm).

### C2. `kaleidoscope`: mirrored wedge effect

**New ops required:** `LAYER_BEGIN` / `LAYER_END` to capture everything below
into an offscreen target, and `WEDGE_BLIT` to draw N mirrored copies of one
wedge.

| prop | range | default |
|---|---|---|
| `segments` | 2–16 even | 6 |
| `rotation` | −1–1 rev/s | 0.05 |
| `rotationBeat` | 0–1 | 0.3 |
| `zoom` | 0.5–3 | 1.2 |
| `offsetX` `offsetY` | −0.5–0.5 | 0 |
| `mirrorAlternate` | bool | true (every second wedge flipped so seams match) |
| `edgeBlend` | 0–0.1 | 0.01 |
| `captureScale` | 0.25–1 | 0.5 (offscreen resolution) |

**Behavior:** the component sits in the scene stack and applies to everything
below it. Put it above a `background` and some `particles`/`spectrum`; ignore
it otherwise.

**Backend notes:** canvas needs `clip()` plus `drawImage`; Android would use a
shader sampling the capture. Offscreen cost is the main risk, hence
`captureScale` 0.5 by default. D2 (`group`) makes this cleaner to build.

---

## D. Cross-cutting engine features

### D1. Audio bindings on any numeric prop

```json
"opacity": { "bind": "bass", "min": 0.3, "max": 1, "curve": 0.6 }
```

- `bind` is one of `rms`, `peak`, `bass`, `mid`, `treble`, `beat`,
  `beatPhase`.
- `min`/`max` set the output range; `curve` is a power-curve exponent (below 1
  boosts quiet levels).
- A plain number stays valid, so existing presets keep working.

The sources already exist — `vze_level(AS_RMS|AS_PEAK|AS_BASS|AS_MID|
AS_TREBLE|AS_BEAT)` and `vze_beat_phase()` are exported today.

**Schema change:** each numeric prop gains a "bind" affordance in the inspector.
Note the engine's `scene_set_num` takes a flat float, so the preset format has
to carry an object somewhere: either widen the value shape for numeric props
(normalisation already tolerates objects? — it does not, this needs a format
change) or add a parallel `binds` map on the component.

**Engine change:** `vze_scene_set_bind(idx, pid, src, min, max, curve)`.

**Impact:** `text`, `shape` and `image` become audio-reactive without new
components.

### D2. `group`

Props: `offsetX`, `offsetY`, `scale`, `rotation`, `clipToBox` (bool), plus
`opacity`. It contains the next `count` components in the scene list (`count`,
1–16). This also makes C2 simpler to build.

*Note:* `rotation` here needs renderer work too — there is no transform op
today, so this implies a transform stack (`save`/`restore` semantics) that
`clipPush`/`clipPop` already half-provide.

### D3. Stereo input

`AudioInput.read()` returns a mono window, so stereo needs a `ChannelSplitter`
plus two analysers in `audio.js`. The engine gets `pushAudioStereo(l, r)`
alongside the existing `vze_audio_buffer`/`vze_audio_commit` path, and presets
can read `{width}` and `{correlation}`. Components B2 and A7 then switch to true
XY automatically.

---

## Suggested build order

1. `dotmatrix`, `rays` (no engine state, high visual payoff)
2. D1 bindings (cheap, multiplies the value of everything else)
3. `bolts`, `tunnel`, `vu`
4. B1/B2 together (one shared history buffer), then `lyrics`
5. `waveform_track`, `chroma`, `lissajous`, D3
6. `vinyl`, D2, `kaleidoscope`

## Open decisions

- **A6 vs particles Tunnel** — upgrade the existing mode, or add the component?
- **A1 vs spectrum segments** — new component, or `offColor`/`offOpacity` on
  `spectrum`?
- **D1 bind storage** — new value shape for numeric props, or a parallel
  `binds` object per component?
- **C1 rotation** — new op, or widen the command stride?