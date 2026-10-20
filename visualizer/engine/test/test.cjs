'use strict';
// Headless validation of the WASM engine: FFT band mapping, level detection,
// command emission and {variable} binding. Run with engine/test/run.sh.
const assert = require('assert');
const factory = require(process.env.VZE_NODE_MODULE);

const SR = 44100;
const BAND_COUNT = 64;
const fit = console.log;

const propCache = new Map();
function pid(M, name) {
  if (!propCache.has(name)) {
    const p = M.stringToNewUTF8(name);
    propCache.set(name, M._vze_prop_id(p, Buffer.byteLength(name)));
    M._free(p);
  }
  return propCache.get(name);
}
function tid(M, name) {
  const p = M.stringToNewUTF8(name);
  const id = M._vze_type_id(p, Buffer.byteLength(name));
  M._free(p);
  return id;
}
function setNum(M, i, name, v) { M._vze_scene_set_num(i, pid(M, name), v); }
function setStr(M, i, name, v) {
  const p = M.stringToNewUTF8(v);
  M._vze_scene_set_str(i, pid(M, name), p, Buffer.byteLength(v));
  M._free(p);
}
function varSet(M, name, v) {
  const np = M.stringToNewUTF8(name);
  const vp = M.stringToNewUTF8(String(v));
  M._vze_var_set(np, Buffer.byteLength(name), vp, Buffer.byteLength(String(v)));
  M._free(np); M._free(vp);
}

const BAND_COUNT_HZ = (() => {
  const fLo = 32, fHi = Math.min(16000, SR * 0.45);
  const out = [];
  for (let i = 0; i < BAND_COUNT; i++) out.push(Math.sqrt(fLo * Math.pow(fHi / fLo, i / BAND_COUNT)
    * fLo * Math.pow(fHi / fLo, (i + 1) / BAND_COUNT)));
  return out;
})();

function feedTone(M, freq, frames = 6) {
  const base = M._vze_audio_buffer() >> 2;
  for (let f = 0; f < frames; f++) {
    const heap = M.HEAPF32;
    for (let i = 0; i < 2048; i++) {
      const t = (f * 2048 + i) / SR;
      heap[base + i] = 0.8 * Math.sin(2 * Math.PI * freq * t);
    }
    M._vze_audio_commit(2048);
    M._vze_frame(16.7);
  }
}

function loudestBand(M) {
  let best = 0, band = -1;
  for (let i = 0; i < BAND_COUNT; i++) {
    const v = M._vze_band(i);
    if (v > best) { best = v; band = i; }
  }
  return { band, value: best };
}

function nearestBand(freq) {
  let bi = 0, bd = Infinity;
  BAND_COUNT_HZ.forEach((f, i) => { const d = Math.abs(f - freq); if (d < bd) { bd = d; bi = i; } });
  return bi;
}

function decode(M) {
  const stride = M._vze_cmd_stride();
  const count = M._vze_cmd_count();
  const base = M._vze_cmd_data() >> 2;
  const heap = M.HEAPF32;
  const pool = M._vze_pool_data();
  const out = [];
  for (let c = 0; c < count; c++) {
    const o = base + c * stride;
    const cmd = {
      op: heap[o], x: heap[o + 1], y: heap[o + 2], w: heap[o + 3], h: heap[o + 4],
      a: heap[o + 8], p0: heap[o + 13], p1: heap[o + 14],
      strId: heap[o + 17], strLen: heap[o + 19],
    };
    if (cmd.strLen > 0) cmd.text = M.UTF8ToString(pool + heap[o + 18], cmd.strLen);
    out.push(cmd);
  }
  return out;
}

(async () => {
  const M = await factory();

  // ---- ABI surface -------------------------------------------------------
  assert.strictEqual(M._vze_cmd_stride(), 24, 'cmd stride');
  assert.strictEqual(M._vze_band_count(), BAND_COUNT, 'band count');
  assert.strictEqual(M._vze_audio_window(), 2048, 'audio window');
  fit('abi            : ' + M.UTF8ToString(M._vze_version()) +
      ' stride=' + M._vze_cmd_stride() + ' bands=' + M._vze_band_count());

  M._vze_set_surface(1280, 720);
  M._vze_set_audio_rate(SR);

  // ---- FFT band mapping ---------------------------------------------------
  feedTone(M, 1000);
  let loud = loudestBand(M);
  fit('fft 1kHz       : band=' + loud.band + ' (expect ~' + nearestBand(1000) + ') level=' + loud.value.toFixed(3));
  assert.ok(Math.abs(loud.band - nearestBand(1000)) <= 3, '1kHz should land near its band, got ' + loud.band);
  assert.ok(loud.value > 0.5, 'tone should be loud, got ' + loud.value);

  feedTone(M, 100);
  loud = loudestBand(M);
  fit('fft 100Hz      : band=' + loud.band + ' (expect ~' + nearestBand(100) + ') level=' + loud.value.toFixed(3));
  assert.ok(Math.abs(loud.band - nearestBand(100)) <= 3, '100Hz should land near its band, got ' + loud.band);

  // bass level reacts to the low tone
  const bass = M._vze_level(2);
  fit('bass level     : ' + bass.toFixed(3));
  assert.ok(bass > 0.2, 'bass level should react to 100Hz, got ' + bass);

  // ---- scene, bindings and command emission ------------------------------
  M._vze_scene_clear();
  const bg = M._vze_scene_add(tid(M, 'background'));
  setStr(M, bg, 'color', '#101020');

  const spec = M._vze_scene_add(tid(M, 'spectrum'));
  setNum(M, spec, 'bars', 16);
  setNum(M, spec, 'peaks', 1);
  setNum(M, spec, 'x', 0.05);
  setNum(M, spec, 'y', 0.55);
  setNum(M, spec, 'w', 0.9);
  setNum(M, spec, 'h', 0.35);
  setNum(M, spec, 'roundness', 0.6);

  const ln = M._vze_scene_add(tid(M, 'line'));
  setNum(M, ln, 'linePoints', 64);
  setNum(M, ln, 'fill', 1);

  const txt = M._vze_scene_add(tid(M, 'text'));
  setStr(M, txt, 'pattern', '{title} — {artist}');
  setNum(M, txt, 'size', 0.08);
  setNum(M, txt, 'align', 1);

  assert.strictEqual(M._vze_scene_count(), 4, 'scene count');
  varSet(M, 'title', 'Blue Monday');
  varSet(M, 'artist', 'New Order');

  feedTone(M, 220, 8);
  const cmds = decode(M);
  const ops = {};
  cmds.forEach((c) => { ops[c.op] = (ops[c.op] || 0) + 1; });
  fit('commands       : ' + cmds.length + ' -> ' + JSON.stringify(ops));

  assert.ok(ops[0] >= 1, 'background clear emitted');
  assert.ok(ops[1] >= 16, '16 bar rects, got ' + (ops[1] || 0));
  assert.ok(ops[1] >= 32, 'bars + falling peak caps, got ' + (ops[1] || 0));
  assert.ok(ops[11] >= 2, 'line polygon (fill + stroke), got ' + (ops[11] || 0));

  const texts = cmds.filter((c) => c.op === 4 && c.strLen > 0);
  assert.ok(texts.length >= 1, 'text command emitted');
  fit('bound text     : "' + texts[0].text + '"');
  assert.strictEqual(texts[0].text, 'Blue Monday — New Order', 'pattern binding');
  assert.ok(texts[0].strId >= 0, 'stable strId present for the measure cache');

  // ---- variables are live: changing one changes the emitted text ----------
  varSet(M, 'artist', '');
  M._vze_frame(16.7);
  const t2 = decode(M).filter((c) => c.op === 4 && c.strLen > 0)[0];
  fit('live variable  : "' + t2.text + '"');
  assert.strictEqual(t2.text, 'Blue Monday — ', 'variable update reflected next frame');

  // ---- measurement feedback round-trip -----------------------------------
  M._vze_measure_put(t2.strId, 5000);
  assert.strictEqual(M._vze_measure_get(t2.strId), 5000, 'measure cache round-trip');

  // ---- silence decays the bars toward the floor --------------------------
  const before = loudestBand(M).value;
  for (let i = 0; i < 30; i++) M._vze_frame(16.7);
  const after = loudestBand(M).value;
  fit('silence decay  : ' + before.toFixed(3) + ' -> ' + after.toFixed(3));
  assert.ok(after < 0.05, 'bands should decay to silence, got ' + after);

  // ---- kick transients fire the beat detector (spectral flux onset) --------
  // 200 BPM-ish kick pattern: short 55Hz bursts separated by silence. A pure
  // bass-level threshold misses these on flat masters; flux must not.
  let maxBeat = 0;
  for (let k = 0; k < 3; k++) {
    feedTone(M, 55, 4);
    maxBeat = Math.max(maxBeat, M._vze_level(5));
    for (let f = 0; f < 14; f++) M._vze_frame(16.7);
  }
  fit('kick response  : peak beat level ' + maxBeat.toFixed(3));
  assert.ok(maxBeat > 0.5, 'kick bursts should slam the beat detector, got ' + maxBeat);

  // ---- highs respond: a broadband chord must light the top bands ----------
  {
    const base = M._vze_audio_buffer() >> 2;
    for (let f = 0; f < 8; f++) {
      const heap = M.HEAPF32;
      for (let i = 0; i < 2048; i++) {
        const t = (f * 2048 + i) / SR;
        heap[base + i] = 0.3 * Math.sin(2 * Math.PI * 200 * t) +
          0.3 * Math.sin(2 * Math.PI * 1200 * t) +
          0.3 * Math.sin(2 * Math.PI * 5000 * t);
      }
      M._vze_audio_commit(2048);
      M._vze_frame(16.7);
    }
    let top = 0;
    for (let i = 48; i < BAND_COUNT; i++) top = Math.max(top, M._vze_band(i));
    fit('top bands      : max ' + top.toFixed(3));
    assert.ok(top > 0.3, 'highs should be alive on broadband signal, got ' + top);
  }

  fit('ALL ENGINE TESTS PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
