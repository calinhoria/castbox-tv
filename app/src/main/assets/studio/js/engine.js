// Thin JS binding around the WebAssembly visualiser engine (wasm/vze.js).
//
// The engine owns audio analysis, layout and animation; this file only marshals
// JSON presets in and draw commands out. Nothing here understands what a
// "bar" is — that keeps the Android port trivial (same commands, different
// canvas).

export const OP = {
  CLEAR: 0, RECT: 1, GRADIENT_RECT: 2, LINE: 3, TEXT: 4, IMAGE: 5,
  CLIP_PUSH: 6, CLIP_POP: 7, CIRCLE: 8, GRADIENT_LINE: 9, ARC: 10, POLYGON: 11,
  RADIAL_GLOW: 12,
};

// Field offsets inside one 24-float command record (mirrors vze.h CmdField).
export const F = {
  OP: 0, X: 1, Y: 2, W: 3, H: 4,
  R: 5, G: 6, B: 7, A: 8,
  R2: 9, G2: 10, B2: 11, A2: 12,
  P0: 13, P1: 14, P2: 15, P3: 16,
  STRID: 17, STROFF: 18, STRLEN: 19, IMG: 20,
  P4: 21, P5: 22, ROLE: 23, STRIDE: 24,
};

export const ALIGN = { LEFT: 0, CENTER: 1, RIGHT: 2 };
export const VALIGN = { TOP: 0, MIDDLE: 1, BOTTOM: 2 };
export const FIT = { CONTAIN: 0, COVER: 1, STRETCH: 2 };
export const SOURCE = { RMS: 0, PEAK: 1, BASS: 2, MID: 3, TREBLE: 4, BEAT: 5 };

const encoder = new TextEncoder();
const byteLength = (str) => encoder.encode(str).length;

export class VizEngine {
  constructor(module) {
    this.m = module;
    this.stride = module._vze_cmd_stride();
    this.bandCount = module._vze_band_count();
    this.window = module._vze_audio_window();
    this._pending = [];             // (strId, width) reported after each render
    this._nameCache = new Map();
    this._audioPtr = module._vze_audio_buffer();
  }

  // The specifier is resolved relative to THIS module (js/), hence "../wasm".
  // Cache-busted every boot: the engine gains types/props often, and a stale
  // cached wasm would silently ignore new props or drop new components.
  static async load(url = '../wasm/vze.mjs') {
    const token = Date.now();
    const busted = url + (url.includes('?') ? '&' : '?') + 'v=' + token;
    const factory = (await import(busted)).default;
    const module = await factory({ locateFile: (p, dir) => dir + p + '?v=' + token });
    return new VizEngine(module);
  }

  get version() { return this.m.UTF8ToString(this.m._vze_version()); }

  // --- surface / audio config ---------------------------------------------
  setSurface(w, h) { this.m._vze_set_surface(w | 0, h | 0); }
  setAudioRate(sr) { this.m._vze_set_audio_rate(sr | 0); }

  // --- audio feed ----------------------------------------------------------
  /** Push one analysis window of mono samples (-1..1). */
  pushAudio(samples) {
    const n = Math.min(samples.length, this.window);
    const heap = this.m.HEAPF32;
    const base = this._audioPtr >> 2;
    for (let i = 0; i < n; i++) heap[base + i] = samples[i];
    this.m._vze_audio_commit(n);
  }

  // --- variables the engine hands to presets -------------------------------
  setVar(name, value) {
    if (typeof value === 'number') {
      this._utf8(name, (np, nl) => this.m._vze_var_set_number(np, nl, value));
    } else {
      this._utf8(name, (np, nl) => this._utf8(String(value == null ? '' : value),
        (vp, vl) => this.m._vze_var_set(np, nl, vp, vl)));
    }
  }

  getVar(name) {
    return this._utf8(name, (np, nl) => this.m.UTF8ToString(this.m._vze_var_get(np, nl)));
  }

  // --- scene / preset ------------------------------------------------------
  typeId(name) { return this._cached('t:' + name, () => this._utf8(name, (p, l) => this.m._vze_type_id(p, l))); }
  propId(name) { return this._cached('p:' + name, () => this._utf8(name, (p, l) => this.m._vze_prop_id(p, l))); }

  /** Loads a JSON preset ({ components: [{ type, props }] }). */
  loadPreset(preset) {
    this.m._vze_scene_clear();
    const comps = (preset && preset.components) || [];
    comps.forEach((c) => this.addComponent(c.type, c.props || {}));
    return comps.length;
  }

  addComponent(typeName, props = {}) {
    const typeId = this.typeId(typeName);
    if (typeId < 0) throw new Error('unknown component type: ' + typeName);
    const idx = this.m._vze_scene_add(typeId);
    for (const [k, v] of Object.entries(props)) this.setProp(idx, k, v);
    return idx;
  }

  removeComponent(index) { this.m._vze_scene_remove(index | 0); }

  /**
   * Full engine reset: drops the scene, published variables, band history and
   * the spectrum history ring (terrain). A preset change does NOT reset the
   * history — it is the "now playing" timeline and must survive re-theming.
   */
  reset() { this.m._vze_reset(); }
  moveComponent(index, to) { this.m._vze_scene_move(index | 0, to | 0); }
  sceneCount() { return this.m._vze_scene_count(); }

  setProp(index, propName, value) {
    const pid = this.propId(propName);
    if (pid < 0) return false;
    if (typeof value === 'boolean') {
      this.m._vze_scene_set_num(index | 0, pid, value ? 1 : 0);
    } else if (typeof value === 'number') {
      this.m._vze_scene_set_num(index | 0, pid, value);
    } else {
      this._utf8(String(value == null ? '' : value), (p, l) =>
        this.m._vze_scene_set_str(index | 0, pid, p, l));
    }
    return true;
  }
  getProp(index, propName) { return this.m._vze_scene_get_num(index | 0, this.propId(propName)); }

  // --- images --------------------------------------------------------------
  /** Registers an image with the engine (pixels stay in JS/Canvas). */
  setImage(id, naturalW, naturalH) { this.m._vze_image_set(id | 0, naturalW, naturalH); }
  clearImages() { this.m._vze_image_clear(); }

  /**
   * Points the engine at the current track's artwork. Any component whose
   * `image` prop is the token "{cover}" draws this, so presets can use the
   * song cover without knowing an image id.
   */
  setCover(imgId) { this.m._vze_cover_set(imgId | 0); }
  cover() { return this.m._vze_cover_get(); }

  // --- frame ---------------------------------------------------------------
  frame(dtMs) { this.m._vze_frame(dtMs); }

  /** Draw commands for the frame just computed. Valid until the next call. */
  commands() {
    const count = this.m._vze_cmd_count();
    const ptr = this.m._vze_cmd_data() >> 2;
    const heap = this.m.HEAPF32;
    return { count, stride: this.stride, data: heap.subarray(ptr, ptr + count * this.stride) };
  }

  points() {
    const count = this.m._vze_point_count();
    if (!count) return new Float32Array(0);
    const ptr = this.m._vze_point_data() >> 2;
    return this.m.HEAPF32.subarray(ptr, ptr + count * 2);
  }

  /** Reads a per-frame string from the engine's string pool. */
  string(offset, len) {
    if (len <= 0) return '';
    return this.m.UTF8ToString(this.m._vze_pool_data() + offset, len);
  }

  /** Backend reports measured pixel widths so marquee/auto-fit converge. */
  reportMeasure(strId, width) { this._pending.push([strId, width]); }
  flushMeasures() {
    for (let i = 0; i < this._pending.length; i++) {
      const p = this._pending[i];
      this.m._vze_measure_put(p[0], p[1]);
    }
    this._pending.length = 0;
  }

  levels() {
    return {
      rms: this.m._vze_level(SOURCE.RMS),
      peak: this.m._vze_level(SOURCE.PEAK),
      bass: this.m._vze_level(SOURCE.BASS),
      mid: this.m._vze_level(SOURCE.MID),
      treble: this.m._vze_level(SOURCE.TREBLE),
      beat: this.m._vze_level(SOURCE.BEAT),
      beatPhase: this.m._vze_beat_phase(),
    };
  }
  band(i) { return this.m._vze_band(i | 0); }

  // --- internals -----------------------------------------------------------
  _cached(key, fn) {
    if (!this._nameCache.has(key)) this._nameCache.set(key, fn());
    return this._nameCache.get(key);
  }

  /** Allocates a temporary UTF-8 string in wasm memory for the duration of fn. */
  _utf8(str, fn) {
    const ptr = this.m.stringToNewUTF8(str);
    try {
      return fn(ptr, byteLength(str));
    } finally {
      this.m._free(ptr);
    }
  }
}
