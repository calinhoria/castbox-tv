// DOM-free integration test for the browser side.
//
//   node test/spa.test.mjs /tmp/vze_node_test.js
//
// Verifies the three things that can silently rot when the SPA and the
// WebAssembly core are edited independently:
//   1. every prop used by the schema / presets exists in the engine registry
//   2. the Canvas2D backend can execute a real frame from every built-in preset
//   3. preset normalisation fills defaults and drops unknown component types
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modulePath = process.argv[2];
assert.ok(modulePath, 'usage: node test/spa.test.mjs <path-to-node-built-vze.js>');

const factory = require(modulePath);
const { VizEngine } = await import('../js/engine.js');
const { CanvasBackend, OP, F } = await import('../js/renderer.js');
const P = await import('../js/presets.js');
const PAL = await import('../js/palettes.js');

// Default presets live on disk (presets/default/*.json), never in code —
// load them with fs so the test cannot drift from what ships.
function loadDefaultPresets() {
  const dir = new URL('../presets/default/', import.meta.url);
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    out.push(P.normalizePreset(JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'))));
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}
const BUILTINS = loadDefaultPresets();
assert.ok(BUILTINS.length >= 20, 'expected the default preset folder, got ' + BUILTINS.length);
const NEON = BUILTINS.find((p) => p.name === 'Neon bars');
assert.ok(NEON, 'Neon bars must ship as a default');

// The 20 themed presets: the Studio ships them as defaults and the user prunes
// the ones they do not want from Manage presets.
const THEME_NAMES = new Set([
  'Mario Party', 'Halloween Spook', 'Paris Vibes', 'Tokyo Neon', 'Midnight Jazz',
  'Cyber Grid', 'Deep Ocean', 'Forest Calm', 'Candy Pop', 'Golden Hour',
  'Ice Cold', 'Volcanic', 'Miami Vice', 'Retro Arcade', 'Space Odyssey',
  'Sunset Drive', 'Neon Noir', 'Winter Wonderland', 'Latin Heat', 'Chill Lounge',
]);
const palNames = new Set(PAL.paletteNames().concat([PAL.FROM_COVER]));

// --- canvas stub: records calls; the renderer must only use these members
function stubContext() {
  const calls = [];
  const rec = (name) => () => { calls.push(name); };
  return {
    calls,
    canvas: { width: 1280, height: 720 },
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    strokeStyle: '', fillStyle: '', shadowBlur: 0, shadowColor: '',
    font: '', textAlign: 'left', textBaseline: 'alphabetic', letterSpacing: '0px',
    setTransform: rec('setTransform'), clearRect: rec('clearRect'), fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'), setLineDash: rec('setLineDash'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'),
    rect: rec('rect'), arc: rec('arc'), ellipse: rec('ellipse'),
    fill: rec('fill'), stroke: rec('stroke'), clip: rec('clip'),
    save: rec('save'), restore: rec('restore'),
    drawImage: rec('drawImage'), fillText: rec('fillText'),
    createLinearGradient: () => ({ addColorStop: rec('addColorStop') }),
    createRadialGradient: () => ({ addColorStop: rec('addColorStop') }),
    measureText: (t) => ({ width: String(t).length * 9 }),
  };
}

const M = await factory();
const engine = new VizEngine(M);
engine.setSurface(1280, 720);
engine.setAudioRate(44100);
const log = console.log;

// ---------------------------------------------------------------------------
log('\n[1] schema + preset props resolve in the engine registry');
// ---------------------------------------------------------------------------
let checked = 0;
for (const [type, schema] of Object.entries(P.SCHEMAS)) {
  for (const prop of schema) {
    assert.notStrictEqual(engine.propId(prop.key), -1,
      'prop "' + prop.key + '" (schema: ' + type + ') is unknown to the engine');
    checked++;
  }
}
log('    schema props            : ' + checked + ' ok');

let presetProps = 0;
for (const preset of BUILTINS) {
  for (const c of preset.components) {
    assert.ok(P.SCHEMAS[c.type], 'unknown component type in preset: ' + c.type);
    for (const [k, v] of Object.entries(c.props)) {
      assert.notStrictEqual(engine.propId(k), -1,
        'preset "' + preset.name + '" uses prop "' + k + '" the engine does not know');
      assert.ok(['string', 'number', 'boolean'].includes(typeof v),
        'prop ' + k + ' must be a primitive, got ' + typeof v);
      presetProps++;
    }
  }
}
log('    built-in preset props   : ' + presetProps + ' ok');

// ---------------------------------------------------------------------------
log('\n[2] every built-in preset renders a real frame');
// ---------------------------------------------------------------------------
const window_ = new Float32Array(2048);
for (let i = 0; i < 2048; i++) {
  const t = i / 44100;
  window_[i] = 0.6 * Math.sin(2 * Math.PI * 220 * t) * Math.exp(-(i / 2048) * 3);
}

for (const raw of BUILTINS) {
  const preset = P.normalizePreset(raw);
  engine.loadPreset(preset);
  engine.setVar('title', 'Blue Monday');
  engine.setVar('artist', 'New Order');

  const ctx = stubContext();
  const backend = new CanvasBackend({ width: 1280, height: 720, getContext: () => ctx }, engine);

  let maxCmds = 0;
  for (let frame = 0; frame < 6; frame++) {
    engine.pushAudio(window_);
    engine.setVar('clock', '21:04');
    engine.setVar('position', '0:42');
    engine.setVar('duration', '7:31');
    engine.frame(16.7);
    backend.render();          // must not throw
    maxCmds = Math.max(maxCmds, backend.lastStats.commands);
    engine.flushMeasures();
  }
  assert.ok(maxCmds > 3, 'preset "' + preset.name + '" produced almost no draw commands');
  log('    ' + (preset.name + '                    ').slice(0, 20) + ': ' +
      String(maxCmds).padStart(5) + ' cmds, ' +
      String(ctx.calls.length).padStart(6) + ' canvas calls');
}

// ---------------------------------------------------------------------------
log('\n[3] an interactive edit reaches the engine');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset(NEON));
const textIndex = NEON.components.findIndex((c) => c.type === 'text');
assert.ok(engine.setProp(textIndex, 'pattern', '{artist} — {album}'), 'setProp pattern');
assert.ok(engine.setProp(textIndex, 'size', 0.09), 'setProp size');
assert.ok(engine.setProp(textIndex, 'align', 2), 'setProp align');
engine.setVar('artist', 'Joy Division');
engine.setVar('album', 'Closer');
engine.pushAudio(window_);
engine.frame(16.7);

const cmds = engine.commands();
let text = '';
for (let i = 0; i < cmds.count; i++) {
  const o = i * cmds.stride;
  if (cmds.data[o + F.OP] === OP.TEXT && cmds.data[o + F.STRLEN] > 0) {
    text = engine.string(cmds.data[o + F.STROFF], cmds.data[o + F.STRLEN]);
    break;
  }
}
assert.strictEqual(text, 'Joy Division — Closer', 'edited text component should render the new pattern');
log('    live text component     : "' + text + '"');

// ---------------------------------------------------------------------------
// A tone in the low bands AND one at 8 kHz, so both ends have real energy and
// the tilt can be measured band by band.
const twoTone = new Float32Array(2048);
for (let i = 0; i < 2048; i++) {
  twoTone[i] = 0.5 * Math.sin(2 * Math.PI * 80 * i / 44100) +
               0.5 * Math.sin(2 * Math.PI * 8000 * i / 44100);
}
// Orientation: near rows must sit LOW on screen, far rows rise to the horizon.
// (Screen y grows downward, so the nearest row has the LARGEST mean y.)
{
  const rows = (over) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'terrain orientation',
      components: [{ type: 'terrain', props: Object.assign(
        { terrainRows: 16, terrainBands: 32, rowIntervalMs: 40, pitch: 35,
          rotateMode: 0, yawStart: 0, lookY: 0, gain: 30, tilt: 0,
          smoothing: 0, decay: 0, depthFade: 0, x: 0, y: 0.05, w: 1, h: 0.9 }, over || {}) }],
    }));
    for (let f = 0; f < 40; f++) { engine.pushAudio(window_); engine.frame(16.7); }
    const c = engine.commands();
    const pts = Array.from(engine.points());
    const out = [];
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      if (c.data[o + F.OP] !== OP.POLYGON || c.data[o + F.P2] <= 0) continue;
      const n = c.data[o + F.P0] | 0, off = (c.data[o + F.P1] | 0) * 2;
      let sum = 0, lo = Infinity, hi = -Infinity;
      for (let q = 0; q < n; q++) {
        const y = pts[off + q * 2 + 1];
        sum += y;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      out.push({ mean: sum / n, lo, hi });
    }
    return out;
  };

  const r = rows({});
  assert.ok(r.length === 16, '16 row polylines, got ' + r.length);
  // Drawn back to front, so the LAST one drawn is the nearest (newest) row.
  const far = r[0], near = r[r.length - 1];
  assert.ok(near.mean > far.mean + 5,
    'nearest row sits lower than the far row (near ' + near.mean.toFixed(0) +
    ' vs far ' + far.mean.toFixed(0) + ')');
  // And the terrain rises as it recedes, monotonically enough to read as ground.
  const rising = r.slice(0, 8).every((row, i) => i === 0 || row.mean < r[i - 1].mean + 40);
  assert.ok(rising, 'rows rise toward the horizon rather than flipping');

  // Height must push peaks UP the screen (smaller y), not down.
  const low = rows({ heightScale: 0.2 });
  const high = rows({ heightScale: 1.4 });
  const minOf = (a) => Math.min(...a.map((x) => x.lo));
  assert.ok(minOf(high) < minOf(low) - 5,
    'taller terrain reaches higher on screen: ' + minOf(low).toFixed(0) +
    ' -> ' + minOf(high).toFixed(0));
  log('    orientation: near row y ' + near.mean.toFixed(0) + ' below far row y ' +
      far.mean.toFixed(0) + ', peaks grow upward');
}

log('\n[3y] terrain: history rows, camera projection, occlusion, clipping');
// ---------------------------------------------------------------------------
{
  const terrainProbe = (over, frames) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'terrain probe',
      components: [{ type: 'terrain', props: Object.assign(
        { terrainRows: 24, terrainBands: 40, rowIntervalMs: 45, x: 0, y: 0.05, w: 1, h: 0.9,
          gain: 30, tilt: 0, smoothing: 0, decay: 0, rotateMode: 0 }, over || {}) }],
    }));
    for (let f = 0; f < (frames || 12); f++) { engine.pushAudio(window_); engine.frame(16.7); }
    const c = engine.commands();
    const pts = Array.from(engine.points());
    let strokes = 0, fills = 0, clips = 0, nPts = -1;
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      if (c.data[o + F.OP] === OP.CLIP_PUSH) clips++;
      if (c.data[o + F.OP] === OP.CLIP_POP) clips++;
      if (c.data[o + F.OP] !== OP.POLYGON) continue;
      if (c.data[o + F.P2] > 0) { strokes++; nPts = c.data[o + F.P0]; } else fills++;
    }
    return { strokes, fills, clips, nPts, c, pts };
  };

  const t = terrainProbe({});
  assert.strictEqual(t.strokes, 24, 'one stroked polyline per row, got ' + t.strokes);
  assert.strictEqual(t.nPts, 40, 'each row is terrainBands points, got ' + t.nPts);
  assert.strictEqual(t.clips, 2, 'clipped to the box (push + pop), got ' + t.clips);
  assert.strictEqual(t.fills, 0, 'occlude off by default');
  // The point pool is shared, so the whole terrain must fit it.
  assert.ok(t.strokes * t.nPts <= 8192,
    'terrain fits the point pool: ' + t.strokes * t.nPts + ' of 8192');

  // Occlusion adds one filled polygon per row.
  const occ = terrainProbe({ occlude: true });
  assert.strictEqual(occ.fills, 24, 'occlude fills every row, got ' + occ.fills);
  assert.strictEqual(occ.strokes, 24, 'and still strokes every row');
  assert.ok(occ.strokes * (occ.nPts + 2) <= 8192, 'occluded terrain still fits the pool');

  // Rows grow over time as the history fills (silence must NOT freeze it).
  // The history is engine-wide and survives preset changes, so reset first:
  // earlier blocks have already rendered terrain presets and filled it.
  engine.reset();
  const early = terrainProbe({}, 3);
  const later = terrainProbe({}, 40);
  // Total vertical extent summed per row: unfilled rows are flat (zero), so
  // this measures how much of the grid has real content yet.
  const ink = (r) => {
    let total = 0;
    for (let s = 0; s < r.strokes; s++) {
      let lo = Infinity, hi = -Infinity;
      for (let q = 0; q < r.nPts; q++) {
        const y = r.pts[(s * r.nPts + q) * 2 + 1];
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      total += hi - lo;
    }
    return total;
  };
  assert.ok(ink(later) > ink(early) * 1.5,
    'terrain fills in as history accumulates: ' + ink(early).toFixed(0) +
    ' -> ' + ink(later).toFixed(0));

  // Rotation actually moves the camera: yaw 0 and yaw 90 must differ.
  const y0 = terrainProbe({ rotateMode: 0, yawStart: 0 });
  const y90 = terrainProbe({ rotateMode: 0, yawStart: 90 });
  let moved = false;
  for (let i = 0; i < 400 && !moved; i++) moved = Math.abs(y0.pts[i] - y90.pts[i]) > 2;
  assert.ok(moved, 'yaw 90 projects differently from yaw 0');

  // avoidEdgeOn eases through the edge-on angle rather than stalling.
  const spin = terrainProbe({ rotateMode: 1, yawSpeed: 90, avoidEdgeOn: true }, 30);
  assert.ok(spin.strokes === 24, 'edge-on guard keeps drawing every row');

  // Oversized requests clamp instead of shearing the geometry.
  const huge = terrainProbe({ terrainRows: 128, terrainBands: 192, occlude: true });
  assert.ok(huge.strokes > 0 && huge.strokes <= 128, 'rows clamp to the pool, got ' + huge.strokes);
  assert.ok(huge.strokes * (huge.nPts + 2) <= 8192,
    'clamped terrain fits: ' + huge.strokes + ' x ' + (huge.nPts + 2));
  log('    terrain: ' + t.strokes + ' rows x ' + t.nPts + ' pts, occlude +' +
      occ.fills + ' fills, clamps to ' + (huge.strokes * (huge.nPts + 2)) + ' pts');
}

log('\n[3x] spectral tilt lifts the treble before gain');
// ---------------------------------------------------------------------------
{
  // Returns the bar heights (emitted left-to-right, one rect per bar).
  const tiltBars = (over) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'tilt probe',
      components: [{ type: 'spectrum', props: Object.assign(
        { bars: 64, x: 0.02, y: 0.1, w: 0.96, h: 0.8, gain: 6, logScale: false,
          smoothing: 0, decay: 0, minHeight: 0, maxHeight: 1 }, over || {}) }],
    }));
    for (let f = 0; f < 6; f++) { engine.pushAudio(twoTone); engine.frame(16.7); }
    const c = engine.commands();
    const hs = [];
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      if (c.data[o + F.OP] !== OP.RECT) continue;
      hs.push(c.data[o + F.H]);
    }
    return hs;
  };
  // Bar ~2 sits near 100 Hz, bar ~60 near 12 kHz.
  const lowOf = (hs) => hs[2], highOf = (hs) => hs[60];
  const flat = tiltBars({ tilt: 0 });
  assert.ok(flat.length >= 64, 'one rect per bar, got ' + flat.length);
  assert.ok(lowOf(flat) > 20 && highOf(flat) > 1,
    'both ends have energy to work with: low ' + lowOf(flat).toFixed(0) +
    ', high ' + highOf(flat).toFixed(1));

  const up = tiltBars({ tilt: 6 });
  assert.ok(highOf(up) > highOf(flat) * 1.5,
    '+6 dB/oct lifts the top: ' + highOf(flat).toFixed(1) + ' -> ' + highOf(up).toFixed(1));
  assert.ok(lowOf(up) < lowOf(flat) * 0.75,
    'and pulls the bottom down: ' + lowOf(flat).toFixed(0) + ' -> ' + lowOf(up).toFixed(0));

  const down = tiltBars({ tilt: -6 });
  assert.ok(highOf(down) < highOf(flat), 'negative tilt rolls the top off');
  assert.ok(lowOf(down) > lowOf(flat), 'and lifts the bottom');

  // tilt 0 must be an exact no-op, so no existing preset can change.
  assert.deepStrictEqual(tiltBars({}), flat, 'tilt 0 is a bit-for-bit no-op');

  // Every band-reading component exposes it.
  assert.notStrictEqual(engine.propId('tilt'), -1, 'engine knows tilt');
  for (const t of ['spectrum', 'line', 'radial_line', 'dotmatrix', 'rays', 'cover', 'orb']) {
    assert.ok(P.SCHEMAS[t].some((p) => p.key === 'tilt'), t + ' exposes tilt');
  }
  log('    tilt +6: high ' + highOf(flat).toFixed(1) + '->' + highOf(up).toFixed(1) +
      ', low ' + lowOf(flat).toFixed(0) + '->' + lowOf(up).toFixed(0) +
      ' · 0 is a no-op · 7 components');
}

log('\n[3w] dotmatrix / rays emit their own commands');
// ---------------------------------------------------------------------------
{
  // dotmatrix: dim grid + lit cells, square cells, centred.
  const matrixProbe = (over) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'matrix',
      components: [{ type: 'dotmatrix', props: Object.assign(
        { cols: 10, rows: 6, x: 0.1, y: 0.2, w: 0.8, h: 0.4, gain: 40, logScale: false }, over || {}) }],
    }));
    for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }
    return engine.commands();
  };
  const m = matrixProbe({ cellShape: 0 });
  let dimCells = 0, litCells = 0, rects = 0;
  for (let i = 0; i < m.count; i++) {
    const o = i * m.stride;
    if (m.data[o + F.OP] === OP.RECT) rects++;
    if (m.data[o + F.OP] !== OP.CIRCLE) continue;
    // Dim cells carry dimOpacity (0.07); lit cells are opaque or partially in.
    if (m.data[o + F.A] < 0.5) dimCells++; else litCells++;
  }
  assert.strictEqual(dimCells, 10 * 6, 'dim grid draws every cell, got ' + dimCells);
  assert.ok(litCells > 0, 'lit cells drawn on top of the dim grid, got ' + litCells);
  assert.ok(rects === 0, 'circle cells emit no rects');
  // Cells must be square and the grid centred: with w=1024, h=288 and 10x6 the
  // height is the limit, so the grid is centred horizontally in the box.
  const cells = [];
  for (let i = 0; i < m.count; i++) {
    const o = i * m.stride;
    if (m.data[o + F.OP] === OP.CIRCLE && m.data[o + F.A] < 0.5) {
      cells.push([m.data[o + F.X], m.data[o + F.Y], m.data[o + F.W], m.data[o + F.H]]);
    }
  }
  assert.ok(cells.every((c) => Math.abs(c[2] - c[3]) < 0.01), 'cells are square');
  const minX = Math.min(...cells.map((c) => c[0]));
  const maxX = Math.max(...cells.map((c) => c[0] + c[2]));
  const boxL = 0.1 * 1280, boxR = 0.9 * 1280;
  assert.ok(minX >= boxL - 1 && maxX <= boxR + 1, 'grid fits the box horizontally');
  assert.ok(Math.abs((minX - boxL) - (boxR - maxX)) < 1.5,
    'grid is centred, margins ' + (minX - boxL).toFixed(1) + '/' + (boxR - maxX).toFixed(1));
  log('    dotmatrix: ' + dimCells + ' dim + ' + litCells + ' lit cells, square, centred');

  // Square cells use rects instead.
  const ms = matrixProbe({ cellShape: 1 });
  let sq = 0;
  for (let i = 0; i < ms.count; i++) {
    const o = i * ms.stride;
    if (ms.data[o + F.OP] === OP.RECT && Math.abs(ms.data[o + F.W] - ms.data[o + F.H]) < 0.01) sq++;
  }
  assert.ok(sq >= 60, 'square cells emit square rects, got ' + sq);

  // Peaks land inside the grid and never below their own column's lit cells.
  // Peak caps must stay inside the grid. (A cap legitimately floats above a
  // column that has collapsed — what it must never do is leave the panel.)
const mp = matrixProbe({ peaks: true, peakColor: '#ffffff', peakWidth: 4 });
  const capClearance = (c, peakWidth, growsDown) => {
    const bars = new Map();
    const caps = [];
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      const op = c.data[o + F.OP];
      if (op !== OP.RECT && op !== OP.CIRCLE) continue;
      const col = Math.round(c.data[o + F.X]);
      const y = c.data[o + F.Y];
      const h = c.data[o + F.H];
      if (op === OP.RECT && Math.abs(h - peakWidth) < 0.01) caps.push([col, y]);
      else {
        const cur = bars.get(col);
        if (!cur) bars.set(col, { top: y, bottom: y + h });
        else { cur.top = Math.min(cur.top, y); cur.bottom = Math.max(cur.bottom, y + h); }
      }
    }
    let worst = Infinity, seen = 0;
    for (const [col, y] of caps) {
      const cell = bars.get(col);
      if (!cell) continue;
      seen++;
      const gap = growsDown ? (y - cell.bottom) : (cell.top - (y + peakWidth));
      if (gap < worst) worst = gap;
    }
    return { worst, seen };
  };
  const mc = capClearance(mp, 4, false);
  assert.ok(mc.seen > 0, 'dotmatrix peak caps found');
  {
    // Grid extent from the dim cells; caps must not poke out of it.
    let top = Infinity, bottom = -Infinity;
    for (let i = 0; i < mp.count; i++) {
      const o = i * mp.stride;
      if (mp.data[o + F.OP] !== OP.CIRCLE) continue;
      top = Math.min(top, mp.data[o + F.Y]);
      bottom = Math.max(bottom, mp.data[o + F.Y] + mp.data[o + F.H]);
    }
    let outside = 0;
    for (let i = 0; i < mp.count; i++) {
      const o = i * mp.stride;
      if (mp.data[o + F.OP] !== OP.RECT) continue;
      if (Math.abs(mp.data[o + F.H] - 4) > 0.01) continue;
      if (mp.data[o + F.Y] < top - 1 || mp.data[o + F.Y] + 4 > bottom + 1) outside++;
    }
    assert.strictEqual(outside, 0,
      'every cap stays inside the grid (' + top.toFixed(0) + '..' + bottom.toFixed(0) + ')');
    log('    dotmatrix: ' + mc.seen + ' peak caps, all inside the grid');
  }

  // rays: one command per spoke, gradient and taper take different ops.
  const rayProbe = (over) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'rays',
      components: [{ type: 'rays', props: Object.assign(
        { count: 24, x: 0.2, y: 0.1, w: 0.6, h: 0.6, gain: 20 }, over || {}) }],
    }));
    for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }
    return engine.commands();
  };
  const rays = (c) => {
    let line = 0, grad = 0, poly = 0;
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      if (c.data[o + F.OP] === OP.LINE) line++;
      if (c.data[o + F.OP] === OP.GRADIENT_LINE) grad++;
      if (c.data[o + F.OP] === OP.POLYGON) poly++;
    }
    return { line, grad, poly };
  };
  const plain = rays(rayProbe({}));
  assert.strictEqual(plain.line, 24, 'one LINE per spoke, got ' + plain.line);
  const grad = rays(rayProbe({ gradient: true }));
  assert.strictEqual(grad.grad, 24, 'gradient spokes use GRADIENT_LINE, got ' + grad.grad);
  const tap = rays(rayProbe({ taper: 1 }));
  assert.strictEqual(tap.poly, 24, 'tapered spokes use 3-point POLYGON, got ' + tap.poly);
  // Spokes radiate from the box centre: every inner endpoint sits on the same
  // circle around it (midpoints would not — spokes differ in length).
  {
    const c = rayProbe({});
    const bx = (0.2 + 0.3) * 1280, by = (0.1 + 0.3) * 720;
    const rs = [];
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      if (c.data[o + F.OP] !== OP.LINE) continue;
      rs.push(Math.hypot(c.data[o + F.X] - bx, c.data[o + F.Y] - by));
    }
    assert.strictEqual(rs.length, 24, '24 inner endpoints');
    const lo = Math.min(...rs), hi = Math.max(...rs);
    assert.ok(hi - lo < 1.5,
      'inner radius is constant across spokes, spread ' + (hi - lo).toFixed(2));
    // base = min(768, 432)/2 = 216; innerRadius 0.25 -> ~54px.
    assert.ok(lo > 20 && lo < 120, 'inner radius lands near innerRadius x base, got ' + lo.toFixed(1));
  }
  log('    rays: 24 spokes as LINE / GRADIENT_LINE / tapered POLYGON, centred');

}

log('\n[3v] peak caps hold (stop delay), sit above bars, draw last');
// ---------------------------------------------------------------------------
const silence = new Float32Array(2048);
{
  // Caps are the only thin rects (peakWidth); bars are tall. Track the
  // topmost cap y over time while the audio goes quiet.
  const capTrace = (over, tailFrames) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'peak probe',
      components: [{ type: 'spectrum', props: Object.assign(
        { bars: 8, x: 0.1, y: 0.2, w: 0.8, h: 0.5, peaks: true, peakWidth: 6,
          peakFall: 0.3, minHeight: 0, decay: 0, smoothing: 0, gain: 40, logScale: false }, over || {}) }],
    }));
    const loud = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) loud[i] = 0.8 * Math.sin(2 * Math.PI * 300 * i / 44100);
    for (let f = 0; f < 8; f++) { engine.pushAudio(loud); engine.frame(16.7); }
    const trace = [];
    for (let f = 0; f < tailFrames; f++) {
      engine.pushAudio(silence);
      engine.frame(16.7);
      const c = engine.commands();
      let top = Infinity;
      for (let i = 0; i < c.count; i++) {
        const o = i * c.stride;
        if (c.data[o + F.OP] !== OP.RECT) continue;
        if (c.data[o + F.H] > 20) continue;          // that is a bar
        top = Math.min(top, c.data[o + F.Y]);        // cap: smallest y = highest
      }
      trace.push(top === Infinity ? NaN : top);
    }
    return trace;
  };
  // 1) caps ride above the bar tips even at full tilt.
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'peak tilt',
    components: [{ type: 'spectrum', props: { bars: 8, x: 0.1, y: 0.2, w: 0.8, h: 0.5,
      peaks: true, peakWidth: 6, smoothing: 0, minHeight: 0, gain: 40, logScale: false } }],
  }));
  for (let f = 0; f < 8; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  let barTop = Infinity, capTop = Infinity;
  {
    const loud = engine.commands();
    for (let i = 0; i < loud.count; i++) {
      const o = i * loud.stride;
      if (loud.data[o + F.OP] !== OP.RECT) continue;
      if (loud.data[o + F.H] > 20) barTop = Math.min(barTop, loud.data[o + F.Y]);
      else capTop = Math.min(capTop, loud.data[o + F.Y]);
    }
  }
  // Never below the tip: a cap may sit exactly on it (peakGap 0) or above it,
  // but it can no longer sink inside the bar.
  assert.ok(barTop < Infinity && capTop <= barTop + 0.5,
    'caps never sink below the bar tips (' + capTop.toFixed(0) + ' vs ' + barTop.toFixed(0) + ')');

  // Worst clearance between a cap and the bar it belongs to, measured in the
  // direction the bar grows. Per COLUMN: comparing the tallest bar against the
  // highest cap would pair up two different bars and prove nothing.
  const capClearance = (c, peakWidth, growsDown) => {
    const bars = new Map();   // col -> {top, bottom}
    const caps = [];
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      const op = c.data[o + F.OP];
      if (op !== OP.RECT && op !== OP.CIRCLE) continue;
      const col = Math.round(c.data[o + F.X]);
      const y = c.data[o + F.Y];
      const h = c.data[o + F.H];
      if (Math.abs(h - peakWidth) < 0.01) { caps.push([col, y]); continue; }
      const cur = bars.get(col);
      if (!cur) bars.set(col, { top: y, bottom: y + h });
      else { cur.top = Math.min(cur.top, y); cur.bottom = Math.max(cur.bottom, y + h); }
    }
    let worst = Infinity, seen = 0;
    for (const [col, y] of caps) {
      const bar = bars.get(col);
      if (!bar) continue;
      seen++;
      // Grows up: bar's outer edge is its top. Down: its bottom.
      const gap = growsDown ? (y - bar.bottom) : (bar.top - (y + peakWidth));
      if (gap < worst) worst = gap;
    }
    return { worst, seen };
  };

  // 2) peakGap keeps the cap clear of the tip. maxHeight leaves headroom, or a
  // full-height bar would clamp the cap against the top of its own box.
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'peak gap',
    components: [{ type: 'spectrum', props: { bars: 8, x: 0.1, y: 0.2, w: 0.8, h: 0.5,
      peaks: true, peakWidth: 6, peakGap: 14, smoothing: 0, minHeight: 0, maxHeight: 0.6,
      gain: 3, logScale: false } }],
  }));
  for (let f = 0; f < 8; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  {
    const r = capClearance(engine.commands(), 6, false);
    assert.ok(r.seen > 0, 'caps found');
    assert.ok(r.worst >= 14 - 0.5,
      'peakGap 14 holds every cap >=14px clear, worst ' + r.worst.toFixed(1));
  }

  // 2b) segmented bars quantise to a whole segment, so their real top sits
  // ABOVE the continuous bar height — a cap clamped to the continuous height
  // used to land on top of the topmost segment.
  for (const shape of [1, 2, 3]) {
    for (const [anchor, label] of [[0, 'bottom'], [1, 'center'], [2, 'top']]) {
      engine.loadPreset(P.normalizePreset({
        version: 1, name: 'peak seg',
        components: [{ type: 'spectrum', props: { bars: 12, x: 0.1, y: 0.2, w: 0.8, h: 0.5,
          peaks: true, peakWidth: 4, peakFall: 0, smoothing: 0, minHeight: 0, maxHeight: 0.75,
          gain: 12, logScale: false, segmentShape: shape, segmentGap: 0.2,
          baseline: anchor === 0 ? 0 : anchor === 1 ? 1 : 2, centered: anchor === 1 } }],
      }));
      for (let f = 0; f < 8; f++) { engine.pushAudio(window_); engine.frame(16.7); }
      const r = capClearance(engine.commands(), 4, anchor === 2);
      assert.ok(r.seen > 0, 'shape ' + shape + '/' + label + ': caps found');
      assert.ok(r.worst >= -0.5,
        'segmentShape ' + shape + '/' + label + ': cap clears the segments, worst ' +
        r.worst.toFixed(1) + 'px');
    }
  }
  log('    segmented bars: cap clears segments for shapes 1/2/3 x bottom/center/top');

  // 3) stop delay: caps sit still, then fall. 16.7ms/frame -> ~60 frames = 1s.
  const held = capTrace({ peakDelay: 1.0 }, 90);
  const free = capTrace({}, 90);
  assert.ok(!Number.isNaN(held[0]) && !Number.isNaN(free[0]), 'caps emitted every frame');
  assert.ok(Math.abs(held[50] - held[0]) < 0.5,
    'delayed cap is motionless for 1s, moved ' + (held[50] - held[0]).toFixed(2) + 'px');
  assert.ok(free[50] - free[0] > 5, 'no-delay cap is already falling, +' + (free[50] - free[0]).toFixed(1) + 'px');
  assert.ok(held[89] < free[89],
    'delayed cap is still higher late on: ' + held[89].toFixed(0) + ' vs ' + free[89].toFixed(0));
  log('    stop delay: y after 1s held ' + held[50].toFixed(1) + ' / free ' + free[50].toFixed(1) +
      ', after 1.5s held ' + held[89].toFixed(1) + ' / free ' + free[89].toFixed(1));
}

// ---------------------------------------------------------------------------
log('\n[3b] each component type emits the commands it should');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset(NEON));   // background+spectrum+line+3x text
for (let f = 0; f < 12; f++) { engine.pushAudio(window_); engine.frame(16.7); }

const ops2 = engine.commands();
const byOp = new Map();
const pts = engine.points();
for (let i = 0; i < ops2.count; i++) {
  const o = i * ops2.stride;
  const op = ops2.data[o + F.OP];
  byOp.set(op, (byOp.get(op) || 0) + 1);
}
log('    op histogram            : ' +
    [...byOp.entries()].sort((a, b) => a[0] - b[0])
      .map(([op, n]) => op + ':' + n).join(' '));

assert.ok(byOp.get(OP.CLEAR) === 1 || (byOp.get(OP.GRADIENT_RECT) || 0) >= 1,
  'background fills the whole frame (solid clear or full-screen gradient)');
assert.ok((byOp.get(OP.RECT) || 0) + (byOp.get(OP.GRADIENT_RECT) || 0) >= 96,
  '48 bars + 48 peak caps');
assert.ok((byOp.get(OP.POLYGON) || 0) + (byOp.get(OP.GRADIENT_LINE) || 0) >= 1,
  'line emits a point list');

// NOTE: everything below re-reads `ops2`, which is a *live view* onto the
// WASM command buffer. Any loadPreset()/frame() call would overwrite it, so
// section [3c] is deliberately placed after the last ops2 read.

// Full-screen background fill?
let fullBleed = false;
for (let i = 0; i < ops2.count; i++) {
  const o = i * ops2.stride;
  if (ops2.data[o + F.OP] === OP.GRADIENT_RECT &&
      ops2.data[o + F.W] >= 1279 && ops2.data[o + F.H] >= 719) fullBleed = true;
}
assert.ok(fullBleed, 'background gradient covers the full 1280x720 surface');

// OP.POLYGON and OP_GRADIENT_LINE share the point-list layout.
const polys = [];
for (let i = 0; i < ops2.count; i++) {
  const o = i * ops2.stride;
  const op = ops2.data[o + F.OP];
  if (op !== OP.POLYGON && op !== OP.GRADIENT_LINE) continue;
  polys.push({ n: ops2.data[o + F.P0] | 0, off: ops2.data[o + F.P1] | 0, stroke: ops2.data[o + F.P2] });
}
const stroked = polys.find((p) => p.stroke > 0);
assert.ok(stroked, 'the line stroke is present');
assert.ok(stroked.n >= 100, 'line has its full point count, got ' + stroked.n);
let minX = Infinity;
let maxX = -Infinity;
for (let k = 0; k < stroked.n; k++) {
  const px = pts[stroked.off * 2 + k * 2];
  minX = Math.min(minX, px);
  maxX = Math.max(maxX, px);
}
log('    line x-extent           : ' + minX.toFixed(1) + ' .. ' + maxX.toFixed(1) +
    ' (box 51.2 .. 1228.8)');
assert.ok(maxX - minX > 1000, 'the line must span the width of its box');

// ---------------------------------------------------------------------------
// [3c] runs a loadPreset(), so it must come after every ops2 read above.
log('\n[3c] beat glow + {cover} token');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset({
  version: 1,
  name: 'probe',
  components: [
    { type: 'beat_glow', props: { x: 0.2, y: 0.2, w: 0.5, h: 0.5, intensity: 1.5 } },
    { type: 'image', props: { image: '{cover}', x: 0.1, y: 0.1, w: 0.3, h: 0.3 } },
  ],
}));
for (let f = 0; f < 8; f++) { engine.pushAudio(window_); engine.frame(16.7); }

const glowCmds = [];
for (let i = 0; i < engine.commands().count; i++) {
  const o = i * engine.commands().stride;
  if (engine.commands().data[o + F.OP] === OP.RADIAL_GLOW) glowCmds.push(o);
}
assert.strictEqual(glowCmds.length, 2, 'beat_glow emits a halo + a core glow, got ' + glowCmds.length);

// The glow must track audio energy. A binary loud/quiet signal saturates the
// bass follower, so sweep the amplitude to check the response is graded.
const readA = () => engine.commands().data[glowCmds[0] + F.P3];
const tone = new Float32Array(2048);
const samples = [];
for (let f = 0; f < 10; f++) {
  const amp = 0.04 + 0.09 * f;              // quiet -> loud
  for (let i = 0; i < 2048; i++) tone[i] = amp * Math.sin((2 * Math.PI * 90 * i) / 44100);
  engine.pushAudio(tone);
  engine.frame(16.7);
  samples.push(readA());
}
assert.ok(new Set(samples).size >= 4,
  'halo alpha tracks amplitude, got ' + new Set(samples).size + ' distinct values');
assert.ok(samples[samples.length - 1] > samples[0], 'louder audio produces a brighter halo (' +
  samples[0].toFixed(4) + ' -> ' + samples[samples.length - 1].toFixed(4) + ')');

// {cover} must resolve to whatever the host registered, not the literal 0.
const imgIds = () => {
  const out = [];
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.IMAGE) out.push(c.data[o + F.IMG]);
  }
  return out;
};
assert.deepStrictEqual(imgIds(), [1], '{cover} resolves to the default cover id 1');

// Re-pointing the cover must change what {cover} draws.
engine.setCover(7);
for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
assert.deepStrictEqual(imgIds(), [7], 'setCover(7) re-points the {cover} token');
assert.strictEqual(engine.cover(), 7, 'cover id round-trips through the engine');
log('    beat_glow orbs + {cover} resolution: ok');

// ---------------------------------------------------------------------------
log('\n[3d] palette tokens + cover component');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset({
  version: 1,
  name: 'palette probe',
  palette: 'Neon',
  components: [
    { type: 'cover', props: {
      image: '{cover}', x: 0.3, y: 0.1, w: 0.4, h: 0.711, radialBars: 24,
      ringRadius: 0.6, radialLength: 0.3, glow: 10,
      color: '{primary}', color2: '{secondary}', haloColor: '{accent}' } },
    { type: 'spectrum', props: { color: '{primary}', color2: '{secondary}' } },
  ],
}));
engine.setVar('primary', '#ff0000');
engine.setVar('secondary', '#00ff00');
engine.setVar('accent', '#0000ff');
for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }

const c3 = engine.commands();
let radialPolys = 0, glows = 0, sawRed = false;
for (let i = 0; i < c3.count; i++) {
  const o = i * c3.stride;
  const op = c3.data[o + F.OP];
  if (op === OP.POLYGON) {
    radialPolys++;
    if (c3.data[o + F.R] > 0.95 && c3.data[o + F.G] < 0.05 && c3.data[o + F.B] < 0.05) sawRed = true;
  }
  if (op === OP.RADIAL_GLOW) glows++;
}
assert.ok(radialPolys >= 24, 'cover emits one polygon per radial bar, got ' + radialPolys);
assert.ok(glows >= 1, 'cover emits a radial glow, got ' + glows);
assert.ok(sawRed, 'palette token {primary} resolves to the published colour');
log('    radial bars            : ' + radialPolys + ' polygons, ' + glows + ' glow');
log('    {primary} token        : resolves to #ff0000');

// ---------------------------------------------------------------------------
log('\n[3e] image opcode fields: blur in p3, circle in role');
// ---------------------------------------------------------------------------
engine.setCover(1);
engine.loadPreset(P.normalizePreset({
  version: 1,
  name: 'blur probe',
  components: [
    { type: 'background', props: { mode: 2, image: '{cover}', blur: 21, dim: 0.5, fit: 0 } },
    { type: 'image', props: { image: '{cover}', circle: true, x: 0, y: 0, w: 0.2, h: 0.2 } },
  ],
}));
for (let f = 0; f < 3; f++) { engine.pushAudio(window_); engine.frame(16.7); }

const imgs = [];
for (let i = 0; i < engine.commands().count; i++) {
  const o = i * engine.commands().stride;
  if (engine.commands().data[o + F.OP] === OP.IMAGE) {
    imgs.push({ blur: engine.commands().data[o + F.P3], circle: engine.commands().data[o + F.ROLE], fit: engine.commands().data[o + F.P0] });
  }
}
assert.strictEqual(imgs.length, 2, 'background + image emit two OP_IMAGE commands, got ' + imgs.length);
assert.strictEqual(imgs[0].blur, 21, 'background blur lands in p3');
assert.ok(imgs[0].circle < 0.5, 'background is not circle-masked by its blur value');
assert.strictEqual(imgs[0].fit, 0, 'background fit lands in p0');
assert.ok(imgs[1].circle >= 0.5, 'image circle flag lands in role');
assert.strictEqual(imgs[1].blur, 0, 'image blur defaults to 0');
log('    background blur -> p3   : ' + imgs[0].blur + ' (circle ' + imgs[0].circle + ', fit ' + imgs[0].fit + ')');
log('    image circle -> role    : ' + imgs[1].circle);

// The blur branch must render with a real image present. The suite used to
// skip OP.IMAGE (no image registered), which hid a ReferenceError that killed
// every blurred-cover preset in the browser.
{
  const ctx2 = stubContext();
  const backend2 = new CanvasBackend({ width: 1280, height: 720, getContext: () => ctx2 }, engine);
  backend2.registerImage(1, { width: 64, height: 48 });
  engine.setCover(1);
  for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  backend2.render();   // must not throw
  assert.ok(ctx2.calls.includes('drawImage'), 'blurred background draws the image');
  assert.ok(ctx2.calls.includes('arc'), 'non-square circle mask clips a true circle via arc');
  log('    blurred image render    : drawImage called, no throw');
}

// ---------------------------------------------------------------------------
log('\n[3g] orb component: glow spectrum lines around the cover');
// ---------------------------------------------------------------------------
engine.setCover(1);
engine.loadPreset(P.normalizePreset({
  version: 1,
  name: 'orb probe',
  palette: 'Neon',
  components: [
    { type: 'orb', props: {
      image: '{cover}', x: 0.28, y: 0.08, w: 0.44, h: 0.782, rings: 3, linePoints: 64,
      ringRadius: 0.52, gap: 0.3, radialLength: 0.42, thickness: 0.013,
      color: '{primary}', color2: '{secondary}', glow: 18, haloColor: '{accent}' } },
  ],
}));
engine.setVar('primary', '#7dffd4');
engine.setVar('secondary', '#00e5ff');
engine.setVar('accent', '#00e5ff');
for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }

const orbCmds = engine.commands();
let orbStroked = 0, orbGlows = 0, orbImgs = 0;
for (let i = 0; i < orbCmds.count; i++) {
  const o = i * orbCmds.stride;
  const op = orbCmds.data[o + F.OP];
  if (op === OP.POLYGON && orbCmds.data[o + F.P2] > 0) orbStroked++;
  if (op === OP.RADIAL_GLOW) orbGlows++;
  if (op === OP.IMAGE) orbImgs++;
}
assert.strictEqual(orbStroked, 9, 'orb emits 3 rings x 3 bloom passes, got ' + orbStroked);
assert.ok(orbGlows >= 1, 'orb emits a halo glow, got ' + orbGlows);
assert.strictEqual(orbImgs, 1, 'orb draws the center cover image, got ' + orbImgs);
log('    orb rings               : ' + orbStroked + ' stroked polygons, ' +
    orbGlows + ' glow, ' + orbImgs + ' image');

// ---------------------------------------------------------------------------
log('\n[3u] orb start angle, angle smoothing, palette rings, fill, reflection + bg pulse');
// ---------------------------------------------------------------------------
const orbProbe = (over, frames) => {
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'orb probe 2',
    components: [{ type: 'orb', props: Object.assign(
      { x: 0.3, y: 0.14, w: 0.4, h: 0.72, rings: 2, linePoints: 64,
        ringRadius: 0.42, glow: 0, mirror: true, image: '0' }, over || {}) }],
  }));
  for (let f = 0; f < frames; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  return engine.commands();
};
{
  // arcStart rotates the display: first ring point sits at the start angle.
  // box x0.3 w0.4 h0.72 on 1280x720: cx=640, cy=360; 90 = straight down.
  const c = orbProbe({ arcStart: 90 }, 4);
  const pts = engine.points();
  let px = 0, py = 0, found = 0;
  for (let i = 0; i < c.count && !found; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.POLYGON && c.data[o + F.P2] > 0) {
      const off = (c.data[o + F.P1] | 0) * 2;
      px = pts[off]; py = pts[off + 1]; found++;
    }
  }
  assert.strictEqual(found, 1, 'ring stroke emitted');
  const ang = Math.atan2(py - 360, px - 640) * 180 / Math.PI;
  assert.ok(Math.abs(ang - 90) < 2, 'ring starts at 90deg, got ' + ang.toFixed(1));
  log('    arcStart 90: first ring point at ' + ang.toFixed(1) + 'deg');

  // angular smoothing tames neighbour jumps around the ring.
  const rough = (over, frames) => {
    const cc = orbProbe(over, frames);
    const pp = engine.points();
    let worst = 0, seen = 0;
    for (let i = 0; i < cc.count && !seen; i++) {
      const o = i * cc.stride;
      if (cc.data[o + F.OP] !== OP.POLYGON || cc.data[o + F.P2] <= 0) continue;
      const n = cc.data[o + F.P0] | 0, off = (cc.data[o + F.P1] | 0) * 2;
      let prev = -1;
      for (let k = 0; k < n; k++) {
        const r = Math.hypot(pp[off + k * 2] - 640, pp[off + k * 2 + 1] - 360);
        if (prev >= 0) worst = Math.max(worst, Math.abs(r - prev));
        prev = r;
      }
      seen++;
    }
    return worst;
  };
  const d0 = rough({ angularSmooth: 0 }, 12);
  const d1 = rough({ angularSmooth: 0.9 }, 12);
  assert.ok(d0 > 0.5, 'raw ring has sharp jumps, got ' + d0.toFixed(2));
  assert.ok(d1 < d0 * 0.75, 'smoothed ring calmer: ' + d1.toFixed(2) + ' vs ' + d0.toFixed(2));
  log('    angle smoothing: worst jump ' + d0.toFixed(1) + ' -> ' + d1.toFixed(1));

  // palette rings: each ring takes one solid role, vivid first.
  engine.setVar('primary', '#ff0000');
  engine.setVar('secondary', '#00ff00');
  const cp = orbProbe({ paletteRings: true }, 4);
  const ringCols = [];
  for (let i = 0; i < cp.count && ringCols.length < 2; i++) {
    const o = i * cp.stride;
    if (cp.data[o + F.OP] === OP.POLYGON && cp.data[o + F.P2] > 0) {
      ringCols.push([cp.data[o + F.R], cp.data[o + F.G], cp.data[o + F.B]]);
      i += 2;   // skip the two bloom falloffs of this ring
    }
  }
  assert.strictEqual(ringCols.length, 2, 'two ring cores, got ' + ringCols.length);
  assert.ok(ringCols[0][0] > 0.95 && ringCols[0][1] < 0.05, 'ring 0 is primary red');
  assert.ok(ringCols[1][1] > 0.95 && ringCols[1][0] < 0.05, 'ring 1 is secondary green');
  log('    palette rings: red + green cores');

  // inner fill: one filled disc, no stroke.
  const cf = orbProbe({ fillOpacity: 0.5, fillColor: '#123456' }, 2);
  let discs = 0;
  for (let i = 0; i < cf.count; i++) {
    const o = i * cf.stride;
    if (cf.data[o + F.OP] === OP.CIRCLE && cf.data[o + F.P0] === 0) {
      discs++;
      assert.ok(Math.abs(cf.data[o + F.R] - 0x12 / 255) < 0.02, 'disc takes the fill color');
    }
  }
  assert.strictEqual(discs, 1, 'one inner disc, got ' + discs);
  log('    inner fill: 1 disc');

  // reflection: one extra faded stroke per ring, dipping below the box.
  const countStrokes = (cc) => {
    let n = 0;
    for (let i = 0; i < cc.count; i++) {
      const o = i * cc.stride;
      if (cc.data[o + F.OP] === OP.POLYGON && cc.data[o + F.P2] > 0) n++;
    }
    return n;
  };
  assert.strictEqual(countStrokes(orbProbe({}, 4)), 6, '2 rings x 3 passes');
  const cr = orbProbe({ reflection: true }, 4);
  assert.strictEqual(countStrokes(cr), 8, 'reflection adds one stroke per ring');
  const pr = engine.points();
  let below = 0;
  for (let i = 0; i < cr.count; i++) {
    const o = i * cr.stride;
    if (cr.data[o + F.OP] !== OP.POLYGON) continue;
    const n = cr.data[o + F.P0] | 0, off = (cr.data[o + F.P1] | 0) * 2;
    for (let k = 0; k < n; k++) if (pr[off + k * 2 + 1] > 619.2 + 1) below++;
  }
  assert.ok(below > 50, 'reflection dips below the box, got ' + below + ' points');
  log('    reflection: 8 strokes, ' + below + ' points below the box');
}
{
  // background beat pulse: 0 is exactly the full-surface rect, >0 zooms the
  // image with the beat and dips it downward. Image mode only.
  engine.setCover(1);
  const bgRect = (pulse) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'bg pulse probe',
      components: [{ type: 'background', props: { mode: 2, image: '{cover}', pulseAmount: pulse } }],
    }));
    for (let f = 0; f < 10; f++) { engine.pushAudio(window_); engine.frame(16.7); }
    const c = engine.commands();
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      if (c.data[o + F.OP] === OP.IMAGE) return [c.data[o + F.X], c.data[o + F.Y], c.data[o + F.W], c.data[o + F.H]];
    }
    return null;
  };
  const base = bgRect(0);
  assert.ok(base, 'background emits its image');
  assert.deepStrictEqual(base.map((v) => Math.round(v)), [0, 0, 1280, 720], 'pulse 0 is the static rect');
  const hot = bgRect(0.9);
  assert.ok(hot[2] > 1280 + 5 && hot[3] > 720 + 5, 'pulse zooms in: ' + hot.map((v) => v.toFixed(1)));
  const nudge = hot[1] - (720 - hot[3]) / 2;
  assert.ok(nudge > 1, 'pulse dips below center: +' + nudge.toFixed(1));
  log('    bg pulse: rect ' + base.map((v) => Math.round(v)) + ' -> ' + hot.map((v) => v.toFixed(1)));
}

// ---------------------------------------------------------------------------
log('\n[3h] progress bar, radial line, and opacity on text/spectrum');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset({
  version: 1,
  name: 'progress probe',
  components: [
    { type: 'progress', props: { x: 0.05, y: 0.9, w: 0.9, h: 0.02, color: '#ffffff' } },
    { type: 'radial_line', props: {
      x: 0.3, y: 0.2, w: 0.4, h: 0.6, lineMode: 1, linePoints: 64,
      color: '#00e5ff', color2: '#ff2d95', gradient: true } },
    { type: 'text', props: { pattern: '{title}', opacity: 0.5, x: 0.05, y: 0.05, w: 0.9, h: 0.1 } },
    { type: 'spectrum', props: { bars: 8, opacity: 0.5, x: 0.05, y: 0.5, w: 0.9, h: 0.2 } },
  ],
}));
engine.setVar('title', 'Hi');
engine.setVar('positionSec', 60);
engine.setVar('durationSec', 200);
for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }

const h3 = engine.commands();
let fillW = -1, trackW = -1, loopSegs = 0, textA = -1, barA = -1;
const boxW = 0.9 * 1280;
for (let i = 0; i < h3.count; i++) {
  const o = i * h3.stride;
  const op = h3.data[o + F.OP];
  if ((op === OP.RECT || op === OP.GRADIENT_RECT) && h3.data[o + F.H] < 30) {
    // progress bar rows: the track spans the box, the fill 30% of it
    const w = h3.data[o + F.W];
    if (Math.abs(w - boxW) < 2) trackW = w;
    else if (Math.abs(w - boxW * 0.3) < 4) fillW = w;
  }
  if (op === OP.POLYGON && h3.data[o + F.P2] > 0) {
    const n = h3.data[o + F.P0] | 0;
    if (n < 100) loopSegs++;   // radial_line arc segments are short; single loops are 200+
  }
  if (op === OP.TEXT && h3.data[o + F.STRLEN] > 0) textA = h3.data[o + F.A];
  // spectrum bars are narrow rects; the progress rows span most of the box
  if (op === OP.RECT && h3.data[o + F.W] < 200 && h3.data[o + F.H] > 2) barA = h3.data[o + F.A];
}
assert.ok(Math.abs(trackW - boxW) < 2, 'progress track spans the box, got ' + trackW);
assert.ok(Math.abs(fillW - boxW * 0.3) < 4, 'progress fill is 30% (60/200s), got ' + fillW);
assert.strictEqual(loopSegs, 24, 'gradient radial emits 24 arc segments in one pass, got ' + loopSegs);
assert.ok(Math.abs(textA - 0.5) < 0.01, 'text honours opacity, got ' + textA);
assert.ok(Math.abs(barA - 0.5) < 0.01, 'spectrum honours opacity, got ' + barA);
log('    progress 30% fill      : track ' + trackW.toFixed(0) + ' / fill ' + fillW.toFixed(0));
log('    radial line segments   : ' + loopSegs);
log('    text/spectrum alpha    : ' + textA + ' / ' + barA);

// ---------------------------------------------------------------------------
log('\n[3s] radial single loop, glow passes, mirror folds, center + arc');
// ---------------------------------------------------------------------------
const radialProbe = (over, frames) => {
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'radial probe',
    components: [{ type: 'radial_line', props: Object.assign(
      { x: 0.3, y: 0.2, w: 0.4, h: 0.6, lineMode: 1, linePoints: 64 }, over || {}) }],
  }));
  for (let f = 0; f < frames; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  return engine.commands();
};
{
  // solid color + no glow: exactly one closed loop, upsampled 4x
  const c = radialProbe({ gradient: false, glow: 0 }, 4);
  let loops = 0, nPts = 0;
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.POLYGON && c.data[o + F.P2] > 0) { loops++; nPts = c.data[o + F.P0]; }
  }
  assert.strictEqual(loops, 1, 'single loop without glow, got ' + loops);
  assert.strictEqual(nPts, Math.min(64 * 4, 1024) + 1, 'closed Catmull-Rom loop, got ' + nPts);
  log('    single loop: 1 stroke of ' + nPts + ' points');
}
{
  // glow on: 3 stacked passes again
  const c = radialProbe({ gradient: false, glow: 10 }, 4);
  let strokes = 0;
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.POLYGON && c.data[o + F.P2] > 0) strokes++;
  }
  assert.strictEqual(strokes, 3, 'glow restores 3 bloom passes, got ' + strokes);
  log('    glow passes: ' + strokes);
}
{
  // mirror: left/right bar colors match (cover uses the same fold)
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'cover mirror probe',
    components: [{ type: 'cover', props: {
      image: '{cover}', x: 0.3, y: 0.1, w: 0.4, h: 0.711, radialBars: 8, mirror: true,
      color: '#ff0000', color2: '#0000ff', glow: 0 } }],
  }));
  engine.setVar('primary', '#ff0000');
  engine.setVar('secondary', '#0000ff');
  for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  const cols = [];
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.POLYGON && c.data[o + F.P2] <= 0) {
      cols.push([c.data[o + F.R], c.data[o + F.G], c.data[o + F.B]].map((v) => v.toFixed(2)).join(','));
    }
  }
  assert.ok(cols.length >= 8, 'cover bars emit, got ' + cols.length);
  assert.deepStrictEqual(cols, cols.slice().reverse(), 'mirrored bars share colors: ' + cols.slice(0, 3));
  log('    cover mirror: ' + cols.length + ' bars symmetric');
}
{
  // center image: square, centered on the component middle
  const c = radialProbe({ image: '{cover}', coverScale: 0.5, circle: true }, 2);
  engine.setCover(1);
  for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  const c2 = engine.commands();
  let found = 0;
  for (let i = 0; i < c2.count; i++) {
    const o = i * c2.stride;
    if (c2.data[o + F.OP] === OP.IMAGE && c2.data[o + F.IMG] === 1) {
      found++;
      assert.ok(Math.abs(c2.data[o + F.W] - c2.data[o + F.H]) < 0.01, 'center image is square');
      const cx = c2.data[o + F.X] + c2.data[o + F.W] / 2;
      assert.ok(Math.abs(cx - (0.3 + 0.2) * 1280) < 1, 'center image on the middle, got ' + cx.toFixed(1));
    }
  }
  assert.strictEqual(found, 1, 'one center image, got ' + found);
  log('    center image: square, centered');
}
{
  // imageAspect widens/narrows the box around the same centre; the height
  // (coverScale) stays put and 1.0 is the old square exactly.
  const aspectProbe = (type, over) => {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'aspect probe',
      components: [{ type, props: Object.assign(
        { image: '{cover}', x: 0.3, y: 0.2, w: 0.4, h: 0.6, coverScale: 0.5 }, over || {}) }],
    }));
    engine.setCover(1);
    for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
    const out = [];
    const c = engine.commands();
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      if (c.data[o + F.OP] === OP.IMAGE && c.data[o + F.IMG] === 1) {
        out.push({ x: c.data[o + F.X], y: c.data[o + F.Y], w: c.data[o + F.W], h: c.data[o + F.H] });
      }
    }
    return out;
  };
  for (const type of ['cover', 'orb', 'radial_line']) {
    const sq = aspectProbe(type);
    assert.strictEqual(sq.length, 1, type + ': one center image, got ' + sq.length);
    assert.ok(Math.abs(sq[0].w - sq[0].h) < 0.01, type + ': default aspect is square');
    const wide = aspectProbe(type, { imageAspect: 2 });
    assert.strictEqual(wide.length, 1, type + ': one wide image');
    assert.ok(Math.abs(wide[0].w / wide[0].h - 2) < 0.01, type + ': w/h is 2, got ' + (wide[0].w / wide[0].h).toFixed(2));
    assert.ok(Math.abs(wide[0].h - sq[0].h) < 0.01, type + ': height unchanged by aspect');
    assert.ok(Math.abs((wide[0].x + wide[0].w / 2) - (sq[0].x + sq[0].w / 2)) < 0.01, type + ': stays centered');
    const tall = aspectProbe(type, { imageAspect: 0.5 });
    assert.ok(Math.abs(tall[0].h / tall[0].w - 2) < 0.01, type + ': h/w is 2, got ' + (tall[0].h / tall[0].w).toFixed(2));
    assert.ok(Math.abs(tall[0].h - sq[0].h) < 0.01, type + ': height unchanged (tall)');
  }
  log('    imageAspect 2 / 0.5 on cover, orb, radial_line: ratio holds, centred');
  // centerX/centerY move the EFFECT relative to the image: rings, loops and
  // glow follow the offset while the art stays glued to the box middle.
  for (const type of ['cover', 'orb', 'radial_line']) {
    engine.loadPreset(P.normalizePreset({
      version: 1, name: 'offset probe',
      components: [{ type, props: {
        image: '{cover}', x: 0.3, y: 0.2, w: 0.4, h: 0.6, coverScale: 0.5,
        glow: 10, centerX: 0.25, centerY: 0.75 } }],
    }));
    engine.setCover(1);
    for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
    const c = engine.commands();
    const pts = Array.from(engine.points());
    const boxX = 0.3 * 1280, boxY = 0.2 * 720, boxW = 0.4 * 1280, boxH = 0.6 * 720;
    const midX = boxX + boxW / 2, midY = boxY + boxH / 2;
    const effX = boxX + boxW * 0.25, effY = boxY + boxH * 0.75;
    let imgCX = 0, imgCY = 0, imgs = 0;
    let glowCX = 0, glowCY = 0, glows = 0;
    let px = 0, py = 0, pn = 0;
    for (let i = 0; i < c.count; i++) {
      const o = i * c.stride;
      const op = c.data[o + F.OP];
      if (op === OP.IMAGE && c.data[o + F.IMG] === 1) {
        imgs++;
        imgCX = c.data[o + F.X] + c.data[o + F.W] / 2;
        imgCY = c.data[o + F.Y] + c.data[o + F.H] / 2;
      } else if (op === OP.RADIAL_GLOW) {
        glows++;
        glowCX = c.data[o + F.X] + c.data[o + F.W] / 2;
        glowCY = c.data[o + F.Y] + c.data[o + F.H] / 2;
      } else if (op === OP.POLYGON) {
        const n = c.data[o + F.P0] | 0, off = (c.data[o + F.P1] | 0) * 2;
        for (let q = 0; q < n; q++) { px += pts[off + q * 2]; py += pts[off + q * 2 + 1]; pn++; }
      }
    }
    assert.strictEqual(imgs, 1, type + ': one center image');
    assert.ok(Math.abs(imgCX - midX) < 1.5 && Math.abs(imgCY - midY) < 1.5,
      type + ': image stays on box middle, got ' + imgCX.toFixed(1) + ',' + imgCY.toFixed(1));
    if (type === 'cover') {
      // Cover's halo is one exact glow centered on the effect.
      assert.ok(glows >= 1, type + ': halo emitted');
      assert.ok(Math.abs(glowCX - effX) < 1.5 && Math.abs(glowCY - effY) < 1.5,
        type + ': halo follows the offset, got ' + glowCX.toFixed(1) + ',' + glowCY.toFixed(1));
    } else {
      // Orb loops / radial loop: silent audio => near-circular strokes whose
      // centroid sits on the effect center (loose tolerance: audio wobble).
      assert.ok(pn > 50, type + ': loop geometry emitted');
      assert.ok(Math.abs(px / pn - effX) < 12 && Math.abs(py / pn - effY) < 12,
        type + ': loops follow the offset, got ' + (px / pn).toFixed(1) + ',' + (py / pn).toFixed(1));
    }
  }
  log('    centerX/Y 0.25/0.75: art pinned to middle, effect follows');
}
{
  // arcStart rotates the loop: first point sits at the start angle
  const c = radialProbe({ gradient: false, glow: 0, arcStart: 90, linePoints: 32 }, 4);
  const pts = engine.points();
  let px = 0, py = 0, nPts = 0;
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.POLYGON && c.data[o + F.P2] > 0) {
      nPts = c.data[o + F.P0];
      const off = (c.data[o + F.P1] | 0) * 2;
      px = pts[off]; py = pts[off + 1];
    }
  }
  assert.ok(nPts > 100, 'loop emitted');
  // box x0.3 w0.4 h0.6 on 1280x720: cx=640, cy=360; arcStart 90 = straight down
  const ang = Math.atan2(py - 360, px - 640) * 180 / Math.PI;
  assert.ok(Math.abs(ang - 90) < 2, 'loop starts at 90deg, got ' + ang.toFixed(1));
  log('    arcStart 90: first point at ' + ang.toFixed(1) + 'deg');
}

// ---------------------------------------------------------------------------
log('\n[3t] open strokes are never closed with a chord');
// ---------------------------------------------------------------------------
{
  // Path-tracking canvas: records every vertex so the test can see whether a
  // stroke gained a straight closing segment back to its start.
  const mkPathCtx = () => {
    const base = stubContext();
    const segs = [];
    let closes = 0;
    const ctx = Object.assign(base, {
      moveTo: (x, y) => { base.calls.push('moveTo'); segs.push(['M', x, y]); },
      lineTo: (x, y) => { base.calls.push('lineTo'); segs.push(['L', x, y]); },
      closePath: () => { base.calls.push('closePath'); closes++; },
    });
    return { ctx, segs, closes: () => closes };
  };
  // Open line stroke: path stays open (no chord end->start).
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'open stroke probe',
    components: [{ type: 'line', props: {
      lineMode: 1, linePoints: 64, gradient: false, x: 0.05, y: 0.3, w: 0.9, h: 0.3 } }],
  }));
  for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  const t1 = mkPathCtx();
  new CanvasBackend({ width: 1280, height: 720, getContext: () => t1.ctx }, engine).render();
  assert.strictEqual(t1.closes(), 0, 'open stroke must not closePath, got ' + t1.closes());
  assert.ok(t1.segs.filter((s) => s[0] === 'L').length > 100, 'polyline stroked through');
  log('    open stroke: 0 closePath, polyline intact');

  // Filled shapes still close (fill needs the closed region).
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'fill probe',
    components: [{ type: 'line', props: {
      lineMode: 1, linePoints: 64, gradient: false, fill: true, x: 0.05, y: 0.3, w: 0.9, h: 0.3 } }],
  }));
  for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  const t2 = mkPathCtx();
  new CanvasBackend({ width: 1280, height: 720, getContext: () => t2.ctx }, engine).render();
  assert.ok(t2.closes() >= 1, 'fill still closes its region');
  log('    fill: closes its region again');
}

// ---------------------------------------------------------------------------
log('\n[7] presets/default/ is the source of truth');
// ---------------------------------------------------------------------------
{
  const dir = new URL('../presets/default/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const idx = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
  assert.deepStrictEqual([...idx].sort(), files.sort(),
    'index.json lists exactly the files on disk');
  assert.ok(!files.includes('index.json'));
  for (const f of files) {
    const p = P.normalizePreset(JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')));
    assert.ok(p.name && p.components.length > 0, f + ' normalises to a usable preset');
    for (const c of p.components) {
      assert.ok(P.SCHEMAS[c.type], f + ': unknown component type ' + c.type);
      for (const k of Object.keys(c.props)) {
        assert.notStrictEqual(engine.propId(k), -1, f + ': engine does not know prop ' + k);
      }
    }
  }
  log('    ' + files.length + ' files + index.json, all valid in engine + schema');
}

// ---------------------------------------------------------------------------
log('\n[7b] themed presets: named, palette-bound, effect combos that make sense');
// ---------------------------------------------------------------------------
{
  const dir = new URL('../presets/default/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const themes = files
    .map((f) => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')))
    .filter((p) => THEME_NAMES.has(p.name));
  assert.strictEqual(themes.length, THEME_NAMES.size,
    'all ' + THEME_NAMES.size + ' themes ship, got ' + themes.length);
  for (const p of themes) {
    const types = p.components.map((c) => c.type);
    assert.ok(types[0] === 'background', p.name + ' needs a background first');
    assert.ok(types.some((t) => t !== 'background'), p.name + ' needs something to visualise');
    // A theme must name a real palette and bind its colours to roles, so it
    // stays re-themeable instead of being a fixed-hex snapshot.
    assert.ok(palNames.has(p.palette), p.name + ' names unknown palette ' + p.palette);
    const roleBound = p.components.some((c) =>
      Object.entries(c.props).some(([, v]) => typeof v === 'string' && /^\{[a-z0-9]+\}$/.test(v)));
    assert.ok(roleBound, p.name + ' binds colours to palette roles');
    // Text presets must say who is playing; immersive ones stay text-free.
    const hasText = types.includes('text');
    const immersive = !hasText && (types.includes('orb') || types.includes('cover'));
    if (!immersive) assert.ok(hasText, p.name + ' either binds text or is fully immersive');
    if (hasText) {
      assert.ok(p.components.some((c) => c.type === 'text' && /\{title\}/.test(c.props.pattern)),
        p.name + ' shows the track title');
    }
  }
  log('    ' + themes.length + ' themes: palettes, roles, text/immersive rules ok');
}

// ---------------------------------------------------------------------------
log('\n[7c] {dynamic} is an always-published artwork role');
// ---------------------------------------------------------------------------
{
  assert.strictEqual(PAL.DYNAMIC_ROLE, 'dynamic');
  // Published for every palette, not just "From cover": a preset must be able
  // to keep fixed brand colours while tinting its backdrop from the artwork.
  const dynRoles = PAL.withDynamic(PAL.paletteByName('Mono').roles, null);
  assert.ok(dynRoles[PAL.DYNAMIC_ROLE], 'fixed palettes still get a dynamic role');
  assert.strictEqual(dynRoles[PAL.DYNAMIC_ROLE], PAL.FALLBACK_DYNAMIC, 'neutral before artwork');
  assert.strictEqual(dynRoles.primary, PAL.paletteByName('Mono').roles.primary,
    'patching dynamic leaves the palette alone');

  // shadeToLightness must land near the target for dark AND bright art.
  for (const hex of ['#1DB954', '#ffffff', '#000000', '#ff0000', '#0a2b6b', '#808080']) {
    const out = PAL.shadeToLightness(hex, 0.3);
    const l = PAL.luminance(out);
    assert.ok(Math.abs(l - 0.3) < 0.09,
      hex + ' -> ' + out + ' lands at ' + l.toFixed(2) + ', wanted ~0.30');
    assert.ok(/^#[0-9a-f]{6}$/i.test(out), hex + ' produced a valid hex');
  }

  // The Spotify TV preset is the reason the role exists: fixed brand colours,
  // artwork-derived gradient top.
  const spotify = BUILTINS.find((p) => p.name === 'Spotify TV');
  assert.ok(spotify, 'Spotify TV ships as a default');
  const bg = spotify.components.find((c) => c.type === 'background');
  assert.strictEqual(bg.props.color, '{dynamic}', 'backdrop top follows the artwork');
  assert.strictEqual(bg.props.color2, '#121212', 'backdrop base is #121212');
  const prog = spotify.components.find((c) => c.type === 'progress');
  assert.strictEqual(prog.props.color, '#1DB954', 'progress fill is Spotify green');
  const chips = spotify.components.filter((c) => c.type === 'shape');
  assert.ok(chips.length >= 1, 'source chip is a shape');
  assert.ok(/rgba\(/.test(chips[0].props.color), 'chip is a translucent surface');
  log('    dynamic role: ' + PAL.shadeToLightness('#1DB954', 0.3) +
      ' from Spotify green; preset binds {dynamic} + #121212 + #1DB954');
}

// ---------------------------------------------------------------------------
log('\n[7d] presets can embed their own palette');
// ---------------------------------------------------------------------------
{
  const raw = {
    version: 1, name: 'Embedded', palette: 'Neon',
    roles: { bg: '#101010', primary: '#ff00aa', bogus: '#123456', text: 'not a hex' },
    components: [{ type: 'background', props: { mode: 1, color: '{primary}', color2: '{bg}' } }],
  };
  const p = P.normalizePreset(raw);
  assert.ok(p.roles, 'roles survive normalisation');
  assert.deepStrictEqual(Object.keys(p.roles).sort(), ['bg', 'primary'],
    'only known roles with #rrggbb values are kept');
  // Round-trips through JSON, which is how presets travel to the device.
  const again = P.fromJson(P.toJson(p));
  assert.deepStrictEqual(again.roles, p.roles, 'roles survive a JSON round trip');
  assert.strictEqual(again.palette, 'Neon', 'the palette name is kept alongside');

  // An embedded block REPLACES the named palette...
  const cover = { bg: '#000', surface: '#111', primary: '#222', secondary: '#333',
                  accent: '#444', text: '#555', dynamic: '#0f622d' };
  const r = PAL.rolesForPreset(p, cover);
  assert.strictEqual(r.primary, '#ff00aa', 'embedded primary wins over Neon');
  assert.strictEqual(r.bg, '#101010', 'embedded bg wins over Neon');
  assert.strictEqual(r.text, PAL.paletteByName('Neon').roles.text,
    'roles absent from the block fall back to the named palette, not the artwork');
  // ...but dynamic is always artwork-derived.
  assert.strictEqual(r[PAL.DYNAMIC_ROLE], '#0f622d', 'dynamic still follows the artwork');

  // No roles block -> the named palette is used, unchanged.
  const plain = P.normalizePreset({ name: 'Plain', palette: 'Ocean', components: raw.components });
  assert.ok(!plain.roles, 'no roles block stays absent');
  assert.strictEqual(PAL.rolesForPreset(plain, cover).primary,
    PAL.paletteByName('Ocean').roles.primary, 'named palette still resolves');

  // From cover still works, and never leaks a stored dynamic into the preset.
  const fc = P.normalizePreset({ name: 'FC', palette: PAL.FROM_COVER, components: raw.components });
  assert.strictEqual(PAL.rolesForPreset(fc, cover).primary, cover.primary, 'From cover resolves');
  assert.ok(!('dynamic' in (fc.roles || {})), 'dynamic is never stored in the preset');
  log('    embedded roles: 2 kept of 4, palette overridden, dynamic still live');
}

// ---------------------------------------------------------------------------
log('\n[3f] per-text font family reaches the command pool');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset({
  version: 1,
  name: 'font probe',
  components: [
    { type: 'text', props: { pattern: '{title}', font: 'Inter', x: 0.05, y: 0.05, w: 0.9, h: 0.1 } },
  ],
}));
engine.setVar('title', 'Hi');
for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
let fontName = '';
for (let i = 0; i < engine.commands().count; i++) {
  const o = i * engine.commands().stride;
  if (engine.commands().data[o + F.OP] === OP.TEXT && engine.commands().data[o + F.G2] > 0) {
    fontName = engine.string(engine.commands().data[o + F.R2], engine.commands().data[o + F.G2]);
    break;
  }
}
assert.strictEqual(fontName, 'Inter', 'text font family is carried in R2/G2');
log('    text font family        : "' + fontName + '"');

// ---------------------------------------------------------------------------
log('\n[4] preset normalisation');
// ---------------------------------------------------------------------------
const messy = P.normalizePreset({
  name: 'Messy',
  components: [
    { type: 'spectrum', props: { bars: 12 } },        // partial -> defaults filled
    { type: 'not-a-real-type', props: {} },           // dropped
    { type: 'text' },                                 // no props at all
  ],
});
assert.strictEqual(messy.components.length, 2, 'unknown component types must be dropped');
assert.strictEqual(messy.components[0].props.bars, 12, 'explicit value kept');
assert.strictEqual(messy.components[0].props.roundness, P.defaultsFor('spectrum').roundness, 'default filled');
assert.strictEqual(messy.components[1].props.pattern, P.defaultsFor('text').pattern, 'text defaults filled');
assert.strictEqual(P.normalizePreset({}).components.length, 1, 'empty preset gets a background');
assert.deepStrictEqual(P.fromJson(P.toJson(messy)), messy, 'JSON round-trip is lossless');
log('    defaults + round trip   : ok');

// ---------------------------------------------------------------------------
log('\n[5] visual editing: hit-test -> drag -> preset -> engine');
// ---------------------------------------------------------------------------
// The Editor needs a DOM, so give it just enough of one.
const windowListeners = new Map();
globalThis.window = { addEventListener: (type, fn) => { windowListeners.set(type, fn); } };
const { Editor, SURFACE } = await import('../js/editor.js');

const listeners = new Map();
const overlay = {
  getContext: () => stubContext(),
  addEventListener: (type, fn) => { listeners.set(type, fn); },
  setPointerCapture() {},
  releasePointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: SURFACE.w, height: SURFACE.h }),
};

const presetObj = P.normalizePreset(NEON);
engine.loadPreset(presetObj);
const ed = new Editor({
  overlay,
  engine,
  getPreset: () => presetObj,
  onStructure: () => {},
  onSelect: () => {},
});
assert.ok(listeners.has('pointerdown') && listeners.has('pointermove') && listeners.has('pointerup'),
  'editor binds its pointer events to the overlay');
assert.ok(windowListeners.has('keydown'), 'editor binds shortcuts to the window');

// The spectrum (index 1) occupies x 0.04..0.96, y 0.42..0.92.
const inside = { x: SURFACE.w * 0.5, y: SURFACE.h * 0.65 };
const outside = { x: SURFACE.w * 0.5, y: SURFACE.h * 0.98 };   // below every box
assert.strictEqual(ed.hitBody(inside), 1, 'click in the spectrum selects the spectrum');
assert.strictEqual(ed.hitBody(outside), 0, 'clicking empty space falls through to the background');

// Drag it right by 120px and 30px down.
const before = ed.snapshot(1);
ed.select(1);
listeners.get('pointerdown')({ pointerId: 1, clientX: inside.x, clientY: inside.y });
assert.ok(ed.drag, 'pointerdown starts a move drag');
listeners.get('pointermove')({ pointerId: 1, clientX: inside.x + 120, clientY: inside.y + 30 });
listeners.get('pointerup')({ pointerId: 1 });
const after = ed.snapshot(1);
log('    spectrum box           : x ' + before.x.toFixed(3) + ' -> ' + after.x.toFixed(3) +
    ', y ' + before.y.toFixed(3) + ' -> ' + after.y.toFixed(3));
assert.ok(Math.abs((after.x - before.x) - 120 / SURFACE.w) < 0.002, 'x moved by the drag distance');
assert.ok(Math.abs((after.y - before.y) - 30 / SURFACE.h) < 0.002, 'y moved by the drag distance');
assert.strictEqual(presetObj.components[1].props.x, after.x, 'the preset object was updated');

// Handle hit-test + resize.
ed.select(1);
const box = ed.boxOf(1);
assert.ok(ed.hitHandle({ x: box.x + box.w, y: box.y + box.h }), 'bottom-right handle is hit');
assert.strictEqual(ed.hitHandle({ x: 5, y: 5 }), null, 'empty space hits no handle');
listeners.get('pointerdown')({ pointerId: 2, clientX: box.x + box.w, clientY: box.y + box.h });
listeners.get('pointermove')({ pointerId: 2, clientX: box.x + box.w - 200, clientY: box.y + box.h });
listeners.get('pointerup')({ pointerId: 2 });
const resized = ed.snapshot(1);
assert.ok(Math.abs((before.w - resized.w) - 200 / SURFACE.w) < 0.002, 'w shrank by the drag distance');
log('    resize handle          : w ' + before.w.toFixed(3) + ' -> ' + resized.w.toFixed(3));

// Structure ops keep preset and engine in sync.
engine.loadPreset(presetObj);
const n0 = ed.components.length;
ed.addComponent('meter');
assert.strictEqual(ed.components.length, n0 + 1, 'component added');
assert.strictEqual(engine.sceneCount(), n0 + 1, 'engine scene grew too');
ed.duplicateSelected();
assert.strictEqual(engine.sceneCount(), n0 + 2, 'duplicate reaches the engine');
ed.reorder(-1);
assert.strictEqual(ed.components[ed.selected].type, 'meter', 'reorder keeps the type');
ed.removeSelected();
assert.strictEqual(engine.sceneCount(), n0 + 1, 'remove reaches the engine');
log('    add/dup/reorder/remove: ok');

// ---------------------------------------------------------------------------
// [6] ID3v2 cover-art extraction.
//
// extractEmbeddedCover() lives in main.js (it needs no DOM, but is not
// exported). This pulls the function out of the real source so the test cannot
// drift from what ships, then feeds it hand-built tags.
const coverSrc = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// [3f3] Preset sourcing: the TV is the only store. Nothing may be written to
// or read from browser storage — a stale browser copy once shadowed a shipped
// preset by name, and the only symptom was a vanishing image component.
// ---------------------------------------------------------------------------
log('\n[3f3] device-only store: no browser storage anywhere');
{
  const presetsSrc = fs.readFileSync(new URL('../js/presets.js', import.meta.url), 'utf8');
  for (const src of [coverSrc, presetsSrc]) {
    assert.ok(!/localStorage/.test(src), 'browser storage reference survives');
    assert.ok(!/listUserPresets|saveUserPreset|deleteUserPreset/.test(src),
      'local preset helper survives');
  }
  assert.ok(!/localNames|shadowedLocals/.test(coverSrc), 'local-preset state survives');
  // Mutations refuse loudly instead of degrading to a silent local write.
  assert.ok(/was NOT saved/.test(coverSrc), 'persistPreset must refuse when offline');
  assert.ok(/nothing was deleted/.test(coverSrc), 'removePresets must refuse when offline');
  assert.ok(/was NOT renamed/.test(coverSrc), 'rename must refuse when offline');
  // The badge has to exist and be wired, or the condition stays invisible.
  assert.ok(/function refreshSourceBadge\(\)/.test(coverSrc), 'missing refreshSourceBadge()');
  assert.ok(/refreshSourceBadge\(\);/.test(coverSrc), 'refreshSourceBadge() is never called');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(/id="sourceBadge"/.test(html), 'index.html is missing the #sourceBadge element');
  log('    no browser storage; mutations refuse offline; badge wired');
}

// ---------------------------------------------------------------------------
// [3f2] Bundled images: the browser table and the Android mirror must agree,
// and every numeric image id a default preset references must be a real one.
// A preset naming an id nothing loads renders as a blank panel — the exact
// failure "Winamp base" hit when the Android one-shot guard skipped the
// second renderer, which no amount of engine testing would have caught.
// ---------------------------------------------------------------------------
log('\n[3f2] bundled image ids: browser/Android tables agree, presets resolve');
{
  const jsBlock = coverSrc.match(/const BUNDLED_IMAGES = \[([\s\S]*?)\];/);
  assert.ok(jsBlock, 'could not find BUNDLED_IMAGES in main.js');
  const jsIds = [...jsBlock[1].matchAll(/id:\s*(\d+),\s*path:\s*'([^']+)'/g)]
    .map((m) => ({ id: Number(m[1]), path: m[2] }));

  const kt = fs.readFileSync(
    new URL('../../app/src/main/java/com/castboxtv/app/viz/VizBundledImages.kt', import.meta.url),
    'utf8');
  const ktIds = [...kt.matchAll(/Entry\((\d+),\s*"([^"]+)"/g)]
    .map((m) => ({ id: Number(m[1]), path: m[2] }));

  assert.ok(jsIds.length > 0, 'browser bundled image table is empty');
  assert.deepStrictEqual(
    ktIds.map((e) => e.id).sort((a, b) => a - b),
    jsIds.map((e) => e.id).sort((a, b) => a - b),
    'VizBundledImages.kt and BUNDLED_IMAGES disagree on ids');
  // The Android asset path is the browser one under the studio/ assets root.
  const assetRoot = 'studio/';
  for (const e of ktIds) {
    const js = jsIds.find((j) => j.id === e.id);
    assert.strictEqual(e.path, assetRoot + js.path,
      'image #' + e.id + ' path differs: kotlin ' + e.path + ' vs js ' + js.path);
  }

  // Both asset files must actually exist, or the preset is broken at runtime.
  for (const e of jsIds) {
    const onDisk = new URL('../' + e.path, import.meta.url);
    assert.ok(fs.existsSync(onDisk), 'bundled image missing from repo: ' + e.path);
    // Table paths are joined onto this module's directory via assetUrl(), so
    // they must stay relative and must not climb out on their own.
    assert.ok(!e.path.startsWith('/') && !e.path.startsWith('..') && !e.path.includes('..'),
      'bundled path must be plain relative, got: ' + e.path);
  }
  // assetUrl() must resolve against the module, not the document: the Studio is
  // reachable at /studio and /studio/, and only the former breaks a relative
  // fetch. Anchoring on import.meta.url is what makes both work.
  assert.ok(/const assetUrl = \(path\) => new URL\('\.\.\/'\s*\+\s*path,\s*import\.meta\.url\)/.test(coverSrc),
    'main.js must resolve bundled images via import.meta.url, not a bare relative fetch');
  assert.ok(!/fetch\(\s*path\s*\)/.test(coverSrc),
    'bundled images must not be fetched with a document-relative path');
  const synced = new URL('../../app/src/main/assets/studio/' + jsIds[0].path, import.meta.url);
  assert.ok(fs.existsSync(synced), 'bundled image not synced into Android assets: ' + synced.pathname);

  // A shipped default preset may only reference ids the tables know. User
  // presets legitimately reference their own uploads, so defaults only.
  // `image` defaults to the {cover} token and `thumb` to "0" (= no thumb);
  // neither is an id, so both are skipped.
  const known = new Set(jsIds.map((e) => e.id));
  const dangling = [];
  let checked = 0;
  for (const preset of BUILTINS) {
    for (const comp of preset.components) {
      if (!comp.props) continue;
      for (const key of ['image', 'thumb']) {
        const v = comp.props[key];
        if (v === undefined || v === null || v === '' || Number(v) === 0) continue;
        if (/[{}]/.test(String(v))) continue;   // {cover}, {dynamic}, ...
        if (String(v).startsWith('data:')) continue;   // embedded base64 image
        if (Number(v) >= 10000) continue;   // reserved embedded-image ids
        checked++;
        if (!known.has(Number(v))) {
          dangling.push(preset.name + ' ' + comp.type + '.' + key + '=' + v);
        }
      }
    }
  }
  assert.ok(checked > 0, 'expected default presets to reference bundled image ids');
  assert.strictEqual(dangling.length, 0,
    'default presets reference unknown image ids: ' + dangling.join(', '));

  // "Winamp base" is the preset that regressed; keep it wired up.
  const wb = BUILTINS.find((p) => p.name === 'Winamp base');
  assert.ok(wb, 'Winamp base must ship as a default');
  const wbImg = wb.components.find((c) => c.type === 'image');
  assert.ok(wbImg && known.has(Number(wbImg.props.image)),
    'Winamp base must reference a known bundled image id');
  log('    bundled ids ' + jsIds.map((e) => e.id).join(', ') +
      ' matched across both tables; ' + BUILTINS.length + ' defaults resolve');
}

// ---------------------------------------------------------------------------
// [3f4] Paste import: the button exists, reads the clipboard first with a
// prompt fallback (TV browsers often lack the async Clipboard API), and the
// pasted text goes through the same fromJson normalisation as file import.
// ---------------------------------------------------------------------------
log('\n[3f4] paste import: clipboard with prompt fallback');
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(/id="presetPasteBtn"/.test(html), 'index.html is missing #presetPasteBtn');
  assert.ok(/presetPasteBtn/.test(coverSrc), 'main.js never wires #presetPasteBtn');
  assert.ok(/navigator\.clipboard[\s\S]{0,120}readText/.test(coverSrc),
    'paste must try navigator.clipboard.readText first');
  assert.ok(/window\.prompt\('Paste preset JSON'\)/.test(coverSrc),
    'paste must fall back to a prompt when the clipboard is unavailable');
  // Pasted JSON normalises exactly like a file import.
  const pasted = P.fromJson(JSON.stringify({
    version: 1, name: 'Pasted', palette: 'Neon',
    components: [{ type: 'text', props: { pattern: '{title}' } }, { type: 'nope', props: {} }],
  }));
  assert.strictEqual(pasted.components.length, 1, 'paste must drop unknown component types');
  assert.strictEqual(pasted.components[0].type, 'text');
  // A pasted preset may carry an image table; components referencing a
  // dropped (invalid) entry keep rendering — nothing may throw.
  const withTable = P.fromJson(JSON.stringify({
    version: 1, name: 'Tbl', images: [{ id: 10000, url: 'data:image/png;base64,AAA' }],
    components: [{ type: 'image', props: { image: '10000' } }],
  }));
  assert.deepStrictEqual(withTable.images, [{ id: 10000, url: 'data:image/png;base64,AAA' }]);
  log('    button wired, clipboard-first with prompt fallback, fromJson shared');
}

// ---------------------------------------------------------------------------
// [3f5] Embedded base64 images: extractEmbeddedImages() maps every data-URL
// prop to a deterministic reserved id without touching the stored values.
// ---------------------------------------------------------------------------
log('\n[3f5] embedded images: table survives component edits');
{
  const a = 'data:image/png;base64,iVBORw0KGgo=';
  const b = 'data:image/jpeg;base64,/9j/4AAQ=';
  // Canonical form: table + id references, no data URLs in props.
  const { preset, images } = P.extractEmbeddedImages({
    version: 1, name: 'Embed', palette: 'Neon',
    images: [{ id: 10000, url: a }, { id: 10001, url: b }, { id: 7, url: a }],
    components: [
      { type: 'background', props: { mode: 2, image: '10000' } },
      { type: 'image', props: { image: '10001' } },
      { type: 'image', props: { image: '{cover}' } },
      { type: 'text', props: { pattern: '{title}' } },
    ],
  });
  assert.strictEqual(images.length, 2, 'two valid entries; id 7 rejected, got ' + images.length);
  assert.deepStrictEqual(preset.images, [{ id: 10000, url: a }, { id: 10001, url: b }]);
  const got = preset.components.map((c) => c.props.image);
  assert.deepStrictEqual(got.slice(0, 4), ['10000', '10001', '{cover}', undefined]);
  // Pre-table pastes upgrade stray prop data URLs into the table.
  const upgraded = P.normalizePreset({
    version: 1, name: 'Old', components: [
      { type: 'background', props: { mode: 2, image: a } },
      { type: 'image', props: { image: a } },
      { type: 'cover', props: { image: b } },
    ],
  });
  assert.deepStrictEqual(upgraded.images, [{ id: 10000, url: a }, { id: 10001, url: b }]);
  assert.strictEqual(upgraded.components[0].props.image, '10000');
  assert.strictEqual(upgraded.components[2].props.image, '10001');
  // Deleting every component leaves the table intact: art is preset data,
  // not component data.
  const stripped = P.normalizePreset(Object.assign({}, upgraded, { components: [] }));
  assert.ok(Array.isArray(stripped.images) && stripped.images.length === 2,
    'image table must survive with zero components');
  // Past the cap the extras are dropped, never half-kept.
  const many = { version: 1, name: 'Many', images: [], components: [] };
  for (let i = 0; i < 10; i++) many.images.push({ id: 10000 + i, url: 'data:image/png;base64,#' + i });
  assert.strictEqual(P.normalizePreset(many).images.length, P.EMBEDDED_IMAGE_MAX);
  log('    table validated, old pastes upgraded, table outlives components');
}

// ---------------------------------------------------------------------------
// [3f6] Embedded images survive structural edits: every engine rebuild must
// go through the data-URL binder. removeSelected() -> resync() used to push
// raw data URLs at the engine (atoi -> 0), blanking every embedded image.
// ---------------------------------------------------------------------------
log('\n[3f6] embedded images survive add/remove/reorder');
{
  const editorSrc = fs.readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');
  assert.ok(/this\.forEngine = opts\.forEngine/.test(editorSrc),
    'Editor must accept a forEngine binder');
  assert.ok(/this\.engine\.loadPreset\(this\.forEngine\(this\.getPreset\(\)\)\)/.test(editorSrc),
    'resync must bind the preset for the engine, never push it raw');
  assert.ok(/forEngine: bindPresetForEngine/.test(coverSrc),
    'main.js must inject the binder into the Editor');
  assert.ok(/function bindPresetForEngine\(preset\)/.test(coverSrc),
    'main.js is missing bindPresetForEngine()');
  // The binder never mutates the stored preset: data URLs stay portable.
  const url = 'data:image/png;base64,iVBORw0KGgo=';
  const stored = { version: 1, name: 'S', components: [{ type: 'image', props: { image: url } }] };
  const { preset: bound } = P.extractEmbeddedImages(stored);
  assert.ok(String(stored.components[0].props.image).startsWith('data:'),
    'binding must not mutate the stored preset');
  assert.strictEqual(bound.components[0].props.image, '10000');
  log('    resync routes through the binder; stored preset keeps data URLs');

  // Behavioural: deleting a component rebuilds the scene through the binder,
  // so the engine receives the reserved id — the exact regression (raw data
  // URLs atoi() to 0 and every embedded image blanked).
  {
    const withEmbed = P.normalizePreset({ version: 1, name: 'S', components: [
      { type: 'image', props: { image: url } },
      { type: 'text', props: { pattern: '{title}' } },
    ]});
    let pushed = null;
    const ed2 = new Editor({
      overlay,
      engine: { loadPreset: (p) => { pushed = p; } },
      getPreset: () => withEmbed,
      forEngine: (p) => P.extractEmbeddedImages(p).preset,
      onStructure: () => {},
      onSelect: () => {},
    });
    ed2.select(1);
    ed2.removeSelected();
    const img = pushed.components.find((c) => c.type === 'image').props.image;
    assert.strictEqual(img, '10000', 'delete pushed raw data URL to the engine, got ' + String(img).slice(0, 20));
    assert.deepStrictEqual(withEmbed.images, [{ id: 10000, url }],
      'stored image table lost its entry on delete');
    assert.strictEqual(withEmbed.components[0].props.image, '10000');
    log('    delete -> resync pushes id 10000, stored table untouched');
  }
}
const coverFn = coverSrc.match(/function extractEmbeddedCover\(file\) \{[\s\S]*?\n\}/);
assert.ok(coverFn, 'could not extract extractEmbeddedCover() from main.js');
const extractEmbeddedCover = new Function('return ' + coverFn[0])();

// Stands in for a File/Blob: only .slice().arrayBuffer() is used. arrayBuffer
// must return a promise, exactly as the real Blob does. byteOffset matters:
// small Node Buffers come from a shared pool, so slicing buf.buffer directly
// by buf.length would read unrelated bytes first.
const fake = (buf) => ({
  size: buf.length,
  slice: (a, b) => {
    // Real Blob.slice clamps to the file size; the 4 MB read in the parser
    // deliberately asks for more than a small test file contains.
    const from = Math.max(0, buf.byteOffset + a);
    const to = Math.min(buf.byteOffset + buf.length, b === undefined ? Infinity : buf.byteOffset + b);
    return { arrayBuffer: () => Promise.resolve(buf.buffer.slice(from, to)) };
  },
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

/** Builds an ID3v2 tag around one picture frame, in front of some audio bytes. */
function buildMp3({ major = 3, mime = 'image/png', format = null, desc = 'front' } = {}) {
  const parts = [Buffer.from([0])];                        // text encoding: latin1
  parts.push(format
    ? Buffer.from(format, 'latin1')                        // v2.2: bare 3-char format
    : Buffer.concat([Buffer.from(mime, 'latin1'), Buffer.from([0])]));
  parts.push(Buffer.from([3]));                            // picture type: front cover
  parts.push(Buffer.concat([Buffer.from(desc, 'latin1'), Buffer.from([0])]));
  parts.push(PNG);
  const body = Buffer.concat(parts);
  const id = major === 2 ? 'PIC' : 'APIC';
  const sizeBuf = major === 2 ? Buffer.alloc(3) : Buffer.alloc(4);
  if (major === 2) {                                      // v2.2: 3-byte big-endian
    sizeBuf[0] = (body.length >> 16) & 0xff;
    sizeBuf[1] = (body.length >> 8) & 0xff;
    sizeBuf[2] = body.length & 0xff;
  } else if (major === 4) {                               // v2.4: 4-byte synchsafe
    sizeBuf[0] = (body.length >> 21) & 0x7f; sizeBuf[1] = (body.length >> 14) & 0x7f;
    sizeBuf[2] = (body.length >> 7) & 0x7f;  sizeBuf[3] = body.length & 0x7f;
  } else {                                                // v2.3: 4-byte big-endian
    sizeBuf.writeUInt32BE(body.length);
  }
  const frame = Buffer.concat([Buffer.from(id, 'latin1'), sizeBuf, Buffer.alloc(major === 2 ? 0 : 2), body]);
  const tagSize = frame.length;
  const tag = Buffer.concat([
    Buffer.from('ID3', 'latin1'), Buffer.from([major, 0, 0]),
    Buffer.from([(tagSize >> 21) & 0x7f, (tagSize >> 14) & 0x7f, (tagSize >> 7) & 0x7f, tagSize & 0x7f]),
    frame,
  ]);
  return Buffer.concat([tag, Buffer.alloc(512)]);         // trailing "audio"
}

log('\n[6] ID3v2 cover extraction');
for (const [label, opts] of [
  ['ID3v2.3 APIC', { major: 3 }],
  ['ID3v2.4 APIC', { major: 4 }],
  ['ID3v2.2 PIC ', { major: 2, format: 'PNG' }],
]) {
  const blob = await extractEmbeddedCover(fake(buildMp3(opts)));
  assert.ok(blob, label + ': no blob returned');
  assert.strictEqual(blob.type, 'image/png', label + ': wrong mime type');
  assert.strictEqual(blob.size, PNG.length, label + ': wrong payload length');
  log('    ' + label + '   : ' + blob.type + ', ' + blob.size + ' bytes');
}

const noDesc = await extractEmbeddedCover(fake(buildMp3({ desc: '' })));
assert.ok(noDesc && noDesc.size === PNG.length, 'frame with an empty description');
log('    empty description: ok');

// Negative cases must resolve to null, never throw.
for (const [label, buf] of [
  ['no ID3 header', Buffer.from('this is definitely not an mp3 file')],
  ['empty buffer ', Buffer.alloc(0)],
  ['truncated tag', buildMp3().subarray(0, 14)],
  ['garbage size', Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0]), Buffer.from([0xff, 0xff, 0xff, 0xff])])],
  ['header only ', buildMp3().subarray(0, 10)],
]) {
  assert.strictEqual(await extractEmbeddedCover(fake(buf)), null, label + ': expected null');
}
log('    malformed input  : null (no throw)');

assert.strictEqual(await extractEmbeddedCover(fake(buildMp3({ mime: 'text/plain' }))), null,
  'non-image mime should be rejected rather than handed to createImageBitmap');
log('    text/plain mime : null');

// ---------------------------------------------------------------------------
log('\n[6b] ID3 text tags (title / artist / album)');
// ---------------------------------------------------------------------------
const tagSrc = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const decFn = tagSrc.match(/function decodeId3Text\(u8, start, end\) \{[\s\S]*?\n\}/);
const tagFn = tagSrc.match(/async function extractId3Tags\(file\) \{[\s\S]*?\n\}/);
assert.ok(decFn && tagFn, 'could not extract the ID3 text helpers from main.js');
const extractId3Tags = new Function(
  'return (function(){' + decFn[0] + '\n' + tagFn[0] + '\nreturn extractId3Tags;})()')();

function v2Frame(id, enc, text) {
  const bytes = enc === 1 ? Buffer.from(text, 'utf16le')
    : enc === 3 ? Buffer.from(text, 'utf8')
      : Buffer.from(text, 'latin1');
  const body = Buffer.concat([
    Buffer.from([enc]),
    bytes,
    Buffer.from(enc === 2 ? [0, 0] : [0]),
  ]);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(id, 'latin1'), sizeBuf, Buffer.alloc(2), body]);
}
function buildTag(frames) {
  const body = Buffer.concat(frames);
  const tag = Buffer.concat([
    Buffer.from('ID3'), Buffer.from([3, 0, 0]),
    Buffer.from([(body.length >> 21) & 0x7f, (body.length >> 14) & 0x7f,
      (body.length >> 7) & 0x7f, body.length & 0x7f]),
    body,
  ]);
  return Buffer.concat([tag, Buffer.alloc(256)]);
}

const tags = await extractId3Tags(fake(buildTag([
  v2Frame('TIT2', 0, 'Vreau Sarutarea Ta'),
  v2Frame('TPE1', 0, 'Andra'),
  v2Frame('TALB', 0, 'Vreau sarutarea ta'),
  v2Frame('TRCK', 0, '63'),
  v2Frame('TCON', 0, 'Music'),
])));
assert.strictEqual(tags.title, 'Vreau Sarutarea Ta', 'TIT2 title');
assert.strictEqual(tags.artist, 'Andra', 'TPE1 artist');
assert.strictEqual(tags.album, 'Vreau sarutarea ta', 'TALB album');
assert.strictEqual(tags.track, '63', 'TRCK track');
log('    ID3v2.3 latin1  : "' + tags.title + '" / "' + tags.artist + '" / "' + tags.album + '"');

const utf16 = await extractId3Tags(fake(buildTag([v2Frame('TPE1', 1, '\ufeffAndra')])));
assert.strictEqual(utf16.artist, 'Andra', 'UTF-16 BOM artist');
const utf8 = await extractId3Tags(fake(buildTag([v2Frame('TIT2', 3, 'Vreau Șarutarea')])));
assert.strictEqual(utf8.title, 'Vreau Șarutarea', 'UTF-8 encoded title');
log('    UTF-16 / UTF-8  : "' + utf16.artist + '" / "' + utf8.title + '"');

const v1 = Buffer.alloc(128);
Buffer.from('TAG', 'latin1').copy(v1, 0);
Buffer.from('Song', 'latin1').copy(v1, 3);
Buffer.from('Band', 'latin1').copy(v1, 33);
Buffer.from('Record', 'latin1').copy(v1, 63);
const v1Tags = await extractId3Tags(fake(Buffer.concat([Buffer.alloc(64), v1])));
assert.strictEqual(v1Tags.title, 'Song', 'ID3v1 title fallback');
assert.strictEqual(v1Tags.artist, 'Band', 'ID3v1 artist fallback');
log('    ID3v1 trailer   : "' + v1Tags.title + '" / "' + v1Tags.artist + '"');

assert.deepStrictEqual(await extractId3Tags(fake(Buffer.from('not music'))),
  { title: '', artist: '', album: '', track: '', genre: '', year: '' }, 'garbage -> empty tags');

// ---------------------------------------------------------------------------
log('\n[6c] gaussian box blur spreads light, preserves flat areas');
// ---------------------------------------------------------------------------
const { boxBlurImageData } = await import('../js/renderer.js');
{
  // flat mid-grey stays untouched
  const flat = new Float32Array(8 * 8 * 4).fill(128);
  boxBlurImageData(flat, 8, 8, 6);
  assert.ok(flat.every((v) => Math.abs(v - 128) < 0.01), 'flat field unchanged');

  // single white pixel on black spreads to neighbours and dims the center
  const w = 32, h = 32;
  const data = new Float32Array(w * h * 4);
  const at = (x, y) => (y * w + x) * 4;
  data[at(16, 16)] = 255; data[at(16, 16) + 1] = 255; data[at(16, 16) + 2] = 255;
  for (let k = 0; k < 3; k++) boxBlurImageData(data, w, h, 4);
  assert.ok(data[at(16, 16)] < 200, 'impulse center dims, got ' + data[at(16, 16)].toFixed(1));
  assert.ok(data[at(19, 16)] > 1, 'impulse reaches 3px out, got ' + data[at(19, 16)].toFixed(2));
  assert.ok(data[at(28, 28)] < 0.5, 'far pixels stay black, got ' + data[at(28, 28)].toFixed(2));
  log('    impulse spread          : center ' + data[at(16, 16)].toFixed(1) +
      ', +3px ' + data[at(19, 16)].toFixed(2) + ', far ' + data[at(28, 28)].toFixed(2));
}

// ---------------------------------------------------------------------------
log('\n[3i] inspector: numeric inputs + live sync on canvas drag');
// ---------------------------------------------------------------------------
const { renderInspector } = await import('../js/editor.js');

// Minimal DOM stand-in: only what makeControl/renderInspector touch.
function fakeEl(tag) {
  return {
    tag, children: [], className: '', textContent: '', value: '', title: '',
    type: '', min: '', max: '', step: '', disabled: false, checked: false,
    placeholder: '', selectedIndex: 0, style: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { this['on' + type] = fn; },
  };
}
globalThis.document = { createElement: (t) => fakeEl(t), activeElement: null };

const inspBox = fakeEl('div');
const inspPreset = P.normalizePreset(NEON);
engine.loadPreset(inspPreset);
const listeners2 = new Map();
const overlay2 = {
  getContext: () => stubContext(),
  addEventListener: (type, fn) => { listeners2.set(type, fn); },
  setPointerCapture() {},
  releasePointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: SURFACE.w, height: SURFACE.h }),
};
const ed2 = new Editor({
  overlay: overlay2,
  engine,
  getPreset: () => inspPreset,
  getPalette: () => ({}),
  onStructure: () => {},
  onSelect: () => {},
});
ed2.select(1);   // the spectrum
renderInspector(inspBox, ed2);
const xCtl = ed2.inspectorControls.get('x');
const barsCtl = ed2.inspectorControls.get('bars');
assert.ok(xCtl && barsCtl, 'range props register live controls');
assert.strictEqual(xCtl.num.type, 'number', 'value readout is an editable input');
assert.strictEqual(xCtl.slider.value, String(inspPreset.components[1].props.x), 'slider seeded from preset');

// Typing an exact value commits it to the preset + engine.
barsCtl.num.value = '24';
barsCtl.num.onchange();
assert.strictEqual(inspPreset.components[1].props.bars, 24, 'typed value commits to preset');

// A canvas drag pushes the new geometry back into slider + input.
const inspPt = { x: SURFACE.w * 0.5, y: SURFACE.h * 0.65 };
ed2.select(1);
listeners2.get('pointerdown')({ pointerId: 9, clientX: inspPt.x, clientY: inspPt.y });
listeners2.get('pointermove')({ pointerId: 9, clientX: inspPt.x + 128, clientY: inspPt.y });
listeners2.get('pointerup')({ pointerId: 9 });
const afterX = inspPreset.components[1].props.x;
assert.strictEqual(parseFloat(ed2.inspectorControls.get('x').slider.value), afterX, 'slider follows the drag');
assert.strictEqual(parseFloat(ed2.inspectorControls.get('x').num.value), afterX, 'numeric input follows the drag');
log('    typed bars=24 committed; drag -> x=' + afterX.toFixed(3) + ' reflected in slider+input');

// Comma decimals (RO locale "0,38") must commit as 0.38, not parseFloat's 0.
const gapCtl = ed2.inspectorControls.get('gap');
gapCtl.num.value = '0,38';
gapCtl.num.onchange();
assert.strictEqual(inspPreset.components[1].props.gap, 0.38, 'comma decimal commits');
log('    typed gap "0,38" committed as 0.38');
delete globalThis.document;

// ---------------------------------------------------------------------------
log('\n[3r] font dropdown commits the family string, not NaN');
// ---------------------------------------------------------------------------
globalThis.document = { createElement: (t) => fakeEl(t), activeElement: null };
{
  const listeners4 = new Map();
  const overlay4 = {
    getContext: () => stubContext(),
    addEventListener: (type, fn) => { listeners4.set(type, fn); },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SURFACE.w, height: SURFACE.h }),
  };
  const fontPreset = P.normalizePreset({
    version: 1, name: 'font ui probe',
    components: [{ type: 'text', props: { pattern: '{title}', x: 0.05, y: 0.05, w: 0.9, h: 0.1 } }],
  });
  engine.loadPreset(fontPreset);
  const ed4 = new Editor({
    overlay: overlay4, engine, getPreset: () => fontPreset, getPalette: () => ({}),
    onStructure: () => {}, onSelect: () => {},
  });
  ed4.select(0);
  const box = fakeEl('div');
  renderInspector(box, ed4);
  const findSelects = (el, out) => {
    out = out || [];
    if (el.tag === 'select') out.push(el);
    (el.children || []).forEach((c) => findSelects(c, out));
    return out;
  };
  const fontSel = findSelects(box).find((s) =>
    (s.children || []).some((o) => o.value === 'Inter'));
  assert.ok(fontSel, 'font dropdown renders with family options');
  fontSel.value = 'DSEG7 Classic';
  fontSel.onchange();
  assert.strictEqual(fontPreset.components[0].props.font, 'DSEG7 Classic', 'family string commits to preset');
  engine.setVar('title', 'Hi');
  for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  let family = '';
  const fc = engine.commands();
  for (let i = 0; i < fc.count; i++) {
    const o = i * fc.stride;
    if (fc.data[o + F.OP] === OP.TEXT && fc.data[o + F.G2] > 0) {
      family = engine.string(fc.data[o + F.R2], fc.data[o + F.G2]);
      break;
    }
  }
  assert.strictEqual(family, 'DSEG7 Classic', 'family reaches the draw commands');
  log('    dropdown -> preset -> engine commands: "' + family + '"');
}
delete globalThis.document;

// ---------------------------------------------------------------------------
log('\n[3q] progress thumb rides the fill edge');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'thumb probe',
  components: [
    { type: 'progress', props: { x: 0.05, y: 0.9, w: 0.9, h: 0.02, thumb: '11', thumbScale: 1.5 } },
  ],
}));
engine.setVar('positionSec', 100);
engine.setVar('durationSec', 200);
for (let f = 0; f < 2; f++) { engine.pushAudio(window_); engine.frame(16.7); }
{
  let found = 0, tx = -1, tw = -1;
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.IMAGE && c.data[o + F.IMG] === 11) {
      found++;
      tx = c.data[o + F.X];
      tw = c.data[o + F.W];
    }
  }
  assert.strictEqual(found, 1, 'thumb image emitted once, got ' + found);
  // fill at 50%: thumb centered on the edge (thumb wider than tall: 27x10)
  const edge = 0.05 * 1280 + 0.9 * 1280 * 0.5;
  const th = 0.02 * 720 * 1.5, expectW = th * 27 / 10;
  assert.ok(Math.abs(tx + tw / 2 - edge) < 2, 'thumb centered on fill edge, got ' + tx.toFixed(1));
  assert.ok(Math.abs(tw - expectW) < 1, 'thumb keeps sprite aspect, got ' + tw.toFixed(1));
  log('    thumb at x=' + tx.toFixed(1) + ' w=' + tw.toFixed(1) + ' (edge ' + edge.toFixed(1) + ')');
}

// ---------------------------------------------------------------------------
log('\n[3m] spectrum gradient modes + bar segments');
// ---------------------------------------------------------------------------
function gradRects(cmds) {
  const out = [];
  for (let i = 0; i < cmds.count; i++) {
    const o = i * cmds.stride;
    if (cmds.data[o + F.OP] === OP.GRADIENT_RECT) {
      out.push({
        r: cmds.data[o + F.R], g: cmds.data[o + F.G], b: cmds.data[o + F.B],
        r2: cmds.data[o + F.R2], g2: cmds.data[o + F.G2], b2: cmds.data[o + F.B2],
        h: cmds.data[o + F.H],
      });
    }
  }
  return out;
}
function rectHs(cmds) {
  const out = [];
  for (let i = 0; i < cmds.count; i++) {
    const o = i * cmds.stride;
    if (cmds.data[o + F.OP] === OP.RECT) out.push(cmds.data[o + F.H]);
  }
  return out;
}

// reveal: bottom-anchored bars always start at color1 (red), whatever height
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'reveal probe',
  components: [{ type: 'spectrum', props: {
    bars: 8, gradient: true, gradientMode: 1, color: '#ff0000', color2: '#0000ff',
    x: 0.05, y: 0.5, w: 0.9, h: 0.2 } }],
}));
for (let f = 0; f < 6; f++) { engine.pushAudio(window_); engine.frame(16.7); }
{
  const rects = gradRects(engine.commands());
  assert.ok(rects.length >= 8, 'reveal emits gradient bars, got ' + rects.length);
  assert.ok(rects.every((c) => c.r > 0.9 && c.b < 0.1),
    'every reveal bar starts at color1 regardless of height');
  log('    reveal: ' + rects.length + ' bars, all rooted in color1');
}

// palette: bottom-anchored bars start at the bg role (dark), not color1
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'palette probe',
  components: [{ type: 'spectrum', props: {
    bars: 8, gradient: true, gradientMode: 2, color: '#ff0000', color2: '#0000ff',
    x: 0.05, y: 0.5, w: 0.9, h: 0.2 } }],
}));
['bg', 'surface', 'primary', 'secondary', 'accent', 'text'].forEach((role, i) =>
  engine.setVar(role, ['#101010', '#303030', '#ff0000', '#00ff00', '#0000ff', '#ffffff'][i]));
for (let f = 0; f < 6; f++) { engine.pushAudio(window_); engine.frame(16.7); }
{
  const rects = gradRects(engine.commands());
  assert.ok(rects.length >= 8, 'palette emits gradient bars, got ' + rects.length);
  assert.ok(rects.every((c) => c.r < 0.3 && c.g < 0.3 && c.b < 0.3),
    'palette bars root in the dark bg role, ignoring color1');
  log('    palette: ' + rects.length + ' bars, all rooted in {bg}');
}

// segments: equal-height blocks, more rects than bars.
// A chord across the spectrum lights every bar; a pure tone would not.
const chord = new Float32Array(2048);
for (let i = 0; i < 2048; i++) {
  const t = i / 44100;
  // uneven amplitudes so bars light differently (a flat signal would make the
  // mirror symmetry assert vacuous)
  chord[i] = 0.5 * Math.sin(2 * Math.PI * 90 * t) + 0.12 * Math.sin(2 * Math.PI * 350 * t) +
    0.35 * Math.sin(2 * Math.PI * 900 * t) + 0.06 * Math.sin(2 * Math.PI * 2500 * t) +
    0.22 * Math.sin(2 * Math.PI * 7000 * t);
}
const feedChord = (frames) => { for (let f = 0; f < frames; f++) { engine.pushAudio(chord); engine.frame(16.7); } };
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'segments probe',
  components: [{ type: 'spectrum', props: {
    bars: 48, gain: 2.5, segmentShape: 2, segmentGap: 0.2,
    x: 0.05, y: 0.5, w: 0.9, h: 0.2 } }],
}));
feedChord(8);
{
  const hs = rectHs(engine.commands());
  const barW = (0.9 * 1280 / 48) * 0.8;
  assert.ok(hs.length > 48, 'segments emit more rects than bars, got ' + hs.length);
  assert.ok(hs.every((h) => Math.abs(h - barW) < 0.05),
    'every square block is exactly the bar width (' + barW.toFixed(1) + 'px)');
  log('    squares: ' + hs.length + ' perfect ' + barW.toFixed(1) + 'px blocks');
}

// half squares are exactly half the bar width tall
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'half probe',
  components: [{ type: 'spectrum', props: {
    bars: 48, gain: 2.5, segmentShape: 3, segmentGap: 0.2,
    x: 0.05, y: 0.5, w: 0.9, h: 0.2 } }],
}));
feedChord(8);
{
  const hs = rectHs(engine.commands());
  const barW = (0.9 * 1280 / 48) * 0.8;
  assert.ok(hs.length > 48, 'half squares emit, got ' + hs.length);
  assert.ok(hs.every((h) => Math.abs(h - barW / 2) < 0.05),
    'every half block is half the bar width (' + (barW / 2).toFixed(1) + 'px)');
  log('    half squares: ' + hs.length + ' blocks of ' + (barW / 2).toFixed(1) + 'px');
}

// circle segments emit discs instead of rects
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'disc probe',
  components: [{ type: 'spectrum', props: {
    bars: 48, gain: 2.5, segmentShape: 1, segmentGap: 0.2,
    x: 0.05, y: 0.5, w: 0.9, h: 0.2 } }],
}));
feedChord(8);
{
  let discs = 0, perfect = 0;
  const barW = (0.9 * 1280 / 48) * 0.8;
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.CIRCLE) continue;
    discs++;
    if (Math.abs(c.data[o + F.W] - barW) < 0.05 && Math.abs(c.data[o + F.H] - barW) < 0.05) perfect++;
  }
  assert.ok(discs > 48, 'circle segments emit discs, got ' + discs);
  assert.strictEqual(perfect, discs, 'every disc is a perfect dot');
  log('    discs: ' + discs + ' perfect ' + barW.toFixed(1) + 'px dots');
}

// centered segments expand from the middle: every row mirrors about cy
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'center probe',
  components: [{ type: 'spectrum', props: {
    bars: 48, gain: 2.5, centered: true, segmentShape: 2, segmentGap: 0.2,
    x: 0.05, y: 0.5, w: 0.9, h: 0.2 } }],
}));
feedChord(8);
{
  const ys = [];
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.RECT) continue;
    ys.push(c.data[o + F.Y] + c.data[o + F.H] / 2);
  }
  const cy = (0.5 + 0.1) * 720;
  assert.ok(ys.length > 10, 'centered segments emit, got ' + ys.length);
  assert.ok(ys.every((y) => ys.some((z) => Math.abs(z - (2 * cy - y)) < 1.5)),
    'every segment row mirrors about cy=' + cy);
  log('    centered: ' + ys.length + ' rows symmetric about cy=' + cy);
}

// reflection: rects below the box bottom mirror the bars, fading out
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'reflection probe',
  components: [{ type: 'spectrum', props: {
    bars: 8, gain: 2.5, reflection: true, x: 0.05, y: 0.2, w: 0.9, h: 0.3 } }],
}));
feedChord(8);
{
  const boxBottom = (0.2 + 0.3) * 720;
  let below = 0, faded = 0, above = 0;
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.RECT && c.data[o + F.OP] !== OP.GRADIENT_RECT) continue;
    if (c.data[o + F.Y] >= boxBottom - 1) { below++; if (c.data[o + F.A] < 0.4) faded++; }
    else above++;
  }
  assert.ok(above > 0 && below > 0, 'bars above + reflection below, got ' + above + '/' + below);
  assert.strictEqual(faded, below, 'every reflection rect is faded');
  log('    reflection: ' + above + ' bars + ' + below + ' faded mirrors');
}

// reflection is ignored for center-anchored bars
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'center reflection probe',
  components: [{ type: 'spectrum', props: {
    bars: 8, gain: 2.5, centered: true, reflection: true, x: 0.05, y: 0.2, w: 0.9, h: 0.3 } }],
}));
feedChord(8);
{
  const boxBottom = (0.2 + 0.3) * 720;
  let below = 0;
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if ((c.data[o + F.OP] === OP.RECT || c.data[o + F.OP] === OP.GRADIENT_RECT) && c.data[o + F.Y] >= boxBottom - 1) below++;
  }
  assert.strictEqual(below, 0, 'center mode emits nothing below the box, got ' + below);
  log('    center + reflection: no spill below the box');
}

// beat rings stay circular in non-square boxes (inscribed, not stretched)
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'beat probe',
  components: [{ type: 'beat', props: { x: 0.2, y: 0.1, w: 0.6, h: 0.4, rings: 2 } }],
}));
for (let f = 0; f < 3; f++) { engine.pushAudio(window_); engine.frame(16.7); }
{
  let rings = 0;
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.CIRCLE) continue;
    rings++;
    assert.ok(Math.abs(c.data[o + F.W] - c.data[o + F.H]) < 0.01, 'ring stays circular in a 0.6x0.4 box');
  }
  assert.ok(rings >= 2, 'beat emits its rings, got ' + rings);
  log('    beat rings: ' + rings + ' true circles in a non-square box');
}
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'mirror probe',
  components: [{ type: 'spectrum', props: {
    bars: 32, gain: 2.5, mirror: true, segmentShape: 2, segmentGap: 0.2,
    x: 0.05, y: 0.5, w: 0.9, h: 0.2 } }],
}));
feedChord(10);
{
  const byX = new Map();
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.RECT) continue;
    const key = Math.round(c.data[o + F.X]);
    byX.set(key, (byX.get(key) || 0) + 1);
  }
  const xs = [...byX.keys()].sort((a, b) => a - b);
  // every bar maps to a distinct x bucket (bars are ~36px apart here)
  assert.ok(xs.length >= 24, 'most bars lit, got ' + xs.length + ' buckets');
  const lit = xs.map((x) => byX.get(x));
  assert.deepStrictEqual(lit, lit.slice().reverse(), 'mirrored bars light equally: ' + lit);
  log('    mirror: lit counts symmetric [' + lit + ']');
}

// ---------------------------------------------------------------------------
log('\n[3p] marquee holds, gaps, and wraps like Spotify');
// ---------------------------------------------------------------------------
const marqueeProbe = (over, frames) => {
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'marquee probe',
    components: [{ type: 'text', props: Object.assign({
      pattern: 'This is a very long track title that must scroll along',
      marquee: true, marqueeSpeed: 200, shadow: false,
      x: 0.05, y: 0.05, w: 0.2, h: 0.1, size: 0.05 }, over || {}) }],
  }));
  for (let f = 0; f < frames; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  const out = [];
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.TEXT && c.data[o + F.STRLEN] > 0) out.push(c.data[o + F.X]);
  }
  return out;
};
{
  // hold: with the default 5s pause the text sits at the box edge at first
  const txs = marqueeProbe({}, 3);
  assert.ok(txs.length >= 1, 'marquee text emits');
  assert.ok(txs.every((x) => Math.abs(x - 0.05 * 1280) < 0.01), 'holds still during the pause, got ' + txs);
  log('    hold at start: tx=' + txs[0].toFixed(1));
}
{
  // wrap: after a full cycle two copies exist, head left of the box, gap ahead
  const txs = marqueeProbe({ marqueePause: 0 }, 320);
  assert.strictEqual(txs.length, 2, 'second copy bridges the wrap, got ' + txs.length);
  assert.ok(txs[0] < 0.05 * 1280, 'head scrolled left, got ' + txs[0].toFixed(1));
  assert.ok(txs[1] > txs[0] + 100, 'gap copy ahead, got ' + txs[1].toFixed(1));
  log('    wrap copies at ' + txs[0].toFixed(0) + ' / +' + (txs[1] - txs[0]).toFixed(0) + 'px');
}

// ---------------------------------------------------------------------------
log('\n[3o] particle shapes, size spread, color modes, tunnel');
// ---------------------------------------------------------------------------
function countOps(cmds, op) {
  let n = 0;
  for (let i = 0; i < cmds.count; i++) if (cmds.data[i * cmds.stride + F.OP] === op) n++;
  return n;
}
const particleProbe = (over) => {
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'shape probe',
    components: [{ type: 'particles', props: Object.assign(
      { mode: 0, count: 24, x: 0, y: 0, w: 1, h: 1 }, over || {}) }],
  }));
  for (let f = 0; f < 10; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  return engine.commands();
};
{
  // one assertion per shape: squares->rects, triangles->3-gons, lines, hearts->14-gons
  let c = particleProbe({ shape: 1 });
  assert.ok(countOps(c, OP.RECT) >= 20, 'squares emit rects, got ' + countOps(c, OP.RECT));
  c = particleProbe({ shape: 2 });
  let tris = 0;
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.POLYGON && (c.data[o + F.P0] | 0) === 3) tris++;
  }
  assert.ok(tris >= 15, 'triangles emit 3-gons, got ' + tris);
  c = particleProbe({ shape: 3 });
  assert.ok(countOps(c, OP.LINE) >= 15, 'lines emit streaks, got ' + countOps(c, OP.LINE));
  c = particleProbe({ shape: 4 });
  let hearts = 0;
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.POLYGON && (c.data[o + F.P0] | 0) === 14) hearts++;
  }
  assert.ok(hearts >= 15, 'hearts emit 14-gons, got ' + hearts);
  log('    shapes: squares/triangles/lines/hearts all emit');
}
{
  // mixed emits at least two different primitive kinds
  const c = particleProbe({ shape: 5 });
  const kinds = [OP.RECT, OP.CIRCLE, OP.LINE, OP.POLYGON].filter((op) => countOps(c, op) > 0);
  assert.ok(kinds.length >= 2, 'mixed emits several kinds, got ' + kinds);
  log('    mixed: ' + kinds.length + ' primitive kinds in one frame');
}
function circleRadii(cmds) {
  const out = [];
  for (let i = 0; i < cmds.count; i++) {
    const o = i * cmds.stride;
    if (cmds.data[o + F.OP] === OP.CIRCLE) out.push(cmds.data[o + F.W] / 2);
  }
  return out;
}
{
  // sizeVar spreads radii; without it the spread is only the life envelope
  const spread = (cmds) => {
    const r = circleRadii(cmds);
    return Math.max(...r) - Math.min(...r);
  };
  const s0 = spread(particleProbe({ shape: 0, size: 0.04, sizeVar: 0 }));
  const s1 = spread(particleProbe({ shape: 0, size: 0.04, sizeVar: 1 }));
  assert.ok(s1 > s0 * 1.5, 'sizeVar spreads radii ' + s0.toFixed(2) + ' -> ' + s1.toFixed(2));
  log('    sizeVar: radius spread ' + s0.toFixed(2) + ' -> ' + s1.toFixed(2));
}
{
  // rotation: squares become rotated 4-gons with varying angles, while
  // rotation 0 keeps the fast rect path
  const edgeAngle = (cmds, o) => {
    const pts = engine.points();
    const off = (cmds.data[o + F.P1] | 0) * 2;
    return Math.atan2(pts[off + 3] - pts[off + 1], pts[off + 2] - pts[off]);
  };
  const c = particleProbe({ shape: 1, rotation: 1, count: 24 });
  let quads = 0;
  const angles = new Set();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.POLYGON || (c.data[o + F.P0] | 0) !== 4) continue;
    quads++;
    angles.add(edgeAngle(c, o).toFixed(2));
  }
  assert.ok(quads >= 15, 'rotated squares emit 4-gons, got ' + quads);
  assert.ok(angles.size >= 3, 'squares vary in angle, got ' + angles.size);
  const c0 = particleProbe({ shape: 1, rotation: 0, count: 24 });
  assert.ok(countOps(c0, OP.RECT) >= 15, 'no rotation keeps rects, got ' + countOps(c0, OP.RECT));
  log('    rotation: ' + quads + ' quads in ' + angles.size + ' angles; rects at 0');
}
{
  // tunnel: particles everywhere, radii growing with distance from center
  const c = particleProbe({ mode: 5, shape: 0, count: 48 });
  const r = circleRadii(c);
  assert.ok(r.length >= 30, 'tunnel emits, got ' + r.length);
  assert.ok(Math.max(...r) - Math.min(...r) > 1, 'tunnel radii vary with depth');
  log('    tunnel: ' + r.length + ' circles with perspective sizes');
}

const barPrimaries = (over) => {
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'color probe',
    components: [{ type: 'spectrum', props: Object.assign(
      { bars: 8, x: 0.05, y: 0.5, w: 0.9, h: 0.2 }, over || {}) }],
  }));
  for (let f = 0; f < 6; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  const out = [];
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.RECT && c.data[o + F.OP] !== OP.GRADIENT_RECT) continue;
    out.push({ r: c.data[o + F.R], g: c.data[o + F.G], b: c.data[o + F.B],
      r2: c.data[o + F.R2], g2: c.data[o + F.G2], b2: c.data[o + F.B2] });
  }
  return out;
};
{
  // random: bars differ across the strip
  const prims = barPrimaries({ colorMode: 1 });
  const distinct = new Set(prims.map((p) =>
    [p.r, p.g, p.b].map((v) => v.toFixed(1)).join(',')));
  assert.ok(prims.length >= 6 && distinct.size >= 3,
    'random colors vary, got ' + distinct.size + ' distinct of ' + prims.length);
  log('    random: ' + distinct.size + ' distinct bar colors');
}
{
  // complementary: every bar is red+cyan in some order
  const bars = barPrimaries({ color: '#ff0000', color2: '#0000ff', colorMode: 3, gradient: true });
  const isRed = (r, g, b) => r > 0.9 && g < 0.1 && b < 0.1;
  const isCyan = (r, g, b) => r < 0.1 && g > 0.9 && b > 0.9;
  assert.ok(bars.length >= 6, 'complementary bars emit, got ' + bars.length);
  assert.ok(bars.every((p) =>
    (isRed(p.r, p.g, p.b) && isCyan(p.r2, p.g2, p.b2)) ||
    (isCyan(p.r, p.g, p.b) && isRed(p.r2, p.g2, p.b2))), 'every bar pairs red with cyan');
  log('    complementary: ' + bars.length + ' red/cyan bars');
}
{
  // palette + cover: every bar color comes from the published roles
  const roles = { bg: '#101010', surface: '#202020', primary: '#ff0000',
    secondary: '#00ff00', accent: '#0000ff', text: '#ffffff' };
  Object.entries(roles).forEach(([k, v]) => engine.setVar(k, v));
  const hexes = new Set(Object.values(roles));
  const close = (v, target) => Math.abs(v - target) < 0.02;
  const isRole = (p) => [...hexes].some((hx) => {
    const n = parseInt(hx.slice(1), 16);
    return close(p.r, ((n >> 16) & 255) / 255) && close(p.g, ((n >> 8) & 255) / 255) && close(p.b, (n & 255) / 255);
  });
  const pal = barPrimaries({ colorMode: 2 });
  assert.ok(pal.length >= 6 && pal.every(isRole), 'palette bars use role colors');
  const cov = barPrimaries({ colorMode: 4 });
  const vivid = new Set(['#ff0000', '#00ff00', '#0000ff']);
  assert.ok(cov.length >= 6 && cov.every((p) =>
    [...vivid].some((hx) => {
      const n = parseInt(hx.slice(1), 16);
      return close(p.r, ((n >> 16) & 255) / 255) && close(p.g, ((n >> 8) & 255) / 255) && close(p.b, (n & 255) / 255);
    })), 'cover bars use vivid roles');
  log('    palette/cover: all bars from role colors');
}

// ---------------------------------------------------------------------------
log('\n[3j] line glow passes + Catmull-Rom smoothing');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset({
  version: 1,
  name: 'line probe',
  components: [
    { type: 'line', props: { lineMode: 1, linePoints: 128, glow: 8, x: 0.05, y: 0.3, w: 0.9, h: 0.3 } },
    { type: 'line', props: { lineMode: 0, linePoints: 64, x: 0.05, y: 0.65, w: 0.9, h: 0.2 } },
  ],
}));
for (let f = 0; f < 4; f++) { engine.pushAudio(window_); engine.frame(16.7); }
const jl = engine.commands();
let glowStrokes = 0, plainStrokes = 0, smoothN = 0;
for (let i = 0; i < jl.count; i++) {
  const o = i * jl.stride;
  const op = jl.data[o + F.OP];
  if (op === OP.POLYGON && jl.data[o + F.P2] > 0) {
    const n = jl.data[o + F.P0] | 0;
    if (n === ((128 - 1) * 4 + 1)) { glowStrokes++; smoothN = n; }   // upsampled single line
    else if (n === (64 - 1) * 4 + 1) plainStrokes++;                     // crisp line
  }
}
assert.strictEqual(glowStrokes, 3, 'glow line emits 3 bloom passes, got ' + glowStrokes);
assert.strictEqual(plainStrokes, 1, 'glow=0 keeps a single stroke, got ' + plainStrokes);
assert.strictEqual(smoothN, ((128 - 1) * 4 + 1), 'line upsampled 4x, single stroke, got ' + smoothN);
log('    glow strokes: ' + glowStrokes + ', crisp: ' + plainStrokes + ', points: ' + smoothN);

// ---------------------------------------------------------------------------
log('\n[3n] gradient lines draw curves; spectrum line sits above centre + gates silence');
// ---------------------------------------------------------------------------
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'curve probe',
  components: [
    { type: 'line', props: { lineMode: 1, linePoints: 64, gradient: true, x: 0.05, y: 0.3, w: 0.9, h: 0.3 } },
  ],
}));
for (let f = 0; f < 6; f++) { engine.pushAudio(window_); engine.frame(16.7); }
{
  // engine emits a point list…
  let grad = 0, nPts = 0;
  const c = engine.commands();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] === OP.GRADIENT_LINE && c.data[o + F.P2] > 0) { grad++; nPts = c.data[o + F.P0]; }
  }
  assert.strictEqual(grad, 1, 'one gradient stroke, got ' + grad);
  assert.strictEqual(nPts, ((64 - 1) * 4 + 1), 'upsampled single line, got ' + nPts);

  // …and the backend strokes every vertex as a polyline, not a straight shot
  const ctxG = stubContext();
  const backG = new CanvasBackend({ width: 1280, height: 720, getContext: () => ctxG }, engine);
  backG.render();
  const moves = ctxG.calls.filter((k) => k === 'lineTo').length;
  assert.ok(moves > 200, 'polyline stroked through the points, got ' + moves + ' lineTo calls');

  // spectrum line lives in the upper half (cy = 0.45 * 720 = 324): silence
  // parks it on the centre, signal pushes it up, never below.
  let minY = Infinity, maxY = -Infinity;
  const pts = engine.points();
  for (let i = 0; i < c.count; i++) {
    const o = i * c.stride;
    if (c.data[o + F.OP] !== OP.GRADIENT_LINE) continue;
    const n = c.data[o + F.P0] | 0, off = (c.data[o + F.P1] | 0) * 2;
    for (let k = 0; k < n; k++) {
      const py = pts[off + k * 2 + 1];
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  assert.ok(maxY <= 324 + 6, 'line never drops below centre, got ' + minY.toFixed(0) + '..' + maxY.toFixed(0));
  assert.ok(324 - minY > 10, 'line has real extent above centre, peak at ' + minY.toFixed(0));
  log('    gradient polyline: ' + moves + ' lineTo, line ' + minY.toFixed(0) + '..' + maxY.toFixed(0));

  // silence fades the line out entirely (no phantom straight line)
  for (let f = 0; f < 40; f++) engine.frame(16.7);
  let strokes = 0;
  const cs = engine.commands();
  for (let i = 0; i < cs.count; i++) {
    const o = i * cs.stride;
    if ((cs.data[o + F.OP] === OP.POLYGON || cs.data[o + F.OP] === OP.GRADIENT_LINE) && cs.data[o + F.P2] > 0) strokes++;
  }
  assert.strictEqual(strokes, 0, 'silent line emits no strokes, got ' + strokes);
  log('    silence gate: 0 strokes after 40 quiet frames');
}

// ---------------------------------------------------------------------------
log('\n[3l] ctrl+click multi-select moves as a group');
// ---------------------------------------------------------------------------
{
  const listeners3 = new Map();
  const overlay3 = {
    getContext: () => stubContext(),
    addEventListener: (type, fn) => { listeners3.set(type, fn); },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SURFACE.w, height: SURFACE.h }),
  };
  const multiPreset = P.normalizePreset(NEON);
  engine.loadPreset(multiPreset);
  const ed3 = new Editor({
    overlay: overlay3,
    engine,
    getPreset: () => multiPreset,
    getPalette: () => ({}),
    onStructure: () => {},
    onSelect: () => {},
  });
  // ctrl+click spectrum (1) then line (2): both selected, spectrum primary
  const sPt = { x: SURFACE.w * 0.5, y: SURFACE.h * 0.65 };
  const lPt = { x: SURFACE.w * 0.5, y: SURFACE.h * 0.38 };
  assert.strictEqual(ed3.hitBody(sPt), 1, 'spectrum hit');
  assert.strictEqual(ed3.hitBody(lPt), 2, 'line hit');
  listeners3.get('pointerdown')({ pointerId: 1, clientX: sPt.x, clientY: sPt.y, ctrlKey: true });
  assert.deepStrictEqual(ed3.selectionList(), [1], 'first ctrl+click selects');
  listeners3.get('pointerdown')({ pointerId: 1, clientX: lPt.x, clientY: lPt.y, ctrlKey: true });
  assert.deepStrictEqual(ed3.selectionList(), [1, 2], 'second ctrl+click adds');
  assert.ok(ed3.drag == null, 'ctrl+click never starts a drag');

  // plain drag on a member moves the whole group by the same delta
  const bx1 = multiPreset.components[1].props.x;
  const bx2 = multiPreset.components[2].props.x;
  listeners3.get('pointerdown')({ pointerId: 2, clientX: sPt.x, clientY: sPt.y });
  assert.ok(ed3.drag && ed3.drag.indices.length === 2, 'group drag starts');
  listeners3.get('pointermove')({ pointerId: 2, clientX: sPt.x + 128, clientY: sPt.y + 72 });
  listeners3.get('pointerup')({ pointerId: 2 });
  const dx1 = multiPreset.components[1].props.x - bx1;
  const dx2 = multiPreset.components[2].props.x - bx2;
  assert.ok(Math.abs(dx1 - 128 / SURFACE.w) < 0.004, 'primary moved by drag, got ' + dx1.toFixed(4));
  assert.ok(Math.abs(dx2 - dx1) < 0.004, 'extra moved rigidly, got ' + dx2.toFixed(4));

  // ctrl+click primary promotes an extra; plain click collapses
  listeners3.get('pointerdown')({ pointerId: 3, clientX: sPt.x, clientY: sPt.y + 72, ctrlKey: true });
  assert.ok(ed3.selectionList().length === 1 && ed3.selected !== 1, 'primary toggled off, extra promoted');
  const nBefore = ed3.components.length;
  ed3.removeSelected();
  assert.strictEqual(ed3.components.length, nBefore - 1, 'group delete removes the selection');
  assert.ok(!ed3.components.some((c) => c.type === 'line'), 'the promoted line was deleted');
  log('    multi [1,2] dragged rigidly; toggle/delete paths ok');
}

// ---------------------------------------------------------------------------
log('\n[3k] particles emit per mode; hidden skips render; layers move()');
// ---------------------------------------------------------------------------
function countOp(cmds, op) {
  let n = 0;
  for (let i = 0; i < cmds.count; i++) if (cmds.data[i * cmds.stride + F.OP] === op) n++;
  return n;
}
for (const [label, mode] of [['embers', 0], ['snow', 1], ['dust', 2], ['stars', 3], ['sparks', 4]]) {
  engine.loadPreset(P.normalizePreset({
    version: 1, name: 'particles probe',
    components: [{ type: 'particles', props: { mode, count: 32, x: 0, y: 0, w: 1, h: 1 } }],
  }));
  for (let f = 0; f < 10; f++) { engine.pushAudio(window_); engine.frame(16.7); }
  const n = countOp(engine.commands(), OP.CIRCLE);
  assert.ok(n >= 28 && n <= 32, label + ' emits ~32 circles, got ' + n);
  log('    ' + (label + '           ').slice(0, 12) + ': ' + n + ' circles');
}

// hidden eye toggle: nothing emitted, indices stable
engine.loadPreset(P.normalizePreset({
  version: 1, name: 'hidden probe',
  components: [
    { type: 'particles', props: { mode: 1, count: 32 } },
    { type: 'spectrum', props: { bars: 8, x: 0.05, y: 0.5, w: 0.9, h: 0.2 } },
  ],
}));
for (let f = 0; f < 6; f++) { engine.pushAudio(window_); engine.frame(16.7); }
assert.strictEqual(engine.sceneCount(), 2, 'hidden preset keeps both components');
assert.ok(engine.setProp(0, 'hidden', 1), 'setProp hidden');
for (let f = 0; f < 3; f++) { engine.pushAudio(window_); engine.frame(16.7); }
assert.strictEqual(countOp(engine.commands(), OP.CIRCLE), 0, 'hidden particles emit nothing');
assert.ok(engine.setProp(0, 'hidden', 0), 'setProp visible');
for (let f = 0; f < 3; f++) { engine.pushAudio(window_); engine.frame(16.7); }
assert.ok(countOp(engine.commands(), OP.CIRCLE) > 0, 'unhidden particles emit again');
log('    hidden toggle          : 32 -> 0 -> 32 circles, scene intact');

// layers drag & drop moves preset + engine together
{
  const types = ed.components.map((c) => c.type);
  const first = types[0];
  ed.move(0, 2);
  assert.strictEqual(ed.components[2].type, first, 'move() reorders the preset');
  assert.strictEqual(engine.sceneCount(), ed.components.length, 'engine scene follows the move');
  assert.strictEqual(ed.selected, 2, 'selection follows the moved row');
  log('    layers move(0,2)        : "' + first + '" -> index 2, engine in sync');
}

log('\nALL SPA TESTS PASSED');
