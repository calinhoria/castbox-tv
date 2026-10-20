# Visualiser Studio

A **JSON-preset audio visualiser**: a small engine core compiled to WebAssembly,
plus a single-page app to author, preview and edit presets visually.

This is the prototype stage for the CastBox TV visualiser. The C++ core is written so
that the exact same source can be compiled into the Android app later through the
existing CMake/JNI setup — the web SPA is only a thin, replaceable backend.

```
visualizer/
├── index.html            SPA shell
├── css/app.css
├── js/
│   ├── engine.js         WASM binding: JSON preset <-> engine, commands out
│   ├── renderer.js       Canvas2D backend: Op codes -> canvas calls
│   ├── audio.js          audio input: file / microphone / built-in mock
│   ├── presets.js        THE PRESET SCHEMA + normalisation + persistence
│   ├── palettes.js       named colour palettes + cover-art colour extraction
│   ├── editor.js         visual editor (select/drag/resize) + inspector
│   └── main.js           wiring + frame loop
├── tools/generate-presets.mjs   palette×layout presets + index.json
├── presets/default/*.json       default presets (hand files + generated)
├── presets/default/index.json   manifest the SPA fetches
├── engine/
│   ├── src/vze.h         C ABI: component types, draw opcodes, prop registry
│   ├── src/vze.cpp       FFT + analysis, scene layout, variable binding, emitter
│   ├── build.sh          em++ -> wasm/vze.mjs + wasm/vze.wasm
│   └── test/             headless engine tests
├── test/                 DOM-free integration tests + syntax check
└── serve.sh              static server (ES modules need http://)
```

## Running it

```bash
cd visualizer
./engine/build.sh      # needs Emscripten (see below) - writes wasm/
./serve.sh             # http://localhost:8099/
./test/run.sh          # syntax + engine + SPA integration tests
```

`./serve.sh 9000` to pick another port. Add `?mock=1` to the URL to start the
built-in groove without loading an audio file.

**Emscripten** (one-time):

```bash
git clone --depth 1 https://github.com/emscripten-core/emsdk.git ~/emsdk
(cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest)
```

`build.sh` auto-sources `~/emsdk/emsdk_env.sh`, so no shell setup is needed.

## Built-in presets

| preset | idea |
|---|---|
| Neon bars | cyan→magenta gradient bars with falling peak caps |
| Waveform minimal | single filled waveform line, quiet type |
| Cover focus | the song cover on a blurred backdrop, ringed by a spectrum |
| Studio meters | dark panel, L/R level meters, engineering readout |
| **Winamp classic** | the green→yellow→red analyser ramp on black, white peak caps |
| **Coca-Cola winter** | holiday red gradient, white "dynamic ribbon" wave |
| **YouTube EDM** | magenta/cyan mirrored bars + bloom over a blurred cover |
| **Track Nation** | smooth breathing orb on a heavily blurred cover, minimal type |
| **Winamp base** | the authentic base-skin chrome (bundled art) with a live analyzer, elapsed time, title marquee and duration |
| **Spotify TV** | the brand spec as a preset: `rgba(255,255,255,0.08)` source chip + clock in a 64px top bar, cover left, 64px bold title over 36px artist, progress-only bar in `#1DB954` between `#B3B3B3` timestamps, backdrop from `#121212` up into an artwork-tinted `{dynamic}` |

Plus a **generated** set: every one of the 14 palettes is paired with one of
four layouts (*bar wall*, *orb*, *ring*, *pulse*) — e.g. `Sunset orb`,
`Ocean ring`, `Miami pulse` — and every colour in them is a palette role, so
switching palette re-themes them instantly. `Cover radial` uses the **From
cover** palette and the `cover` component, so it always matches the artwork.

And a **themed** set of 20 — each one a deliberate pairing of layout, effects
and a palette that makes the name make sense. Colours are role tokens, so any
of them can be re-themed from the palette picker without losing its structure:

| theme | palette | idea |
|---|---|---|
| Mario Party | Candy | chunky pill bars with a glass-floor reflection, confetti sparks, big bold type |
| Halloween Spook | Ember | cover disc ringed by sparse bars, rising embers, dimmed backdrop, letter-spaced caps |
| Paris Vibes | Pastel | thin centered bars over a heavily blurred cover, hairline progress, italic light type |
| Tokyo Neon | Neon | 4-ring orb, per-ring palette colours, heavy bloom, wide letter-spaced type |
| Midnight Jazz | Mono | single crisp waveform with a whisper of fill, hairline level meter, no glow |
| Cyber Grid | Cyberpunk | LED circle segments on a palette ramp, heavy peaks, squared-off progress |
| Deep Ocean | Ocean | 3-ring orb with strong angle smoothing and a filled inner disc, drifting snow |
| Forest Calm | Forest | spectrum curve over a soft fill, slow decay, floating dust, quiet type |
| Candy Pop | Candy | mirrored centered bars, beat flare in the middle |
| Golden Hour | Gold | cover ring beside centered bars, warm embers, blurred backdrop |
| Ice Cold | Ice | very thin bars with reflection, heavy snowfall, hairline progress |
| Volcanic | Ember | tall reveal-gradient bars under 150 rising ember sparks, hot uppercase title |
| Miami Vice | Miami | mirrored bars + reflection over a palette ramp, wide-tracked synth type |
| Retro Arcade | Retro | half-square LED segments, sharp attack, beat meter, no shadows |
| Space Odyssey | Deep Space | text-free: 5 palette rings starting at 90° around a glowing core, starfield |
| Sunset Drive | Sunset | gradient waveform loop from 30° around the cover, centred type |
| Neon Noir | Mono | pure black, thin spectrum curve, soft grey beat flare, hairline progress |
| Winter Wonderland | Ice | 200 snow particles over centered bars on a blurred backdrop |
| Latin Heat | Miami | bass-heavy bars with reflection, 120 mixed-shape sparks, glowing title |
| Chill Lounge | Pastel | 2-ring orb with strong smoothing, one hairline meter, minimal type |

Regenerate the generated set after touching palettes or layouts:

```bash
node tools/generate-presets.mjs   # rewrites presets/default/<palette>-*.json + cover-radial/orb + index.json
```

Hand-authored defaults live beside them in `presets/default/*.json` — edit by
hand or re-export from the Studio; the tool never touches them.

**[`PRESET_SPEC.md`](PRESET_SPEC.md)** is the full preset format contract:
file shape, colour tokens, palettes and embedded `roles`, text patterns,
geometry, every component and prop, plus recipes and authoring rules. Its
component tables are generated from the schema (`npm run spec`), so the spec
cannot drift from the code.

**[`COMPONENT_SPEC.md`](COMPONENT_SPEC.md)** is the design doc for the proposed
component set plus the cross-cutting work — audio-reactivity bindings, `group`,
stereo input. `dotmatrix`, `rays` and `terrain` are implemented; the rest
is still design.

## How the split works

The engine **never draws**. Per frame it:

1. analyses the audio it was fed (Hann window → 2048-point FFT → 64 log bands,
   RMS per band with a mild high-shelf tilt, per-band smoothing, bass/mid/treble
   levels, spectral-flux kick onset + tempo),
2. walks the scene (the preset's component list) and lays everything out,
3. resolves `{variable}` patterns into concrete strings,
4. writes a flat list of **draw commands** (24 floats each) plus a string pool.

The backend then interprets those commands. `js/renderer.js` is ~250 lines of
`switch`; the Android backend would be the same switch against
`android.graphics.Canvas`. That is what keeps the two platforms honest.

## Preset format

A preset is plain JSON and is the only contract between the editor, the engine
and any future Android client:

```json
{
  "version": 1,
  "name": "Neon bars",
  "palette": "Neon",
  "components": [
    { "type": "spectrum", "props": { "bars": 48, "roundness": 0.9, "color": "{primary}", "color2": "{secondary}", "peaks": true } },
    { "type": "text",     "props": { "pattern": "{title}", "size": 0.062, "align": 0 } }
  ]
}
```

- `props` keys are the **exact** prop names the engine registers. `vze_prop_id()`
  resolves them, so JS and C++ cannot drift; `test/spa.test.mjs` asserts every
  schema entry and every built-in preset prop resolves.
- `js/presets.js` holds the schema that drives the inspector, so adding a prop
  there exposes it for editing automatically.
- Unknown component types are dropped and missing props are filled from the
  schema defaults when a preset is loaded.
- Default presets live as files in `presets/default/` (plus `index.json`,
  the manifest the SPA fetches) — never embedded in code. `test/spa.test.mjs`
  loads the same files, so the files and the SPA cannot drift.

### Component types

| type | what it is | notable props |
|---|---|---|
| `background` | solid / gradient / image backdrop | `mode`, `color`, `color2`, `gradientAngle`, `image`, `fit`, `blur`, `dim`, `pulseAmount` (image zoom + dip with the beat) |
| `dotmatrix` | LED dot-grid equalizer, one column per band | `cols`, `rows`, `cellShape`, `gap`, `dimColor`, `dimOpacity`, `quantize` |
| `rays` | sunburst spokes radiating from the centre | `count`, `innerRadius`, `length`, `taper`, `spin`, `spinBeat`, `arcStart`, `arcSpan`, `mirror` |
| `terrain` | 3D spectrum mountains: history rows under an orbiting camera | `terrainRows`, `terrainBands`, `rowIntervalMs`, `flow`, `heightScale`, `floorDb`, `tilt`, `rowSmooth`, `widthTaper`, `pitch`, `fov`, `distance`, `lookY`, `pitchBass`, `zoomBeat`, `rotateMode`, `yawSpeed`, `yawBeat`, `avoidEdgeOn`, `occlude`, `floorGrid`, `colorBy`, `heightGlow` |
| `spectrum` | FFT bars with optional falling peaks | `bars`, `gap`, `barWidth`, `roundness`, `gradientMode` (stretch/reveal/palette), `colorMode` (manual/random/palette/complementary/cover), `segmentShape`, `segmentGap`, `reflection` (glass floor), `peaks`, … |
| `line` | waveform (centered) or spectrum curve (mirrored band), smoothed + line glow | `lineMode`, `linePoints`, `strokeWidth`, `glow`, `smoothing`, `gain`, `fill` |
| `text` | bound text | `pattern`, `size`, `weight`, `align`, `valign`, `color`, `shadow*`, `letterSpacing`, `uppercase`, `marquee` |
| `image` | cover art / artwork | `image`, `fit`, `cornerRadius`, `circle`, `blur`, `flipX/flipY`, `tint` |
| `cover` | cover art ringed by a radial spectrum, with glow + beat pulse | `image`, `coverScale`, `cornerRadius`, `circle`, `blur`, `radialBars`, `mirror`, `ringRadius`, `radialLength`, `radialGap`, `arcStart`, `arcSpan`, `radialGain`, `radialSmoothing`, `radialDecay`, `radialPeaks`, `glow`, `haloColor`, `pulseAmount` |
| `orb` | cover art ringed by glow spectrum lines, with halo + beat pulse | `image`, `coverScale`, `circle`, `cornerRadius`, `rings`, `mirror`, `arcStart`, `angularSmooth`, `reflection`, `linePoints`, `ringRadius`, `gap`, `radialLength`, `thickness`, `gain`, `smoothing`, `decay`, `color`, `color2`, `paletteRings`, `fillColor`, `fillOpacity`, `glow`, `haloColor`, `pulseAmount`, `coreSize` |
| `shape` | panel, divider, disc | `shape`, `filled`, `cornerRadius`, `strokeWidth`, `gradient` |
| `meter` | level / progress bar or ring | `source`, `direction`, `thickness`, `trackColor`, `trackOpacity` |
| `progress` | song progress bar bound to the track position | `color`, `color2`, `gradient`, `trackColor`, `trackOpacity`, `cornerRadius`, `glow` |
| `radial_line` | circular waveform / spectrum line with glow | `lineMode`, `linePoints`, `strokeWidth`, `gain`, `smoothing`, `mirror`, `ringRadius`, `radialLength`, `pulseAmount`, `glow` (0 = single crisp loop) |
| `particles` | embers / snow / dust / stars / beat sparks / tunnel, in circles, squares, triangles, lines, hearts or mixed | `mode`, `shape`, `rotation`, `count`, `size`, `sizeVar`, `speed`, `sway`, `gravity`, `twinkle`, `beatBoost`, `colorMode` (manual/random/palette/complementary/cover) |
| `beat` | outline rings that fire on the beat (true circles inscribed in the box) | `rings`, `pulseMin`, `pulseMax`, `thickness` |
| `beat_glow` | bloomed orb that flares on the beat ("Track Nation" look) | `intensity`, `haloSize`, `haloOpacity`, `coreSize`, `bloom`, `follow`, `haloColor` |

`beat_glow` draws two additive radial falloffs — a wide soft halo and a tight
bright core — that scale with the beat phase blended against a bass follower
(`follow`: `0` = beat phase only, `1` = smooth level). It is the only component
that uses the `radialGlow` opcode.

`cover` is the "now playing" hero: the artwork (with `cornerRadius` or a
`circle` mask) centred inside a ring of `radialBars` spectrum bars, a soft
additive glow and a beat pulse. The bars are emitted as four-point polygons, so
it too needs no new opcode — the Canvas2D and Android backends are unchanged.
The bar ring spans `arcSpan` degrees starting at `arcStart` (0 = top,
clockwise), and everything scales with the beat by `pulseAmount`.

Spectrum gradients come in three modes (`gradientMode`): **stretch** paints
every bar with the full color→color2 range (the classic look); **reveal** fixes
the ramp to the component box so short bars stay dark at the bottom;
**palette** runs the whole palette (`bg`→`surface`→`primary`→`secondary`→
`accent`→`text`) up the box the same way. Bars can also be **segmented** LED-style (`segmentShape`: circles, squares or
half squares, `segmentGap` as a fraction of the segment size): the segment
size auto-fits to the bar width (squares stay square, circles stay round) and
the count is whatever fits; each lit segment takes the ramp color at its own
height.

**Tilt.** Music energy falls off with frequency (~3 dB/oct, pink-ish), so a
plain linear band mapping leaves the treble half of every spectrum looking dead.
`tilt` is a per-component spectral tilt in **dB per octave**, applied to the
band values *before* `gain`, referenced to 1 kHz so the midrange stays put:
`tilt: 3` is 0 dB at 1 kHz, +9 dB at 8 kHz, −12 dB at 125 Hz. It is available
on every component that reads the spectrum — `spectrum`, `line` (spectrum
curve), `radial_line`, `dotmatrix`, `rays`, `cover`, `orb` — and defaults to 0,
so no existing preset changes. Note it stacks on top of the mild linear
high-shelf the analyser already applies internally (0.75 → 1.25 across the band
range).

`peaks` draw a cap per bar: it snaps up with the bar, sits still for
**Peak stop delay** (`peakDelay`, seconds) once the bar drops below it, then
falls at `peakFall`. Caps are emitted in a pass after every bar and are never
allowed below their own bar tip, so a cap can no longer be swallowed by a
taller neighbour — `peakGap` lifts them clear if you want visible daylight.
`cover` radial bars share `peakDelay`/`peakGap`.

`orb` is the same idea with glow spectrum *lines* instead of bars: `rings`
closed loops whose radius follows the audio, each drawn as three stacked
strokes (core + two soft falloffs) for a neon bloom with no backend blur, a
halo behind everything, and the cover art (or a glow core with no art) in the
middle. `gap` spaces the rings, `radialLength` sets the wave height,
`thickness` the line width, `arcStart` rotates the display, `angularSmooth`
blurs each ring across its neighbours so bands never spike sharp.
`paletteRings` gives every ring one solid palette role (vivid first) instead
of the two-colour gradient across rings; `fillColor`/`fillOpacity` paint a
solid disc out to the innermost ring; `reflection` adds one faded flipped copy
below the box (glass floor). The `Orb` preset is orb-only — no text or meters —
which is the intended look for the app's immersive Built in visualiser mode.

All three radial types (`cover`, `orb`, `radial_line`) have a `mirror` switch
that folds the spectrum symmetric about the vertical centre (mirrored orb
rings also hold their slow drift still so the symmetry stays put). The radial
line draws one continuous Catmull-Rom loop by default — a single stroke, no
joints; `glow` adds the stacked bloom passes back, and only gradient loops
need arc segments.

## Colour palettes

A preset names its palette; the palette defines six **roles** — `bg`,
`surface`, `primary`, `secondary`, `accent`, `text`. The host publishes every
role as an engine variable, and any colour prop may bind to a role with a
`{token}`:

```json
{ "palette": "Ocean",
  "components": [
    { "type": "spectrum", "props": { "color": "{primary}", "color2": "{secondary}" } }
  ] }
```

Switching the palette in the Palette panel re-themes the whole preset live — no
reload — because the engine resolves the tokens at draw time (`colorOf()` runs
the same `{token}` substitution as text patterns).

There is a seventh role, **`{dynamic}`**, and it is *not* part of any palette: it
is published for every preset and always follows the current artwork (the
dominant cover colour mixed down to ~30% lightness, via `shadeToLightness`).
That lets a preset keep fixed brand colours while tinting its backdrop from the
artwork — the **Spotify TV** preset is exactly that: brand green `#1DB954` and
`#B3B3B3` type stay put, the top of the backdrop gradient is `{dynamic}`.

A preset can also **embed its own palette** with a `roles` block, which
overrides individual roles and inherits the rest from `palette`:

```json
{ "name": "House style", "palette": "Ocean", "roles": { "primary": "#1DB954" } }
```

In the Studio, choose **Custom (this preset)** in the Palette panel to freeze
the palette into the preset; the swatches then become colour pickers that write
straight back into it. Picking a named palette drops the block again.

`js/palettes.js` ships 14 ready-made palettes (Neon, Sunset, Ocean, Forest,
Mono, Candy, Retro, Miami, Gold, Ice, Ember, Cyberpunk, Pastel, Deep Space).
The special **From cover** palette is derived from the current track artwork:
the cover bitmap is downsampled, quantised into clusters and mapped to roles
(most vibrant → `primary`, next distinct hue → `secondary`, brightest remaining
→ `accent`, darkest cluster → `bg`, a dark tone → `surface`). It re-extracts
automatically whenever new cover art loads.

In the inspector every colour prop has a role dropdown next to its swatch:
pick a role and the prop stores the token (the swatch greys out because the
palette drives it); pick **Manual** to type a hex as before.

### The `{cover}` token

Any `image` prop may be the literal string `{cover}` instead of an id. The
engine resolves it at draw time to whatever the host registered with
`vze_cover_set()`, so a preset can use the current track's artwork without
knowing an id and automatically follows the track:

```json
{ "type": "background", "props": { "mode": 2, "image": "{cover}", "blur": 40, "dim": 0.66 } }
```

In the SPA, image id **1** is reserved for the cover. It is populated from:

1. **the loaded audio file's embedded artwork** — `extractEmbeddedCover()` reads
   the first ID3v2 picture frame (v2.2 `PIC`, v2.3 and v2.4 `APIC`) straight
   from the file's tag. It is fire-and-forget, so a missing or malformed tag
   never delays playback.
2. **the cover-art URL box** in the Images panel.

Bundled artwork with **fixed numeric ids** (`assets/`, e.g. id `10` = the
Winamp base skin) lets built-in presets reference real images portably: the
SPA fetches them at boot (`BUNDLED_IMAGES` in `main.js`), the app decodes them
from `assets/studio/assets` (`VizBundledImages`), and presets just use
`"image": "10"`.

Uploaded images start at id 2 and are picked from a dropdown in the inspector.

Loading an audio file also reads its **ID3v2 text frames** (`TIT2` title,
`TPE1` artist, `TALB` album, `TRCK`, `TCON`, `TDRC`/`TYER` year — v2.2 aliases
included, latin1/UTF-16/UTF-8 all honoured), then the **ID3v1 trailer** as a
fallback, and only then the `Artist - Title` file-name split. The Engine
variables panel is seeded from the tags, so `{title}`/`{artist}` show the real
track instead of the file name.

Every component also has `x`, `y`, `w`, `h` (normalised to the surface) and
`opacity`. Gradient angle convention: `0` = bottom→top, `90` = left→right,
`180` = top→bottom.

## Engine variables

The engine publishes values that presets consume inside `{...}` tokens. Text
components are the main consumer today.

| provided by the host | provided by the engine |
|---|---|
| `title`, `artist`, `album`, `station`, `controller` | `bpm`, `rms`, `peak`, `bass`, `mid`, `treble` |
| `clock`/`time`, `date` | |
| `position`, `duration`, `remaining`, `playing`, `source` | |
| `positionSec`, `durationSec` (numeric, seconds) | |

`positionSec`/`durationSec` are published with `vze_var_set_number()` alongside
the `m:ss` strings and drive the `progress` component (the `meter` component
still reads live audio levels only).

The host publishes them with `vze_var_set()`; the engine substitutes them when
it resolves a text pattern. An unknown `{token}` is left untouched, so literal
braces still work.

The **Engine variables** panel under the transport edits the host-provided
values (title/artist/album/station/controller) live, and shows a readout of the
values the engine currently holds. The stage column scrolls, so the panel is
always reachable even on short windows.

## Custom fonts

Text components carry a per-component `font` prop. Ten free families are
bundled and served locally (no Google Fonts runtime dependency):

Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Oswald, Raleway, Nunito,
Playfair Display — weights 300/400/700 (Playfair 400/700).

- web: `fonts/files/*.woff2` (latin + latin-ext) + `fonts/fonts.css`; refresh
  with `node tools/fetch-fonts.mjs`
- the engine passes the family name through the text command (pool offset in
  the spare `R2`/`G2` slots); each backend resolves it — Canvas2D via the
  loaded webfonts, Android via `assets/fonts/*.ttf` (`VizFonts`)
- unknown/empty family = backend default stack, so old presets render as before

## Editing

- click a component to select, drag to move, corner/edge handles to resize
- `ctrl`/`cmd`+click toggles extra components into the selection; dragging any
  of them moves the whole group, arrows nudge all, `Del` removes all
- `shift`+corner keeps the aspect ratio, arrows nudge, `Del` removes,
  `Cmd/Ctrl+D` duplicates, `Cmd/Ctrl+[` and `]` change the z-order, `E` toggles
  the overlay, `space` plays/pauses
- the inspector is generated from the schema; edits are pushed into the WASM
  engine immediately, so the preview updates while you drag a slider
- every slider has a numeric input for exact values (comma decimals accepted);
  canvas drags/resizes push live geometry back into the inspector
- layers list rows have Hide/Show eye toggles (hidden keeps its engine index)
  and can be dragged to reorder
- colour props carry a role dropdown (bind to `{primary}` etc.) and a manual
  swatch; the Palette panel switches the preset's palette live
- drag & drop works: an image registers a new image id, an audio file loads it,
  and a `.json` loads as a preset
- **Save** overwrites the current preset in place, **Save as…** always asks for
  a name first, **Rename…** moves one of your presets to a new name (with
  overwrite confirm); all three write to the TV app, and refuse loudly when
  it is unreachable — nothing is ever written to browser storage. The picker groups
  entries into **Default presets** (pristine seeds — Rename stays disabled
  there, use Save as… to copy one) and **My presets** (device saves,
  including seeds you overwrote). Deleted defaults stay
  deleted on the device; exports/imports are plain `.json`
- **Manage…** opens a tick list of every preset (grouped Default / My) with
  **Remove selected** and **Restore defaults** — this is how you prune the
  shipped set down to what you actually want. Removing a default writes a
  tombstone on the device, so it stays gone; Restore defaults clears them.

## Tests

`./test/run.sh` runs three layers:

1. `node --check` on every JS module (cheap, catches broken edits immediately)
2. `engine/test/test.cjs` — FFT band mapping against known tones, level
   detection, command emission, `{variable}` binding, silence decay
3. `test/spa.test.mjs` — every schema/preset prop resolves in the engine, the
   Canvas2D backend renders a real frame for every built-in preset (against a
   recording stub context), live edits reach the engine, and preset
   normalisation/JSON round-trip

## Android app

The engine is ported, not rewritten. `visualizer/engine/src/vze.cpp` compiles
verbatim into `libjniwrapper` (`app/src/main/cpp/CMakeLists.txt` points
`VZE_SRC` at it; `vze-jni.cpp` marshals the same C ABI), and three Kotlin files
mirror the web modules:

- `matrix/VizEngine.kt` ↔ `js/engine.js` (preset JSON in, commands out)
- `matrix/VizRenderer.kt` ↔ `js/renderer.js` (opcodes → `android.graphics.Canvas`)
- `matrix/VizView.kt` — software `View` hosting the engine on the Play Now
  screen, fed by `AppVizAudioFeed` with track variables from the DLNA service
  and cover roles from `MatrixCoverPalette`

`OP_IMAGE` blur is a true gaussian on web (native `ctx.filter`, same engine as
CSS backdrop blur; progressive-downscale + 3-pass box gaussian on older
browsers) and a progressive-halving pyramid on Android (no `RenderEffect`, so
it works on every API level); fonts come from `assets/fonts/*.ttf`
(`matrix/VizFonts.kt`).

When the pack is `builtin`, `NowPlayingScreen` goes fully immersive: the top
bar (controller/volume/clock/date), bottom cover/title/artist/controls, the
gradient/vignette overlays, volume popup, FPS and preset-name readouts are all
hidden — the Studio preset is the whole screen. Remote keys still work blind.

### Built in visualiser pack

The App Viz pack selector has a **Built in visualiser** entry (`builtin`):
`VizPresets` seeds it from `assets/studio/presets/default/*.json` (copied from
`visualizer/presets/default/` by `tools/sync-android-assets.sh`), and presets
authored in the Studio land in `filesDir/viz-presets` and shadow same-named
seeds. When the pack is selected, `/api/status` lists the Studio presets in
`appVizPresets` and the App Viz dropdown shows them.

### Studio served from the app

`WebInterfaceServer` serves the whole Studio from `assets/studio` at
`http://<tv>:8092/studio/` (same SPA, wasm + fonts included) plus:

- `GET /api/viz-presets` — Studio preset names on the device (`?full=1` adds
  the full JSON dump plus the `user` list the Studio boots from)
- `POST /api/viz-preset` (`action=save&json=…` / `action=delete&name=…` /
  `action=restore`)
- `POST /api/viz-test` (`name=…`) — headless 6-frame render check, returns the
  peak command count; exercises JNI + engine + Canvas backend without UI

In the Studio, **Save**/**Save as…** write straight to the device (same origin
when opened via `/studio/`); on a desktop dev server they fall back to
browser storage with a status note.

When the Studio changes, re-sync it into the APK (the device serves a frozen
copy — without this step your changes will not show up on the TV):

```bash
visualizer/tools/sync-android-assets.sh   # index.html + css/js/wasm/fonts/presets -> assets/studio
```

## Known gaps / next steps

- image blur on very old GPUs is a downscale approximation, not a true gaussian
- the `progress` bar is horizontal left-to-right only; no vertical/ring variant
- no preset cross-fade when switching; presets hard-cut
