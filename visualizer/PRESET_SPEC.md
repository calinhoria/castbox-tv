# Preset format specification

The contract for a Visualiser Studio preset. A preset is a single JSON file and
is the **only** thing shared between the Studio, the WASM engine and the Android
app — if a preset renders here it renders there.

- [1. File format](#1-file-format)
- [2. Colour tokens](#2-colour-tokens)
- [3. Palettes and embedded roles](#3-palettes-and-embedded-roles)
- [4. Text patterns](#4-text-patterns)
- [5. Geometry](#5-geometry)
- [6. Component reference](#6-component-reference)
- [7. Recipes](#7-recipes)
- [8. Authoring rules](#8-authoring-rules)

## 1. File format

```json
{
  "version": 1,
  "name": "Neon bars",
  "author": "user",
  "palette": "Neon",
  "roles": { "primary": "#ff2d95" },
  "components": [
    { "type": "background", "props": { "mode": 1, "color": "{bg}" } },
    { "type": "spectrum",   "props": { "bars": 48, "color": "{primary}" } },
    { "type": "text",       "props": { "pattern": "{title}", "size": 0.06 } }
  ]
}
```

| field | type | notes |
|---|---|---|
| `version` | number | schema version, currently `1` |
| `name` | string | shown in the picker; **unique per device** — it is the save key |
| `author` | string | free-form. `generated` marks files the generator owns |
| `palette` | string | one of the named palettes, or `From cover`. Ignored for roles listed in `roles` |
| `roles` | object? | **optional embedded palette** — see [§3](#3-palettes-and-embedded-roles) |
| `images` | array? | **optional embedded art** — `[{ "id": 10000, "url": "data:image/…" }]`; components reference entries by id. Never stored as files — decoded from here at load |
| `components` | array | drawn in order; index 0 is at the back |

Each component is `{ "type": <type>, "props": { … } }`. Props are the exact
names the engine registers (`vze_prop_id`). **A prop the engine does not know is
silently dropped**, and a component type it does not know is skipped, so an old
app still renders a newer preset — it just renders less of it.

Normalisation is deliberately forgiving: missing props are filled from the
schema defaults, so you only ever write what you want to change. Unknown props
are preserved in the file but ignored by the engine.

## 2. Colour tokens

Every colour prop accepts either a literal colour or a `{token}`:

| literal | meaning |
|---|---|
| `#rgb` / `#rrggbb` | hex, with optional 4th pair for alpha (`#rrggbbaa`) |
| `rgb(r,g,b)` / `rgba(r,g,b,a)` | channels 0-255, alpha 0-1 |
| `white`, `black`, `transparent` | shortcuts |
| `{primary}`, `{bg}`, … | a palette role, resolved at draw time |
| `{cover}` | in **image** props: whatever artwork the host loaded for the track |
| `data:image/…` | in **image** props: base64 art embedded in the preset itself |

Tokens are resolved every frame, so switching palette re-themes a live preset
with no reload. A token is only honoured where the prop is a colour or image
prop; putting `{primary}` in a numeric prop yields the default.

An embedded `data:image/png;base64,…` (or jpeg/webp) image lives in the
preset's top-level `images` table — `[{ "id": 10000, "url": "data:…" }]` —
and components reference it by id (`"image": "10000"`). Art is preset data,
not component data: deleting a component can never drop the table. Each host
decodes the table at load and registers every entry under its id (ids 10000+,
capped at 8 per preset, identical URLs shared). The stored JSON keeps the
table, so the preset carries its art with it — paste it into any Studio and
the images come along. TV builds additionally downsample past a 1024px long
edge; malformed entries are skipped. No host ever stores decoded bitmaps;
art is always decoded from the preset JSON at load. Stray data URLs left
directly in props (pre-table pastes) are upgraded into the table on load.

## 3. Palettes and embedded roles

A preset normally names a palette and inherits all six roles:

| role | used for |
|---|---|
| `bg` | backdrop |
| `surface` | panels, chips |
| `primary` | main accent |
| `secondary` | second accent |
| `accent` | highlight |
| `text` | type and icons |

There is a seventh role, **`dynamic`**, which is *not* part of any palette. It is
published for every preset, always follows the current artwork (the dominant
cover colour pulled down to ~30% luminance) and is **never written into a
preset file** — it cannot be frozen, by design.

### Embedding a palette

Set `roles` to override individual roles. It is an **override, not a
replacement**: roles you do not list still come from the named palette, so a
preset can override one brand colour and inherit the rest.

```json
{ "name": "House style", "palette": "Ocean", "roles": { "primary": "#1DB954" } }
```

Rules:

- Only the six storable roles are accepted, and only as `#rrggbb`. Anything else
  in the block is dropped on load, so a typo degrades to the palette value
  rather than breaking the preset.
- `dynamic` in the block is ignored.
- `From cover` + `roles` is legal: the artwork supplies the base, `roles` pins
  specific roles on top.
- In the Studio, pick **Custom (this preset)** in the Palette panel to freeze the
  current palette into the preset; the swatches then become colour pickers that
  write straight back into the preset. Pick any named palette to drop the block
  again.

Why bother: a preset that pins its colours travels on its own. Shared with
someone who has never heard of your palette, it still looks like itself.

## 4. Text patterns

`text.pattern` is resolved against the variables the host publishes:

| token | value |
|---|---|
| `{title}` `{artist}` `{album}` | track metadata (album may be empty) |
| `{station}` `{controller}` | source / who is rendering |
| `{clock}` `{date}` | wall clock, host locale |
| `{position}` `{duration}` `{remaining}` | track time as `m:ss` |
| `{positionSec}` `{durationSec}` | raw seconds, for `progress` |
| `{playing}` `{source}` | `'1'`/`'0'`, input mode name |
| `{bpm}` `{rms}` | detected tempo and level |

Mixing tokens with literal text is fine: `'{artist} — {album}'`. Unset metadata
resolves to an empty string, so put optional tokens in their own text component
rather than relying on a placeholder.

Long text can scroll: set `marquee: true` with `marqueeSpeed`,
`marqueePause` (seconds held before each scroll) and `marqueeGap` (space behind
the tail, in box widths).

## 5. Geometry

`x`, `y`, `w`, `h` are fractions of the 1280x720 surface. `x`/`y` are the
top-left corner; `w`/`h` the size. Negative and over-1 values are legal and
useful — `y: -0.2` pushes a component off the top edge.

Square boxes should use a width and derive the height: a 0.4-wide box is
`0.4 * 16/9 ≈ 0.711` tall.

Bars and lines anchor to the bottom by default (`baseline` / `centered`
control this), so a falling peak cap and a growing bar share one baseline.
`reflection` mirrors content below that baseline and only applies to
bottom-anchored bars.

## 6. Component reference

Generated from `js/presets.js` by `node tools/gen-spec-tables.mjs` — it cannot
drift from the schema.

<!-- BEGIN GENERATED TABLES -->

### Components

Schema version `1`. Every component takes the same
geometry props: `x`, `y`, `w`, `h` (fractions of the 1280x720 surface;
`w`/`h` are the box size, `x`/`y` its top-left corner) and `opacity`.

Component list is index order: index 0 is drawn first (bottom), the last
index is on top. `hidden: true` keeps an index but draws nothing.

#### `background` — solid / gradient / image backdrop

*Background*

| prop | type | values |
|---|---|---|
| `mode` | select | 0 = Solid, 1 = Gradient, 2 = Image |
| `color` | color | colour; default — |
| `color2` | color | colour; default — |
| `gradientAngle` | range | 0..360 — default — |
| `image` | image | image id or {cover} — default {cover}<br><sub>an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset</sub> |
| `fit` | select | 0 = Contain, 1 = Cover, 2 = Stretch — default 1 |
| `blur` | range | 0..100, step 0.5 — default — |
| `dim` | range | 0..1, step 0.01 — default — |
| `pulseAmount` | range | 0..0.9, step 0.01 — default 0<br><sub>image zooms with the beat and dips down, easing back (image mode only)</sub> |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0 |
| `y` | range | -0.5..1.5, step 0.002 — default 0 |
| `w` | range | 0.01..2, step 0.002 — default 1 |
| `h` | range | 0.01..2, step 0.002 — default 1 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `spectrum` — FFT bars, optional falling peaks

*Bars*

| prop | type | values |
|---|---|---|
| `bars` | range | 2..160 — default 48 |
| `gap` | range | 0..0.8, step 0.01 — default 0.2 |
| `barWidth` | range | 0.05..1, step 0.01 — default 0.8 |
| `roundness` | range | 0..1, step 0.01 — default 0.3 |
| `baseline` | select | 0 = Bottom, 1 = Center, 2 = Top |
| `centered` | bool | default false |
| `mirror` | bool | default false |
| `reflection` | bool | default false<br><sub>mirrors the bars below the baseline, fading with depth; bottom anchor only (ignored when Center bars is on)</sub> |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default — |
| `color2` | color | colour; default — |
| `gradient` | bool | default false |
| `gradientAngle` | range | 0..360 — default — |
| `glow` | range | 0..30, step 0.5 — default — |
| `gradientMode` | select | 0 = Stretch (per bar), 1 = Reveal (box ramp), 2 = Palette ramp — default 0<br><sub>stretch paints every bar in full color; reveal fixes the ramp to the box so short bars stay dark; palette runs the whole palette up the box</sub> |
| `colorMode` | select | 0 = Manual, 1 = Random, 2 = Random palette, 3 = Complementary, 4 = Cover — default 0<br><sub>per-bar colors; cover picks the vivid palette roles (the artwork under From cover)</sub> |

*Response*

| prop | type | values |
|---|---|---|
| `gain` | range | 0.2..4, step 0.05 — default 1.15 |
| `minHeight` | range | 0..0.5, step 0.005 — default 0.01 |
| `maxHeight` | range | 0.05..1, step 0.01 — default 1 |
| `smoothing` | range | 0..0.95, step 0.01 — default 0.55 |
| `decay` | range | 0..0.99, step 0.01 — default 0.82 |
| `logScale` | bool | default true |
| `bandStart` | range | 0..1, step 0.01 — default 0 |
| `bandEnd` | range | 0..1, step 0.01 — default 1 |
| `tilt` | range | -6..6, step 0.25 — default 0<br><sub>dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)</sub> |

*Peaks*

| prop | type | values |
|---|---|---|
| `peaks` | bool | default false |
| `peakColor` | color | colour; default #ffffff |
| `peakWidth` | range | 1..24 — default 4 |
| `peakDelay` | range | 0..6, step 0.05 — default 0<br><sub>seconds a cap sits still after its bar drops, before it starts falling</sub> |
| `peakGap` | range | 0..40 — default 0<br><sub>keeps the cap clear above the bar tip so it never hides inside the bar</sub> |
| `peakFall` | range | 0..4, step 0.05 — default 1.1 |

*Segments*

| prop | type | values |
|---|---|---|
| `segmentShape` | select | 0 = None (solid), 1 = Circles, 2 = Squares, 3 = Half squares — default 0<br><sub>LED-style segments auto-fit to the bar width (squares stay square, circles stay round); each lit segment takes the ramp color at its height</sub> |
| `segmentGap` | range | 0..0.8, step 0.01 — default 0.2<br><sub>gap as a fraction of the segment size</sub> |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.04 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.45 |
| `w` | range | 0.01..2, step 0.002 — default 0.92 |
| `h` | range | 0.01..2, step 0.002 — default 0.5 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `line` — waveform or spectrum curve

*Line*

| prop | type | values |
|---|---|---|
| `lineMode` | select | 0 = Waveform, 1 = Spectrum curve |
| `linePoints` | range | 8..512 — default 160 |
| `strokeWidth` | range | 0.001..0.06, step 0.001 — default 0.008 (fraction of box) |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default — |
| `color2` | color | colour; default — |
| `gradient` | bool | default false |
| `gradientAngle` | range | 0..360 — default — |
| `glow` | range | 0..30, step 0.5 — default — |

*Response*

| prop | type | values |
|---|---|---|
| `smoothing` | range | 0..0.95, step 0.01 — default 0.45 |
| `gain` | range | 0.2..4, step 0.05 — default 1.2 |
| `tilt` | range | -6..6, step 0.25 — default 0<br><sub>dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)</sub> |

*Fill*

| prop | type | values |
|---|---|---|
| `fill` | bool | default false |
| `fillColor` | color | colour; default #00e5ff |
| `fillOpacity` | range | 0..1, step 0.01 — default 0.22 |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.05 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.3 |
| `w` | range | 0.01..2, step 0.002 — default 0.9 |
| `h` | range | 0.01..2, step 0.002 — default 0.3 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `text` — bound to {title} {artist} {clock} …

*Content*

| prop | type | values |
|---|---|---|
| `pattern` | text | text<br><sub>use {title} {artist} {album} {clock} {date} {position} {duration} {remaining} {bpm}</sub> |
| `uppercase` | bool | default false |

*Text*

| prop | type | values |
|---|---|---|
| `size` | range | 0.01..0.35, step 0.002 — default 0.06 (fraction of box) |
| `weight` | select | 300 = Light, 400 = Regular, 700 = Bold — default 400 |
| `font` | select |  = System, Inter = Inter, Roboto = Roboto, Open Sans = Open Sans, Lato = Lato, Montserrat = Montserrat, Poppins = Poppins, Oswald = Oswald, Raleway = Raleway, Nunito = Nunito, Playfair Display = Playfair Display, DSEG7 Classic = DSEG7 (segmented) |
| `italic` | bool | default false |
| `letterSpacing` | range | 0..20, step 0.5 — default — |
| `align` | select | 0 = Left, 1 = Center, 2 = Right |
| `valign` | select | 0 = Top, 1 = Middle, 2 = Bottom |
| `color` | color | colour; default #ffffff |
| `glow` | range | 0..30, step 0.5 — default — |

*Shadow*

| prop | type | values |
|---|---|---|
| `shadow` | bool | default true |
| `shadowColor` | color | colour; default #000000 |
| `shadowBlur` | range | 0..40, step 0.5 — default 8 |
| `shadowOffset` | range | 0..20, step 0.5 — default 3 |

*Scroll*

| prop | type | values |
|---|---|---|
| `marquee` | bool | default false |
| `marqueeSpeed` | range | 5..200 — default 40 |
| `marqueeGap` | range | 0..2, step 0.05 — default 0.5<br><sub>empty space behind the tail before it wraps, in box widths</sub> |
| `marqueePause` | range | 0..30, step 0.5 — default 5<br><sub>seconds the text holds still before each scroll (Spotify style)</sub> |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.06 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.08 |
| `w` | range | 0.01..2, step 0.002 — default 0.88 |
| `h` | range | 0.01..2, step 0.002 — default 0.12 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `image` — cover art or artwork

*Image*

| prop | type | values |
|---|---|---|
| `image` | image | image id or {cover} — default {cover}<br><sub>an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset</sub> |
| `fit` | select | 0 = Contain, 1 = Cover, 2 = Stretch — default 1 |
| `cornerRadius` | range | 0..1, step 0.01 — default 0.12 |
| `circle` | bool | default false |
| `blur` | range | 0..100, step 0.5 — default 0 |
| `flipX` | bool | default false |
| `flipY` | bool | default false |

*Tint*

| prop | type | values |
|---|---|---|
| `tint` | range | 0..1, step 0.01 — default — |
| `tintColor` | color | colour; default #4d7cff |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.04 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.3 |
| `w` | range | 0.01..2, step 0.002 — default 0.24 |
| `h` | range | 0.01..2, step 0.002 — default 0.42 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `cover` — cover art ringed by a radial spectrum, glow and beat pulse

*Cover*

| prop | type | values |
|---|---|---|
| `image` | image | image id or {cover} — default {cover}<br><sub>an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset</sub> |
| `coverScale` | range | 0.1..1, step 0.01 — default 0.6 (fraction of box) |
| `imageAspect` | range | 0.25..4, step 0.05 — default 1<br><sub>width ÷ height of the center image (1 = square); the spectrum ring stays circular</sub> |
| `centerX` | range | 0..1, step 0.01 — default 0.5 (fraction of box)<br><sub>moves the effect (rings, loops, glow) relative to the image, which stays centered</sub> |
| `centerY` | range | 0..1, step 0.01 — default 0.5 (fraction of box)<br><sub>moves the effect (rings, loops, glow) relative to the image, which stays centered</sub> |
| `fit` | select | 0 = Contain, 1 = Cover, 2 = Stretch — default 1 |
| `cornerRadius` | range | 0..1, step 0.01 — default 0.14 |
| `circle` | bool | default false |
| `imagePulse` | bool | default true |
| `blur` | range | 0..100, step 0.5 — default 0 |
| `flipX` | bool | default false |
| `flipY` | bool | default false |
| `tint` | range | 0..1, step 0.01 — default — |
| `tintColor` | color | colour; default #4d7cff |

*Radial spectrum*

| prop | type | values |
|---|---|---|
| `radialBars` | range | 4..180 — default 64 |
| `ringRadius` | range | 0..0.98, step 0.01 — default 0.42 (fraction of box) |
| `radialLength` | range | 0.02..1, step 0.01 — default 0.5 (fraction of box) |
| `radialGap` | range | 0..0.9, step 0.01 — default 0.3 |
| `arcStart` | range | 0..360 — default 0 |
| `arcSpan` | range | 30..360 — default 360 |
| `radialGain` | range | 0.2..4, step 0.05 — default 1.2 |
| `radialSmoothing` | range | 0..0.95, step 0.01 — default 0.5 |
| `radialDecay` | range | 0..0.99, step 0.01 — default 0.85 |
| `radialPeaks` | bool | default false |
| `radialPeakColor` | color | colour; default #ffffff |
| `peakDelay` | range | 0..6, step 0.05 — default 0<br><sub>seconds a cap sits still after its bar drops, before it starts falling</sub> |
| `peakGap` | range | 0..40 — default 0<br><sub>keeps the cap clear beyond the bar tip</sub> |
| `mirror` | bool | default false<br><sub>folds the ring symmetric about the vertical centre</sub> |

*Response*

| prop | type | values |
|---|---|---|
| `tilt` | range | -6..6, step 0.25 — default 0<br><sub>dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)</sub> |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default #00e5ff |
| `color2` | color | colour; default #ff2d95 |

*Glow*

| prop | type | values |
|---|---|---|
| `glow` | range | 0..30, step 0.5 — default 14 |
| `haloColor` | color | colour; default #7c5cff |
| `pulseAmount` | range | 0..0.9, step 0.01 — default 0.12 |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.31 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.16 |
| `w` | range | 0.01..2, step 0.002 — default 0.38 |
| `h` | range | 0.01..2, step 0.002 — default 0.68 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `orb` — cover art ringed by glow spectrum lines

*Center*

| prop | type | values |
|---|---|---|
| `image` | image | image id or {cover} — default {cover}<br><sub>an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset</sub> |
| `coverScale` | range | 0.1..1, step 0.01 — default 0.5 (fraction of box) |
| `imageAspect` | range | 0.25..4, step 0.05 — default 1<br><sub>width ÷ height of the center image (1 = square); the spectrum ring stays circular</sub> |
| `centerX` | range | 0..1, step 0.01 — default 0.5 (fraction of box)<br><sub>moves the effect (rings, loops, glow) relative to the image, which stays centered</sub> |
| `centerY` | range | 0..1, step 0.01 — default 0.5 (fraction of box)<br><sub>moves the effect (rings, loops, glow) relative to the image, which stays centered</sub> |
| `fit` | select | 0 = Contain, 1 = Cover, 2 = Stretch — default 1 |
| `cornerRadius` | range | 0..1, step 0.01 — default 0.5 |
| `circle` | bool | default true |
| `imagePulse` | bool | default true |
| `blur` | range | 0..40, step 0.5 — default 0 |

*Spectrum lines*

| prop | type | values |
|---|---|---|
| `rings` | range | 1..6 — default 3 |
| `linePoints` | range | 24..512 — default 160 |
| `ringRadius` | range | 0..0.95, step 0.01 — default 0.42 (fraction of box) |
| `gap` | range | 0..0.9, step 0.01 — default 0.3 |
| `radialLength` | range | 0.02..1, step 0.01 — default 0.5 (fraction of box) |
| `thickness` | range | 0.002..0.08, step 0.001 — default 0.014 (fraction of box) |
| `gain` | range | 0.2..4, step 0.05 — default 1.25 |
| `smoothing` | range | 0..0.95, step 0.01 — default 0.5 |
| `decay` | range | 0..0.99, step 0.01 — default 0.86 |
| `mirror` | bool | default false<br><sub>folds the rings symmetric about the vertical centre (holds the drift still)</sub> |
| `arcStart` | range | 0..360 — default 0<br><sub>rotates the whole display (0 = top, clockwise)</sub> |
| `angularSmooth` | range | 0..0.95, step 0.01 — default 0<br><sub>blurs each ring across its neighbours so bands never spike sharp</sub> |
| `reflection` | bool | default false<br><sub>one faded flipped copy below the box</sub> |

*Response*

| prop | type | values |
|---|---|---|
| `tilt` | range | -6..6, step 0.25 — default 0<br><sub>dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)</sub> |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default #7dffd4 |
| `color2` | color | colour; default #00e5ff |
| `paletteRings` | bool | default false<br><sub>every ring takes one solid palette role, vivid first</sub> |

*Inner fill*

| prop | type | values |
|---|---|---|
| `fillColor` | color | colour; default #00e5ff<br><sub>solid disc out to the innermost ring</sub> |
| `fillOpacity` | range | 0..1, step 0.01 — default 0 |

*Glow*

| prop | type | values |
|---|---|---|
| `glow` | range | 0..30, step 0.5 — default 16 |
| `haloColor` | color | colour; default #00e5ff |
| `pulseAmount` | range | 0..0.9, step 0.01 — default 0.14 |
| `coreSize` | range | 0.1..2, step 0.05 — default 0.5 |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.3 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.14 |
| `w` | range | 0.01..2, step 0.002 — default 0.4 |
| `h` | range | 0.01..2, step 0.002 — default 0.72 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `progress` — bar bound to the track position

*Bar*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default #ffffff |
| `color2` | color | colour; default #4d7cff |
| `gradient` | bool | default false |
| `gradientAngle` | range | 0..360 — default 90 |
| `glow` | range | 0..30, step 0.5 — default — |
| `cornerRadius` | range | 0..1, step 0.01 — default 0.5 |

*Track*

| prop | type | values |
|---|---|---|
| `trackColor` | color | colour; default #ffffff |
| `trackOpacity` | range | 0..1, step 0.01 — default 0.15 |

*Thumb*

| prop | type | values |
|---|---|---|
| `thumb` | image | image id or {cover} — default 0<br><sub>an image id for the handle (e.g. bundled 11 = Winamp posbar thumb); 0/none hides it</sub> |
| `thumbScale` | range | 0.5..4, step 0.1 — default 1.5<br><sub>handle height relative to the bar height</sub> |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.05 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.9 |
| `w` | range | 0.01..2, step 0.002 — default 0.9 |
| `h` | range | 0.01..2, step 0.002 — default 0.02 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `radial_line` — circular waveform / spectrum line

*Line*

| prop | type | values |
|---|---|---|
| `lineMode` | select | 0 = Waveform, 1 = Spectrum curve |
| `linePoints` | range | 24..512 — default 160 |
| `strokeWidth` | range | 0.001..0.06, step 0.001 — default 0.008 (fraction of box) |
| `gain` | range | 0.2..4, step 0.05 — default 1.2 |
| `smoothing` | range | 0..0.95, step 0.01 — default 0.45 |

*Response*

| prop | type | values |
|---|---|---|
| `tilt` | range | -6..6, step 0.25 — default 0<br><sub>dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)</sub> |

*Circle*

| prop | type | values |
|---|---|---|
| `ringRadius` | range | 0..0.98, step 0.01 — default 0.6 (fraction of box) |
| `radialLength` | range | 0.01..1, step 0.01 — default 0.4 (fraction of box) |
| `pulseAmount` | range | 0..0.9, step 0.01 — default 0.08 |
| `mirror` | bool | default false<br><sub>folds the loop symmetric about the vertical centre</sub> |
| `arcStart` | range | 0..360 — default 0<br><sub>rotates the whole loop (0 = top, clockwise)</sub> |

*Center*

| prop | type | values |
|---|---|---|
| `image` | image | image id or {cover} — default {cover}<br><sub>cover art, an uploaded image, or an embedded data:image/... URL in the middle</sub> |
| `coverScale` | range | 0.1..1, step 0.01 — default 0.5 (fraction of box) |
| `imageAspect` | range | 0.25..4, step 0.05 — default 1<br><sub>width ÷ height of the center image (1 = square); the spectrum ring stays circular</sub> |
| `centerX` | range | 0..1, step 0.01 — default 0.5 (fraction of box)<br><sub>moves the effect (rings, loops, glow) relative to the image, which stays centered</sub> |
| `centerY` | range | 0..1, step 0.01 — default 0.5 (fraction of box)<br><sub>moves the effect (rings, loops, glow) relative to the image, which stays centered</sub> |
| `fit` | select | 0 = Contain, 1 = Cover, 2 = Stretch — default 1 |
| `cornerRadius` | range | 0..1, step 0.01 — default 0.5 |
| `circle` | bool | default true |

*Color*

| prop | type | values |
|---|---|---|
| `glow` | range | 0..30, step 0.5 — default 0<br><sub>0 = single crisp line; higher adds a neon bloom (which reads as extra lines)</sub> |
| `color` | color | colour; default #00e5ff |
| `color2` | color | colour; default #ff2d95 |
| `gradient` | bool | default false |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.3 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.2 |
| `w` | range | 0.01..2, step 0.002 — default 0.4 |
| `h` | range | 0.01..2, step 0.002 — default 0.6 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `particles` — embers, snow, dust, stars or beat sparks

*Particles*

| prop | type | values |
|---|---|---|
| `mode` | select | 0 = Embers, 1 = Snow, 2 = Dust, 3 = Stars, 4 = Beat sparks, 5 = Tunnel |
| `count` | range | 0..600 — default 120 |
| `size` | range | 0.002..0.1, step 0.001 — default 0.02 (fraction of box) |
| `speed` | range | 0..3, step 0.05 — default 1 |
| `sway` | range | 0..1, step 0.01 — default 0.5 |
| `gravity` | range | -1..2, step 0.05 — default 0 |
| `twinkle` | range | 0..1, step 0.01 — default 0.6 |
| `beatBoost` | range | 0..2, step 0.05 — default 0.8 |

*Shape*

| prop | type | values |
|---|---|---|
| `shape` | select | 0 = Circles, 1 = Squares, 2 = Triangles, 3 = Lines, 4 = Hearts, 5 = Mixed — default 0 |
| `sizeVar` | range | 0..1, step 0.01 — default 0<br><sub>spreads each particle between full size and (1 - variation) of it</sub> |
| `rotation` | range | 0..1, step 0.01 — default 0<br><sub>random orientation per particle for squares, triangles and hearts (lines follow their motion)</sub> |

*Color*

| prop | type | values |
|---|---|---|
| `colorMode` | select | 0 = Manual, 1 = Random, 2 = Random palette, 3 = Complementary, 4 = Cover — default 0<br><sub>cover picks the vivid palette roles (the artwork under From cover)</sub> |
| `color` | color | colour; default #ffb14d |
| `color2` | color | colour; default #ff5f6d |
| `gradient` | bool | default false |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0 |
| `y` | range | -0.5..1.5, step 0.002 — default 0 |
| `w` | range | 0.01..2, step 0.002 — default 1 |
| `h` | range | 0.01..2, step 0.002 — default 1 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `dotmatrix` — LED dot-grid equalizer

*Grid*

| prop | type | values |
|---|---|---|
| `cols` | range | 4..96 — default 32 |
| `rows` | range | 2..48 — default 16 |
| `cellShape` | select | 0 = Circle, 1 = Square, 2 = Rounded square — default 0 |
| `gap` | range | 0..0.8, step 0.01 — default 0.2 |
| `dimColor` | color | colour; default #ffffff |
| `dimOpacity` | range | 0..0.5, step 0.01 — default 0.07 |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default #22e1ff |
| `color2` | color | colour; default #ff2d95 |
| `glow` | range | 0..30, step 0.5 — default 0<br><sub>lit cells only</sub> |

*Response*

| prop | type | values |
|---|---|---|
| `gain` | range | 0.2..4, step 0.05 — default 1.15 |
| `smoothing` | range | 0..0.95, step 0.01 — default 0.55 |
| `decay` | range | 0..0.99, step 0.01 — default 0.82 |
| `logScale` | bool | default true |
| `tilt` | range | -6..6, step 0.25 — default 0<br><sub>dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)</sub> |
| `bandStart` | range | 0..1, step 0.01 — default 0 |
| `bandEnd` | range | 0..1, step 0.01 — default 1 |
| `quantize` | bool | default true<br><sub>off lets the top cell fade in proportionally</sub> |

*Peaks*

| prop | type | values |
|---|---|---|
| `peaks` | bool | default false |
| `peakWidth` | range | 1..24 — default 4 |
| `peakFall` | range | 0..4, step 0.05 — default 1.1 |
| `peakDelay` | range | 0..6, step 0.05 — default 0 |
| `peakGap` | range | 0..40 — default 0 |
| `peakColor` | color | colour; default #ffffff |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.1 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.12 |
| `w` | range | 0.01..2, step 0.002 — default 0.8 |
| `h` | range | 0.01..2, step 0.002 — default 0.76 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `rays` — sunburst spokes driven by the spectrum

*Rays*

| prop | type | values |
|---|---|---|
| `count` | range | 8..360 — default 96 |
| `innerRadius` | range | 0..0.95, step 0.01 — default 0.25 (fraction of box) |
| `length` | range | 0.02..1, step 0.01 — default 0.5 (fraction of box) |
| `strokeWidth` | range | 0.001..0.03, step 0.001 — default 0.004 (fraction of box) |
| `taper` | range | 0..1, step 0.01 — default 0<br><sub>0 = uniform spokes, 1 = tapered to a point</sub> |

*Motion*

| prop | type | values |
|---|---|---|
| `spin` | range | -2..2, step 0.05 — default 0.05<br><sub>revolutions per second</sub> |
| `spinBeat` | range | 0..1, step 0.01 — default 0.3 |
| `arcStart` | range | 0..360 — default 0 |
| `arcSpan` | range | 30..360 — default 360 |
| `mirror` | bool | default false<br><sub>folds the spokes symmetric about the vertical centre</sub> |
| `pulseAmount` | range | 0..0.9, step 0.01 — default 0.08<br><sub>pulls the inner radius in on the beat</sub> |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default — |
| `color2` | color | colour; default — |
| `gradient` | bool | default false |
| `gradientAngle` | range | 0..360 — default — |
| `glow` | range | 0..30, step 0.5 — default — |

*Response*

| prop | type | values |
|---|---|---|
| `gain` | range | 0.2..4, step 0.05 — default 1.15 |
| `smoothing` | range | 0..0.95, step 0.01 — default 0.55 |
| `tilt` | range | -6..6, step 0.25 — default 0<br><sub>dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)</sub> |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.2 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.06 |
| `w` | range | 0.01..2, step 0.002 — default 0.6 |
| `h` | range | 0.01..2, step 0.002 — default 0.66 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `terrain` — 3D spectrum mountains with an orbiting camera

*Terrain*

| prop | type | values |
|---|---|---|
| `terrainRows` | range | 16..128 — default 72<br><sub>one past spectrum frame per row; clamped to the point pool</sub> |
| `terrainBands` | range | 24..192 — default 96 |
| `rowIntervalMs` | range | 10..200 — default 45 |
| `flow` | select | 0 = Toward viewer, 1 = Away from viewer — default 0<br><sub>which end of the grid receives the newest row</sub> |
| `heightScale` | range | 0.05..1.5, step 0.01 — default 0.45 |
| `floorDb` | range | -90..-30 — default -70<br><sub>dB mapped to the floor; below it is flat</sub> |
| `logScale` | bool | default true |
| `tilt` | range | 0..6, step 0.25 — default 3<br><sub>dB per octave on the rows, before gain</sub> |
| `gain` | range | 0.2..4, step 0.05 — default 1.3 |
| `smoothing` | range | 0..0.95, step 0.01 — default 0.5 |
| `decay` | range | 0..0.99, step 0.01 — default 0.8 |
| `rowSmooth` | range | 0..1, step 0.01 — default 0.25<br><sub>blends each row with its neighbours in time, calming jitter</sub> |
| `widthTaper` | range | 0..0.9, step 0.01 — default 0.35 |

*Camera*

| prop | type | values |
|---|---|---|
| `pitch` | range | 0..85 — default 35<br><sub>degrees above the horizon; clamped at 85 to avoid a top-down map</sub> |
| `fov` | range | 20..110 — default 55 |
| `distance` | range | 0.8..5, step 0.05 — default 2.2 |
| `lookY` | range | -0.5..0.5, step 0.01 — default 0.05 |
| `pitchBass` | range | 0..30, step 0.5 — default 4 |
| `zoomBeat` | range | 0..0.5, step 0.01 — default 0.06 |

*Rotation*

| prop | type | values |
|---|---|---|
| `rotateMode` | select | 0 = Off, 1 = Spin, 2 = Sway, 3 = Beat kick, 4 = Spin + beat — default 1 |
| `yawStart` | range | 0..360 — default 0 |
| `yawSpeed` | range | -90..90 — default 12<br><sub>degrees per second</sub> |
| `swayRange` | range | 0..180 — default 40 |
| `swayPeriod` | range | 2..60, step 0.5 — default 16 |
| `yawBeat` | range | 0..60 — default 12 |
| `kickDecay` | range | 0.5..0.98, step 0.01 — default 0.9 |
| `rotateAxis` | select | 0 = Y only, 1 = Y + slight roll — default 0 |
| `roll` | range | 0..15, step 0.5 — default 0 |
| `avoidEdgeOn` | bool | default true<br><sub>eases through 90/270 degrees instead of dwelling where rows collapse</sub> |

*Look*

| prop | type | values |
|---|---|---|
| `strokeWidth` | range | 0.0005..0.01, step 0.0005 — default 0.0015 (fraction of box) |
| `color` | color | colour; default #ffffff |
| `color2` | color | colour; default #22e1ff |
| `gradient` | bool | default true |
| `colorBy` | select | 0 = Depth, 1 = Height, 2 = Row age — default 0<br><sub>needs Gradient on</sub> |
| `depthFade` | range | 0..1, step 0.01 — default 0.5 |
| `glow` | range | 0..30, step 0.5 — default 0 |
| `heightGlow` | range | 0..30, step 0.5 — default 0<br><sub>applied to the near rows and the tallest peaks only — glow is the expensive op</sub> |
| `occlude` | bool | default false<br><sub>fills each row to the floor, back to front: hidden-line removal</sub> |
| `floorGrid` | bool | default false |
| `floorColor` | color | colour; default #ffffff |
| `floorOpacity` | range | 0..0.5, step 0.01 — default 0.12 |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.05 |
| `w` | range | 0.01..2, step 0.002 — default 1 |
| `h` | range | 0.01..2, step 0.002 — default 0.9 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `shape` — panel, divider or disc

*Shape*

| prop | type | values |
|---|---|---|
| `shape` | select | 0 = Rectangle, 1 = Circle, 2 = Divider |
| `cornerRadius` | range | 0..1, step 0.01 — default 0.08 |
| `filled` | bool | default true |
| `strokeWidth` | range | 0.001..0.06, step 0.001 — default 0.006 (fraction of box) |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default — |
| `color2` | color | colour; default — |
| `gradient` | bool | default false |
| `gradientAngle` | range | 0..360 — default — |
| `glow` | range | 0..30, step 0.5 — default — |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.05 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.7 |
| `w` | range | 0.01..2, step 0.002 — default 0.4 |
| `h` | range | 0.01..2, step 0.002 — default 0.08 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `meter` — level / progress, linear or ring

*Meter*

| prop | type | values |
|---|---|---|
| `source` | select | 0 = RMS, 1 = Peak, 2 = Bass, 3 = Mid, 4 = Treble, 5 = Beat |
| `direction` | select | 0 = Left to Right, 1 = Bottom to Top, 2 = Ring |
| `thickness` | range | 0.005..0.2, step 0.005 — default 0.03 (fraction of box) |
| `cornerRadius` | range | 0..1, step 0.01 — default 0.5 |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default — |
| `color2` | color | colour; default — |
| `gradient` | bool | default false |
| `gradientAngle` | range | 0..360 — default — |
| `glow` | range | 0..30, step 0.5 — default — |

*Track*

| prop | type | values |
|---|---|---|
| `trackColor` | color | colour; default #ffffff |
| `trackOpacity` | range | 0..1, step 0.01 — default 0.15 |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.05 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.85 |
| `w` | range | 0.01..2, step 0.002 — default 0.9 |
| `h` | range | 0.01..2, step 0.002 — default 0.02 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

#### `beat` — rings that fire on the beat

*Pulse*

| prop | type | values |
|---|---|---|
| `rings` | range | 1..6 — default 2 |
| `pulseMin` | range | 0.05..0.9, step 0.01 — default 0.3 |
| `pulseMax` | range | 0.2..1.5, step 0.01 — default 1 |
| `thickness` | range | 0.005..0.2, step 0.005 — default 0.02 (fraction of box) |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default — |
| `color2` | color | colour; default — |
| `gradient` | bool | default false |
| `gradientAngle` | range | 0..360 — default — |
| `glow` | range | 0..30, step 0.5 — default — |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.2 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.2 |
| `w` | range | 0.01..2, step 0.002 — default 0.6 |
| `h` | range | 0.01..2, step 0.002 — default 0.6 |
| `opacity` | range | 0..1, step 0.01 — default 0.8 |

#### `beat_glow` — blooming orb that flares on the beat

*Glow*

| prop | type | values |
|---|---|---|
| `intensity` | range | 0..3, step 0.05 — default 1 |
| `haloSize` | range | 0.2..4, step 0.05 — default 1.35 |
| `haloOpacity` | range | 0..1, step 0.01 — default 0.85 |
| `coreSize` | range | 0.1..2, step 0.05 — default 0.55 |
| `bloom` | range | 0..1, step 0.01 — default 0.5 |
| `follow` | range | 0..1, step 0.01 — default 1<br><sub>0 = beat phase only, 1 = smooth bass level</sub> |

*Color*

| prop | type | values |
|---|---|---|
| `color` | color | colour; default — |
| `haloColor` | color | colour; default — |

*Layout*

| prop | type | values |
|---|---|---|
| `x` | range | -0.5..1.5, step 0.002 — default 0.25 |
| `y` | range | -0.5..1.5, step 0.002 — default 0.25 |
| `w` | range | 0.01..2, step 0.002 — default 0.5 |
| `h` | range | 0.01..2, step 0.002 — default 0.5 |
| `opacity` | range | 0..1, step 0.01 — default 1 |

### Palettes

A preset names one of these, or **From cover**:

| palette | bg | surface | primary | secondary | accent | text |
|---|---|---|---|---|---|---|
| Neon | `#05060a` | `#131a2a` | `#22e1ff` | `#ff2d95` | `#7cffcb` | `#ffffff` |
| Sunset | `#1a0b12` | `#2c1322` | `#ff8a3d` | `#ff2d6f` | `#ffd166` | `#fff4e6` |
| Ocean | `#04121f` | `#0c2436` | `#35c6ff` | `#1f6feb` | `#7dffd4` | `#eaf6ff` |
| Forest | `#06110b` | `#12261a` | `#4ade80` | `#15803d` | `#fde047` | `#ecfdf5` |
| Mono | `#0a0a0a` | `#1a1a1a` | `#f5f5f5` | `#9ca3af` | `#ffffff` | `#ffffff` |
| Candy | `#1a0f1e` | `#2c1836` | `#ff6ec7` | `#8b5cf6` | `#67e8f9` | `#fff0fb` |
| Retro | `#1b1436` | `#2a2050` | `#ff5f6d` | `#ffc371` | `#38bdf8` | `#fef3c7` |
| Miami | `#0b0327` | `#1a0b3d` | `#00f5d4` | `#f15bb5` | `#fee440` | `#ffffff` |
| Gold | `#120d04` | `#241a08` | `#ffd166` | `#f59e0b` | `#fff3c4` | `#fffaf0` |
| Ice | `#05121a` | `#0e2230` | `#a5f3fc` | `#38bdf8` | `#ffffff` | `#f0fdff` |
| Ember | `#150704` | `#2a0f08` | `#ff6b35` | `#d92027` | `#ffd166` | `#fff1e6` |
| Cyberpunk | `#0a0118` | `#16022e` | `#f9f002` | `#ff003c` | `#00e5ff` | `#ffffff` |
| Pastel | `#1a1a2e` | `#25254a` | `#a78bfa` | `#f0abfc` | `#7dd3fc` | `#fdf4ff` |
| Deep Space | `#02010a` | `#0b0a1f` | `#6d5dfc` | `#00c2ff` | `#ff4d9d` | `#e8e6ff` |

`dynamic` is a seventh role, published for **every** preset and
never stored in one: it is the dominant cover-art colour pulled down to
~30% luminance. Bind a colour prop to `{dynamic}` for an artwork-tinted
backdrop that still keeps fixed brand colours for text and accents.

<!-- END GENERATED TABLES -->

## 7. Recipes

**Bind to roles, not literals.** Use `{primary}` / `{accent}` rather than hex, so
the preset can be re-themed. Literals are for fixed brand colours only.

**The background should carry the artwork when the design does.** `mode: 2` with
`image: '{cover}'`, `blur` around 40 and `dim` around 0.7 gives depth without
fighting the foreground.

**Quantise before you decorate.** `segmentShape` rounds bars up to whole
segments, so the drawn bar is *taller* than its continuous value. Anything
positioned from a bar (peak caps) has to clear the drawn top, not the computed
height.

**Peaks want headroom.** `peakGap` is the visible daylight between a cap and its
bar tip, and a cap cannot rise past its component's box — on a bar pinned at
`maxHeight` there is nowhere to go and it sits on the tip.

**Give text somewhere to live.** A title at `size: 0.06` needs a box at least
that tall with `valign` set, or it clips.

**Keep a still frame legible.** The suite renders every shipped preset and fails
if one emits almost no draw commands — a preset that only animates in one
direction tends to look broken on the first frame.

## 8. Authoring rules

- `name` must be unique on the device. Saving over an existing name replaces it,
  which is how "Save" overwrites in place.
- Colours are `#rrggbb` in a `roles` block; alpha belongs in a separate
  `opacity`/`trackOpacity` prop, not in the hex.
- Every component should carry an explicit `opacity` when it is a background
  layer, so it can be dialled back without deleting it.
- Ship presets as files under `presets/default/`, add the filename to
  `presets/default/index.json` (the generator does this for you) and never embed
  preset data in code.
- `test/spa.test.mjs` loads the same files the Studio serves, so a preset that
  breaks the suite breaks the Studio too.