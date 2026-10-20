// Visual editor: click to select, drag to move, handles to resize, plus the
// generated property inspector. Everything it does ends up as a change to the
// preset's component props, which are pushed straight into the WASM engine.
import { schemaFor, createComponent, clone } from './presets.js';
import { PALETTE_ROLES } from './palettes.js';

/** Logical render surface. The engine is told this size; CSS scales it. */
export const SURFACE = { w: 1280, h: 720 };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_PX = 11;
const SNAP = 0.004;

export class Editor {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.overlay
   * @param {WasmEngine} opts.engine
   * @param {() => object} opts.getPreset   live preset (mutated in place)
   * @param {(index:number, prop:string, value:any) => void} opts.onPropChange
   * @param {(reason:string) => void} opts.onStructure
   */
  constructor(opts) {
    this.overlay = opts.overlay;
    this.ctx = opts.overlay.getContext('2d');
    this.engine = opts.engine;
    this.getPreset = opts.getPreset;
    this.onPropChange = opts.onPropChange || (() => {});
    this.onStructure = opts.onStructure || (() => {});
    this.onSelect = opts.onSelect || (() => {});
    this.imageList = opts.imageList || (() => []);
    // Maps the stored preset to what the engine understands (embedded
    // data-URL images -> reserved ids). Identity by default; the Studio
    // injects its decoder-backed binder so EVERY scene rebuild — including
    // add/remove/duplicate/reorder — resolves embedded art. Without this,
    // any structural edit pushed raw data URLs at the engine (which
    // atoi()s them to 0) and every embedded image vanished.
    this.forEngine = opts.forEngine || ((p) => p);
    this.getPalette = opts.getPalette || (() => ({}));
    this.enabled = true;
    this.selected = -1;
    this.multi = new Set();   // extra selected indices (ctrl+click); primary stays in `selected`
    this.hover = -1;
    this.drag = null;
    this.guides = [];

    this._bind();
  }

  // --- helpers -------------------------------------------------------------
  get components() { return this.getPreset().components; }

  component(i) { return this.components[i]; }

  prop(i, key, def) {
    const c = this.component(i);
    if (!c) return def;
    const v = c.props[key];
    return v === undefined ? def : v;
  }

  num(i, key, def) {
    const v = this.prop(i, key, def);
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : def;
  }

  /** Normalized box -> logical pixels. */
  boxOf(i) {
    return {
      x: this.num(i, 'x', 0) * SURFACE.w,
      y: this.num(i, 'y', 0) * SURFACE.h,
      w: this.num(i, 'w', 1) * SURFACE.w,
      h: this.num(i, 'h', 1) * SURFACE.h,
    };
  }

  /** Pointer event -> logical surface coordinates. */
  toSurface(ev) {
    const r = this.overlay.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * SURFACE.w,
      y: ((ev.clientY - r.top) / r.height) * SURFACE.h,
    };
  }

  // --- selection -----------------------------------------------------------
  // Plain clicks always collapse to a single selection; ctrl+click toggles
  // membership via toggleSelect() without touching the primary.
  select(index) {
    if (this.selected === index && this.multi.size === 0) return;
    this.selected = index;
    this.multi.clear();
    this.onSelect(index);
    this.redraw();
  }

  /** Primary + valid extras, primary first. */
  selectionList() {
    const n = this.components.length;
    const out = this.selected >= 0 && this.selected < n ? [this.selected] : [];
    [...this.multi].sort((a, b) => a - b).forEach((i) => {
      if (i !== this.selected && i >= 0 && i < n) out.push(i);
    });
    return out;
  }

  isSelected(i) { return i === this.selected || this.multi.has(i); }

  touchSelection() {
    this.onSelect(this.selected);
    this.redraw();
  }

  /** Ctrl+click: toggle membership, promoting an extra when primary leaves. */
  toggleSelect(index) {
    if (index < 0 || index >= this.components.length) return;
    if (index === this.selected) {
      if (this.multi.size === 0) { this.select(-1); return; }
      const next = [...this.multi].sort((a, b) => a - b)
        .find((i) => i >= 0 && i < this.components.length);
      this.multi.delete(index);
      if (next === undefined) { this.select(-1); return; }
      this.multi.delete(next);
      this.selected = next;
      this.touchSelection();
      return;
    }
    if (this.multi.has(index)) {
      this.multi.delete(index);
      this.touchSelection();
      return;
    }
    if (this.selected < 0) { this.select(index); return; }
    this.multi.add(index);
    this.touchSelection();
  }

  /** Drops extras pointing past the end (after structural edits). */
  pruneMulti() {
    const n = this.components.length;
    [...this.multi].forEach((i) => { if (i < 0 || i >= n) this.multi.delete(i); });
    if (this.selected >= n) this.select(-1);
  }

  // --- overlay drawing -----------------------------------------------------
  redraw() {
    const ctx = this.ctx;
    const { w, h } = SURFACE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.enabled) return;

    const comps = this.components;
    ctx.lineWidth = 1.5;
    ctx.font = '600 15px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'bottom';

    for (let i = 0; i < comps.length; i++) {
      const b = this.boxOf(i);
      const isSel = i === this.selected;
      const isHover = i === this.hover;
      const isHidden = !!((this.component(i) || {}).props || {}).hidden;
      if (isHidden && !isSel) continue;   // hidden layers leave no box on stage
      const isExtra = !isSel && this.multi.has(i);
      if (!isSel && !isHover && !isExtra) {
        ctx.setLineDash([5, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        continue;
      }
      if (isExtra) {
        // extra multi-selection: accent outline, no badge or handles
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = 'rgba(77,157,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        ctx.setLineDash([]);
        continue;
      }
      if (!isSel) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(140,190,255,0.45)';
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        continue;
      }

      // selected: solid accent + badge + handles
      ctx.setLineDash([]);
      ctx.strokeStyle = '#4d9dff';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);

      const label = this.component(i).type + '  #' + i;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#4d9dff';
      ctx.fillRect(b.x - 1, b.y - 22, tw + 14, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, b.x + 6, b.y - 5);

      for (const hd of HANDLES) {
        const p = handlePos(b, hd);
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(p.x - HANDLE_PX / 2, p.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
        ctx.strokeStyle = '#4d9dff';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - HANDLE_PX / 2, p.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
      }
    }

    // alignment guides shown while dragging
    if (this.guides.length) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#ff2d95';
      ctx.lineWidth = 1.5;
      for (const g of this.guides) {
        ctx.beginPath();
        if (g.vertical) { ctx.moveTo(g.at + 0.5, 0); ctx.lineTo(g.at + 0.5, h); }
        else { ctx.moveTo(0, g.at + 0.5); ctx.lineTo(w, g.at + 0.5); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  // --- hit testing ---------------------------------------------------------
  hitHandle(pt) {
    if (this.selected < 0) return null;
    const b = this.boxOf(this.selected);
    for (const hd of HANDLES) {
      const p = handlePos(b, hd);
      if (Math.abs(pt.x - p.x) <= HANDLE_PX && Math.abs(pt.y - p.y) <= HANDLE_PX) return hd;
    }
    return null;
  }

  hitBody(pt) {
    for (let i = this.components.length - 1; i >= 0; i--) {
      if (this.num(i, 'opacity', 1) <= 0.001) continue;
      const props = (this.component(i) || {}).props || {};
      if (props.hidden) continue;   // hidden layers are not clickable on stage
      const b = this.boxOf(i);
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return i;
    }
    return -1;
  }
}

function handlePos(b, hd) {
  const x = hd.includes('w') ? b.x : (hd.includes('e') ? b.x + b.w : b.x + b.w / 2);
  const y = hd.includes('n') ? b.y : (hd.includes('s') ? b.y + b.h : b.y + b.h / 2);
  return { x, y };
}

function snap(v) { return Math.round(v * 500) / 500; }

function nearest(value, targets, tol) {
  let best = null;
  let bestD = tol;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

Object.assign(Editor.prototype, {
  // --- interaction ---------------------------------------------------------
  _bind() {
    const el = this.overlay;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = -1; this.redraw(); } });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e));
  },

  setEnabled(on) {
    this.enabled = !!on;
    this.drag = null;
    this.redraw();
  },

  _down(e) {
    if (!this.enabled) return;
    try { this.overlay.setPointerCapture(e.pointerId); } catch (_) {}
    const pt = this.toSurface(e);
    const hd = this.hitHandle(pt);
    if (hd) {
      this.drag = { mode: 'resize', handle: hd, index: this.selected, start: this.snapshot(this.selected), from: pt };
      return;
    }
    const i = this.hitBody(pt);
    if (e.ctrlKey || e.metaKey) {
      // ctrl+click toggles multi membership and never starts a drag
      if (i >= 0) this.toggleSelect(i);
      else { this.multi.clear(); this.select(-1); }
      return;
    }
    if (i >= 0 && !this.isSelected(i)) this.select(i);
    else if (i < 0) this.select(-1);
    if (i >= 0) {
      const indices = this.selectionList();
      const starts = new Map(indices.map((k) => [k, this.snapshot(k)]));
      this.drag = { mode: 'move', index: this.selected, indices, starts, start: starts.get(this.selected), from: pt };
    }
  },

  _move(e) {
    if (!this.enabled) return;
    const pt = this.toSurface(e);
    if (!this.drag) {
      const h = this.hitBody(pt);
      if (h !== this.hover) { this.hover = h; this.redraw(); }
      return;
    }
    const d = this.drag;
    const dx = (pt.x - d.from.x) / SURFACE.w;
    const dy = (pt.y - d.from.y) / SURFACE.h;
    const s = d.start;

    if (d.mode === 'move') {
      let nx = snap(s.x + dx);
      let ny = snap(s.y + dy);
      this.guides = [];
      const t = this._targets(d.index);
      const hx = this._snapAxis(nx, s.w, t.xs, (at) => this.guides.push({ vertical: true, at: at * SURFACE.w }));
      if (hx !== null) nx = hx;
      const hy = this._snapAxis(ny, s.h, t.ys, (at) => this.guides.push({ vertical: false, at: at * SURFACE.h }));
      if (hy !== null) ny = hy;
      this.apply(d.index, 'x', nx);
      this.apply(d.index, 'y', ny);
      // the rest of a multi-selection rides along by the same raw delta
      for (const k of d.indices || []) {
        if (k === d.index) continue;
        const os = (d.starts && d.starts.get(k)) || this.snapshot(k);
        this.apply(k, 'x', snap(os.x + dx));
        this.apply(k, 'y', snap(os.y + dy));
      }
    } else {
      const h = d.handle;
      let x = s.x, y = s.y, w = s.w, hh = s.h;
      if (h.includes('e')) w = Math.max(0.01, s.w + dx);
      if (h.includes('s')) hh = Math.max(0.01, s.h + dy);
      if (h.includes('w')) { w = Math.max(0.01, s.w - dx); x = s.x + (s.w - w); }
      if (h.includes('n')) { hh = Math.max(0.01, s.h - dy); y = s.y + (s.h - hh); }
      if (e.shiftKey && h.length === 2 && s.w > 0 && s.h > 0) {
        hh = w / (s.w / s.h);
        if (h.includes('n')) y = s.y + (s.h - hh);
      }
      this.apply(d.index, 'x', snap(x));
      this.apply(d.index, 'y', snap(y));
      this.apply(d.index, 'w', snap(w));
      this.apply(d.index, 'h', snap(hh));
    }
    this.redraw();
  },

  _up(e) {
    if (!this.drag) return;
    try { this.overlay.releasePointerCapture(e.pointerId); } catch (_) {}
    this.drag = null;
    this.guides = [];
    this.redraw();
    this.onStructure('geometry');
  },

  _snapAxis(start, size, targets, onGuide) {
    const cands = [
      { v: start, off: 0 },
      { v: start + size / 2, off: size / 2 },
      { v: start + size, off: size },
    ];
    for (const c of cands) {
      const t = nearest(c.v, targets, SNAP * 1.5);
      if (t !== null) { onGuide(t); return snap(t - c.off); }
    }
    return null;
  },

  _targets(selfIndex) {
    const xs = [0, 0.5, 1];
    const ys = [0, 0.5, 1];
    for (let i = 0; i < this.components.length; i++) {
      if (i === selfIndex) continue;
      const b = this.boxOf(i);
      xs.push(b.x / SURFACE.w, (b.x + b.w / 2) / SURFACE.w, (b.x + b.w) / SURFACE.w);
      ys.push(b.y / SURFACE.h, (b.y + b.h / 2) / SURFACE.h, (b.y + b.h) / SURFACE.h);
    }
    return { xs, ys };
  },
});

Object.assign(Editor.prototype, {
  _key(e) {
    if (!this.enabled) return;
    const tag = ((e.target && e.target.tagName) || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const sel = this.selectionList();
    if (!sel.length) return;
    const step = e.shiftKey ? 0.02 : 0.002;
    const meta = e.metaKey || e.ctrlKey;
    const i = this.selected;
    if (e.key === 'Delete' || e.key === 'Backspace') this.removeSelected();
    else if (e.key === 'ArrowLeft') sel.forEach((k) => this.apply(k, 'x', snap(this.num(k, 'x', 0) - step)));
    else if (e.key === 'ArrowRight') sel.forEach((k) => this.apply(k, 'x', snap(this.num(k, 'x', 0) + step)));
    else if (e.key === 'ArrowUp') sel.forEach((k) => this.apply(k, 'y', snap(this.num(k, 'y', 0) - step)));
    else if (e.key === 'ArrowDown') sel.forEach((k) => this.apply(k, 'y', snap(this.num(k, 'y', 0) + step)));
    else if (meta && e.key.toLowerCase() === 'd') this.duplicateSelected();
    else if (meta && e.key === ']') this.reorder(1);
    else if (meta && e.key === '[') this.reorder(-1);
    else if (e.key === 'Escape') {
      if (this.multi.size) { this.multi.clear(); this.touchSelection(); }
      else this.select(-1);
      return;
    }
    else return;
    e.preventDefault();
    this.redraw();
  },

  // --- structure -----------------------------------------------------------
  snapshot(i) {
    return {
      x: this.num(i, 'x', 0), y: this.num(i, 'y', 0),
      w: this.num(i, 'w', 1), h: this.num(i, 'h', 1),
    };
  },

  /** Writes a prop into the preset and pushes it straight into the engine. */
  apply(index, key, value) {
    const c = this.component(index);
    if (!c) return;
    c.props[key] = value;
    this.engine.setProp(index, key, value);
    // Canvas drags/resizes call this directly, bypassing the inspector — push
    // the live value back into the slider + numeric input when visible.
    if (index === this.selected && this.inspectorControls) {
      const ctl = this.inspectorControls.get(key);
      if (ctl) {
        try { ctl.set(value); } catch (_) {}
      }
    }
  },

  addComponent(type) {
    const at = this.selected >= 0 ? this.selected + 1 : this.components.length;
    this.components.splice(at, 0, createComponent(type));
    this.resync();
    this.select(at);
    this.onStructure('add');
  },

  removeSelected() {
    const sel = this.selectionList().sort((a, b) => b - a);
    if (!sel.length) return;
    for (const f of sel) this.components.splice(f, 1);
    this.resync();
    this.select(Math.min(sel[sel.length - 1], this.components.length - 1));
    this.onStructure('remove');
  },

  duplicateSelected() {
    const sel = this.selectionList().sort((a, b) => b - a);
    if (!sel.length) return;
    let primaryCopy = null;
    for (const f of sel) {
      const copy = clone(this.component(f));
      copy.props.x = snap((copy.props.x || 0) + 0.03);
      copy.props.y = snap((copy.props.y || 0) + 0.03);
      this.components.splice(f + 1, 0, copy);
      if (f === this.selected) primaryCopy = copy;
    }
    this.resync();
    this.select(primaryCopy ? this.components.indexOf(primaryCopy) : -1);
    this.onStructure('duplicate');
  },

  reorder(delta) {
    if (this.selected < 0) return;
    const from = this.selected;
    const to = Math.max(0, Math.min(this.components.length - 1, from + delta));
    this.move(from, to);
  },

  /** Moves a component to an absolute position (layers drag & drop). */
  move(from, to) {
    const n = this.components.length;
    if (from < 0 || to < 0 || from >= n || to >= n || from === to) return;
    const moved = this.components.splice(from, 1)[0];
    this.components.splice(to, 0, moved);
    this.resync();
    this.select(to);
    this.onStructure('reorder');
  },

  /** Structure changed: rebuild the engine scene from the preset. */
  resync() {
    this.pruneMulti();
    this.engine.loadPreset(this.forEngine(this.getPreset()));
  },
});

// ---------------------------------------------------------------------------
// Property inspector — generated from the component schema, so a new prop in
// presets.js shows up here automatically.
// ---------------------------------------------------------------------------
function normalizeHex(v, def) {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v;
  return def && /^#[0-9a-f]{6}$/i.test(def) ? def : '#ffffff';
}

function fmtNum(n, pct) {
  if (!Number.isFinite(n)) return '-';
  if (pct) return (n * 100).toFixed(0) + '%';
  return Math.abs(n) < 1 ? n.toFixed(3) : n.toFixed(1);
}

// Inspector number inputs show display units (percent props as 0..100, like
// the old readout label did); these convert to/from the stored raw value.
function dispVal(v, p) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return p.pct ? parseFloat((n * 100).toFixed(1)) : parseFloat(n.toFixed(3));
}

function storeVal(d, p) {
  return p.pct ? d / 100 : d;
}

function makeControl(editor, index, p) {
  const raw = editor.component(index).props[p.key];
  const v = raw === undefined ? p.default : raw;
  const row = document.createElement('label');
  row.className = 'insp-row';

  const label = document.createElement('span');
  label.className = 'insp-label';
  label.textContent = p.label || p.key;
  if (p.hint) label.title = p.hint;
  row.appendChild(label);

  const commit = (val) => { editor.apply(index, p.key, val); editor.redraw(); };
  let input;

  if (p.kind === 'bool') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!v;
    input.addEventListener('change', () => commit(input.checked));
    row.appendChild(input);
    return row;
  }

  if (p.kind === 'color') {
    // A colour prop can be a literal hex OR a palette-role token (`{primary}`),
    // so a preset re-themes instantly when its palette changes. The little
    // dropdown picks a role; the swatch is the manual override.
    const wrap = document.createElement('span');
    wrap.className = 'insp-color';
    const token = typeof v === 'string' ? /^\{([a-z0-9_]+)\}$/i.exec(v) : null;
    const palette = (editor.getPalette && editor.getPalette()) || {};

    const roleSel = document.createElement('select');
    roleSel.className = 'insp-role';
    const roles = (Object.keys(palette).length ? Object.keys(palette) : PALETTE_ROLES);
    [{ v: '', t: 'Manual' }].concat(roles.map((r) => ({ v: r, t: r }))).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      roleSel.appendChild(opt);
    });
    if (token && roles.indexOf(token[1]) >= 0) {
      roleSel.value = token[1];
    } else if (token) {
      const opt = document.createElement('option');
      opt.value = token[1];
      opt.textContent = token[1];
      roleSel.appendChild(opt);
      roleSel.value = token[1];
    }

    input = document.createElement('input');
    input.type = 'color';
    input.value = normalizeHex(token ? palette[token[1]] : v, p.default);
    input.disabled = !!token;
    input.title = token ? 'Driven by the ' + token[1] + ' palette role' : 'Manual colour';

    roleSel.addEventListener('change', () => {
      if (roleSel.value) {
        input.disabled = true;
        input.title = 'Driven by the ' + roleSel.value + ' palette role';
        input.value = normalizeHex(palette[roleSel.value], input.value);
        commit('{' + roleSel.value + '}');
      } else {
        input.disabled = false;
        input.title = 'Manual colour';
        commit(normalizeHex(input.value, p.default));
      }
    });
    input.addEventListener('input', () => {
      if (!input.disabled) commit(input.value);
    });
    wrap.appendChild(roleSel);
    wrap.appendChild(input);
    row.appendChild(wrap);
    return row;
  }

  if (p.kind === 'select') {
    input = document.createElement('select');
    // Most selects are numeric, but some (font family) carry strings —
    // parseFloat('Inter') is NaN, which would silently drop the value.
    const stringOpts = (p.options || []).some((o) => typeof o.v === 'string');
    (p.options || []).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = String(o.v);
      opt.textContent = o.t;
      input.appendChild(opt);
    });
    input.value = String(v === undefined ? (p.options && p.options[0] ? p.options[0].v : 0) : v);
    input.addEventListener('change', () => commit(stringOpts ? input.value : parseFloat(input.value)));
    row.appendChild(input);
    return row;
  }

  if (p.kind === 'image') {
    // Image picker: the track cover token plus any uploaded image, so presets
    // and hand-written ids both work without hunting through the list.
    input = document.createElement('select');
    const opts = [{ v: '{cover}', t: '★ {cover} (track artwork)' }];
    const imgs = editor.imageList ? editor.imageList() : [];
    imgs.forEach((im) => opts.push({ v: String(im.id), t: '#' + im.id + '  ' + im.name }));
    opts.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      input.appendChild(opt);
    });
    input.value = String(v === undefined || v === '' ? (p.default || '{cover}') : v);
    // A hand-edited id that is not in the list still shows, rather than
    // silently snapping to the first option. Data URLs would blow up the
    // dropdown, so they get a short label with their real size.
    if (input.selectedIndex < 0) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = typeof v === 'string' && v.startsWith('data:image/')
        ? 'embedded image (' + Math.round(v.length / 1024) + ' KB)'
        : String(v) + ' (not loaded)';
      input.appendChild(opt);
      input.value = String(v);
    }
    input.addEventListener('change', () => commit(input.value));
    row.appendChild(input);
    return row;
  }

  if (p.kind === 'text') {
    input = document.createElement('input');
    input.type = 'text';
    input.value = v === undefined ? '' : String(v);
    if (p.hint) input.placeholder = p.hint;
    input.addEventListener('input', () => commit(input.value));
    row.appendChild(input);
    return row;
  }

  // range
  const wrap = document.createElement('span');
  wrap.className = 'insp-range';
  input = document.createElement('input');
  input.type = 'range';
  input.min = String(p.min);
  input.max = String(p.max);
  input.step = String(p.step || 0.01);
  input.value = String(v === undefined ? p.min : v);
  // Editable numeric readout: type an exact value instead of dragging.
  const out = document.createElement('input');
  out.className = 'insp-value';
  out.type = 'number';
  out.min = String(dispVal(p.min, p));
  out.max = String(dispVal(p.max, p));
  out.step = String(p.pct ? 1 : (p.step || 0.01));
  out.value = String(dispVal(parseFloat(input.value), p));
  out.title = 'type an exact value';
  const commitNum = () => {
    // Accept both decimal separators: many locales type "0,38" for 0.38 and
    // parseFloat would silently truncate that to 0.
    let n = parseFloat(String(out.value).replace(',', '.'));
    if (!Number.isFinite(n)) { refreshNum(); return; }
    n = Math.max(dispVal(p.min, p), Math.min(dispVal(p.max, p), n));
    commit(storeVal(n, p));
    refreshNum();
  };
  const refreshNum = () => {
    const cur = editor.component(index).props[p.key];
    out.value = String(dispVal(cur === undefined ? p.default : cur, p));
  };
  input.addEventListener('input', () => {
    const n = parseFloat(input.value);
    out.value = String(dispVal(n, p));
    commit(n);
  });
  out.addEventListener('change', commitNum);
  wrap.appendChild(input);
  wrap.appendChild(out);
  row.appendChild(wrap);
  // Registered so canvas drags/resizes (which bypass the inspector) can push
  // the live x/y/w/h back into the slider + input. See Editor.apply().
  if (editor.inspectorControls) {
    editor.inspectorControls.set(p.key, {
      slider: input,
      num: out,
      set(n) {
        input.value = String(n);
        if (typeof document === 'undefined' || document.activeElement !== out) {
          out.value = String(dispVal(n, p));
        }
      },
    });
  }
  return row;
}

/** Renders the inspector for the editor's current selection. */
export function renderInspector(container, editor) {
  container.innerHTML = '';
  editor.inspectorControls = new Map();
  const i = editor.selected;
  if (i < 0 || !editor.component(i)) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Nothing selected — click a component on the stage or in the layer list.';
    container.appendChild(p);
    return;
  }
  const comp = editor.component(i);
  const head = document.createElement('div');
  head.className = 'insp-head';
  head.innerHTML = '<strong>' + comp.type + '</strong><span class="muted"> #' + i + '</span>';
  if (editor.multi && editor.multi.size > 0) {
    const more = document.createElement('span');
    more.className = 'muted';
    more.textContent = '+' + editor.multi.size + ' more selected (inspector edits the #' + i + ' one)';
    head.appendChild(more);
  }
  container.appendChild(head);

  let lastGroup = null;
  let body = null;
  schemaFor(comp.type).forEach((p) => {
    if (p.group !== lastGroup) {
      lastGroup = p.group;
      const t = document.createElement('div');
      t.className = 'insp-group';
      t.textContent = p.group || 'Options';
      container.appendChild(t);
      body = document.createElement('div');
      body.className = 'insp-body';
      container.appendChild(body);
    }
    body.appendChild(makeControl(editor, i, p));
  });
}
