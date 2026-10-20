// SPA wiring: engine <-> canvas <-> editor <-> UI.
import { VizEngine } from './engine.js';
import { CanvasBackend } from './renderer.js';
import { AudioInput } from './audio.js';
import { Editor, SURFACE, renderInspector } from './editor.js';
import * as P from './presets.js';
import * as PAL from './palettes.js';

const $ = (id) => document.getElementById(id);

const state = {
  preset: null,
  presets: [],
  images: new Map(),        // id -> {name, bitmap}
  nextImageId: 2,           // id 1 is reserved for the track cover
  paletteRoles: null,       // active role -> hex map
  coverPalette: null,       // roles derived from the current cover art
  fps: 0,
};

let engine = null;
let backend = null;
let audio = null;
let editor = null;
let lastT = 0;
let fpsAcc = 0;
let fpsFrames = 0;
let overlayDirty = true;
let seeking = false;

function setStatus(text) {
  const el = $('status');
  if (el) el.textContent = text;
}

async function boot() {
  setStatus('loading WebAssembly engine…');
  try {
    engine = await VizEngine.load();
  } catch (err) {
    setStatus('engine failed to load: ' + err.message + ' — run ./engine/build.sh');
    throw err;
  }
  engine.setSurface(SURFACE.w, SURFACE.h);

  const stage = $('stage');
  stage.width = SURFACE.w;
  stage.height = SURFACE.h;
  const overlay = $('overlay');
  overlay.width = SURFACE.w;
  overlay.height = SURFACE.h;

  backend = new CanvasBackend(stage, engine);
  audio = new AudioInput();
  audio.onState = () => refreshTransport();

  editor = new Editor({
    overlay,
    engine,
    getPreset: () => state.preset,
    imageList: () => Array.from(state.images, ([id, info]) => ({ id, name: info.name })),
    getPalette: () => state.paletteRoles || PAL.fallbackRoles(),
    onStructure: () => { refreshLayers(); overlayDirty = true; },
    onSelect: () => { renderInspector($('inspector'), editor); refreshLayers(); overlayDirty = true; },
  });

  state.presets = await P.loadBundledPresets();
  P.listUserPresets().forEach((p) => state.presets.push(p));
  loadPreset(state.presets[0]);

  wireUi();
  wireImages();
  setStatus('ready · ' + engine.version + ' · ' + engine.bandCount + ' bands');

  // ?mock=1 starts the built-in groove without needing an audio file.
  if (new URLSearchParams(location.search).get('mock') === '1') audio.useMock();

  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
function loadPreset(preset) {
  state.preset = P.normalizePreset(preset);
  applyPalette();
  engine.loadPreset(state.preset);
  editor.resync();
  editor.select(-1);
  refreshPresetList();
  refreshPaletteSelect();
  refreshLayers();
  renderInspector($('inspector'), editor);
  overlayDirty = true;
  setStatus('preset: ' + state.preset.name + ' · ' + state.preset.components.length + ' components');
}

// ---------------------------------------------------------------------------
// Palettes — a preset stores the palette name; the roles become engine
// variables, so a component colour of "{primary}" re-themes instantly.
// ---------------------------------------------------------------------------
function rolesForPreset() {
  const name = state.preset && state.preset.palette;
  if (name === PAL.FROM_COVER) return state.coverPalette || PAL.fallbackRoles();
  return PAL.paletteByName(name).roles;
}

/** Publishes the active palette to the engine and refreshes the swatches. */
function applyPalette() {
  state.paletteRoles = rolesForPreset();
  Object.keys(state.paletteRoles).forEach((role) => engine.setVar(role, state.paletteRoles[role]));
  refreshSwatches();
}

function refreshPaletteSelect() {
  const sel = $('paletteSelect');
  if (!sel) return;
  const names = PAL.paletteNames().concat([PAL.FROM_COVER]);
  sel.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name === PAL.FROM_COVER ? '★ ' + name : name;
    sel.appendChild(opt);
  });
  sel.value = (state.preset && state.preset.palette) || PAL.DEFAULT_PALETTE_NAME;
}

function refreshSwatches() {
  const el = $('paletteSwatches');
  if (!el) return;
  el.innerHTML = '';
  const roles = state.paletteRoles || {};
  Object.keys(roles).forEach((role) => {
    const chip = document.createElement('div');
    chip.className = 'sw';
    chip.style.background = roles[role];
    chip.title = role + ' ' + roles[role];
    const label = document.createElement('span');
    label.textContent = role.slice(0, 4);
    chip.appendChild(label);
    el.appendChild(chip);
  });
}

/** Re-themes live when the palette changes; no preset reload needed. */
function setPalette(name) {
  if (!state.preset) return;
  state.preset.palette = name;
  applyPalette();
  refreshPaletteSelect();
  renderInspector($('inspector'), editor);
  setStatus('palette: ' + name);
}

function refreshPresetList() {
  const sel = $('presetSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const userNames = P.listUserPresets().map((p) => p.name);
  state.presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = (userNames.indexOf(p.name) >= 0 ? '★ ' : '') + p.name;
    sel.appendChild(opt);
  });
  const idx = state.presets.findIndex((p) => p.name === state.preset.name);
  if (idx >= 0) sel.value = String(idx);
}

// ---------------------------------------------------------------------------
// Layer list
// ---------------------------------------------------------------------------
function refreshLayers() {
  const list = $('layers');
  if (!list) return;
  list.innerHTML = '';
  const comps = state.preset.components;
  for (let i = comps.length - 1; i >= 0; i--) {
    const li = document.createElement('li');
    li.className = 'layer' + (i === editor.selected ? ' selected' : '');
    const name = document.createElement('span');
    name.textContent = comps[i].type;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = '#' + i;
    li.appendChild(name);
    li.appendChild(meta);
    li.addEventListener('click', () => {
      editor.select(i);
      renderInspector($('inspector'), editor);
    });
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Engine variables — this is the data presets get to render
// ---------------------------------------------------------------------------
const clockFmt = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat([], { weekday: 'short', day: 'numeric', month: 'short' });

function mmss(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

let appliedRate = 44100;

function updateVars() {
  // The FFT band mapping depends on the real capture rate of the AudioContext.
  if (audio.ctx && audio.sampleRate !== appliedRate) {
    appliedRate = audio.sampleRate;
    engine.setAudioRate(appliedRate);
  }
  const now = new Date();
  const pos = audio.position();
  const dur = audio.duration || 0;
  engine.setVar('clock', clockFmt.format(now));
  engine.setVar('time', clockFmt.format(now));
  engine.setVar('date', dateFmt.format(now));
  engine.setVar('position', mmss(pos));
  engine.setVar('duration', mmss(dur));
  engine.setVar('remaining', dur ? '-' + mmss(Math.max(0, dur - pos)) : '');
  engine.setVar('playing', audio.playing ? '1' : '0');
  engine.setVar('source', audio.mode);
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
function loop(t) {
  requestAnimationFrame(loop);
  if (!engine) return;

  const dt = lastT ? Math.min(100, t - lastT) : 16.7;
  lastT = t;
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 500 || fpsFrames === 1) {   // first frame reports immediately
    state.fps = Math.round(1000 / (fpsAcc / fpsFrames));
    fpsAcc = 0;
    fpsFrames = 0;
    updateHud();
  }

  engine.pushAudio(audio.read());
  updateVars();
  engine.frame(dt);
  backend.render();
  engine.flushMeasures();

  if (editor.enabled || overlayDirty) {
    editor.redraw();
    overlayDirty = false;
  }
  updateTransport();
}

function updateHud() {
  const el = $('hud');
  if (!el) return;
  const lv = engine.levels();
  el.textContent = state.fps + ' fps · ' + backend.lastStats.commands + ' cmds · ' +
    'bass ' + lv.bass.toFixed(2) + ' mid ' + lv.mid.toFixed(2) +
    ' treb ' + lv.treble.toFixed(2) + ' bpm ' + Math.round(engine.getVar('bpm') || 0);

  const ro = $('varReadout');
  if (ro) {
    ro.textContent = ['title', 'artist', 'album', 'station', 'controller']
      .map((k) => '{' + k + '}=' + (engine.getVar(k) || '∅'))
      .join('  ');
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
function updateTransport() {
  const seek = $('seek');
  if (!seek || !audio) return;
  const dur = audio.duration || 0;
  seek.max = dur ? String(dur) : '0';
  if (!seeking) seek.value = String(audio.position());
  $('timeLabel').textContent = mmss(audio.position()) + ' / ' + mmss(dur);
}

function refreshTransport() {
  if (!audio) return;
  const playBtn = $('playBtn');
  if (playBtn) playBtn.textContent = audio.playing ? 'Pause' : 'Play';
  const mode = $('modeLabel');
  if (mode) mode.textContent = audio.mode;
  const mon = $('monitor');
  if (mon) mon.checked = audio.state().monitor;
  updateTransport();
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function wireUi() {
  $('presetSelect').addEventListener('change', (e) => {
    const p = state.presets[parseInt(e.target.value, 10)];
    if (p) loadPreset(p);
  });

  $('presetNew').addEventListener('click', () => {
    const name = window.prompt('New preset name', 'My preset');
    if (!name) return;
    const p = P.emptyPreset(name);
    state.presets.push(p);
    loadPreset(p);
  });

  $('presetSave').addEventListener('click', () => {
    const name = window.prompt('Save preset as', state.preset.name);
    if (!name) return;
    state.preset.name = name;
    P.saveUserPreset(state.preset);
    const at = state.presets.findIndex((p) => p.name === name);
    if (at >= 0) state.presets[at] = P.clone(state.preset);
    else state.presets.push(P.clone(state.preset));
    refreshPresetList();
    setStatus('saved "' + name + '" to this browser');
  });

  $('presetDelete').addEventListener('click', () => {
    const name = state.preset.name;
    P.deleteUserPreset(name);
    state.presets = state.presets.filter((p) => p.name !== name);
    if (!state.presets.length) state.presets = [P.clone(P.BUILTIN_PRESETS[0])];
    loadPreset(state.presets[0]);
  });

  $('presetExport').addEventListener('click', () => {
    const file = state.preset.name.replace(/\s+/g, '-').toLowerCase() + '.json';
    P.downloadJson(file, P.toJson(state.preset));
  });

  // Pushes the preset to the TV app (same origin when the Studio is served
  // from the device at /studio/). On a desktop dev server this fails fast
  // with a status message instead of hanging the UI.
  const sendBtn = $('presetSendTv');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      try {
        const body = new URLSearchParams();
        body.set('action', 'save');
        body.set('json', P.toJson(state.preset));
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch('/api/viz-preset', { method: 'POST', body, signal: ctrl.signal });
        clearTimeout(timer);
        const j = await res.json();
        if (j.ok) setStatus('sent "' + j.name + '" to the TV — pick the Built in visualiser pack to use it');
        else setStatus('TV rejected the preset: ' + (j.error || 'unknown'));
      } catch (err) {
        setStatus('no TV at this origin (serve the Studio from the app to send presets)');
      }
      sendBtn.disabled = false;
    });
  }

  $('presetImportBtn').addEventListener('click', () => $('presetImportFile').click());
  $('presetImportFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const preset = P.fromJson(await file.text());
      state.presets.push(preset);
      loadPreset(preset);
    } catch (err) { setStatus('import failed: ' + err.message); }
    e.target.value = '';
  });

  const addSel = $('addType');
  P.COMPONENT_TYPES.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.type;
    o.textContent = t.label;
    o.title = t.hint;
    addSel.appendChild(o);
  });
  $('addBtn').addEventListener('click', () => editor.addComponent(addSel.value));
  $('dupBtn').addEventListener('click', () => editor.duplicateSelected());
  $('delBtn').addEventListener('click', () => editor.removeSelected());
  $('upBtn').addEventListener('click', () => editor.reorder(1));
  $('downBtn').addEventListener('click', () => editor.reorder(-1));

  const editToggle = $('editToggle');
  editToggle.checked = true;
  editToggle.addEventListener('change', () => { editor.setEnabled(editToggle.checked); overlayDirty = true; });

  $('paletteSelect').addEventListener('change', (e) => setPalette(e.target.value));

  // Seed the variables from the form's initial values so a fresh load already
  // shows something, then keep them in sync while typing.
  const setMeta = (key, value) => {
    const el = $('meta-' + key);
    if (el) el.value = value;
    engine.setVar(key, value);
  };
  ['title', 'artist', 'album', 'station', 'controller'].forEach((key) => {
    const el = $('meta-' + key);
    if (!el) return;
    engine.setVar(key, el.value);
    el.addEventListener('input', () => engine.setVar(key, el.value));
  });
  $('meta-controller').value = 'castbox';
  engine.setVar('controller', 'castbox');

  $('audioFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    await audio.loadFile(file);

    // Prefer real ID3 tags; fall back to the "Artist - Title" file name.
    const tags = await extractId3Tags(file);
    const base = file.name.replace(/\.[^.]+$/, '');
    const bits = base.split(' - ');
    const title = tags.title || (bits.length > 1 ? bits[1] : base);
    const artist = tags.artist || (bits.length > 1 ? bits[0] : '');
    setMeta('title', title);
    setMeta('artist', artist);
    if (tags.album) setMeta('album', tags.album);
    setStatus('playing ' + file.name + (artist ? ' · ' + artist : ''));

    // Fire-and-forget: artwork must never delay or block playback.
    useFileCover(file).then((ok) => {
      if (!ok) setStatus('playing ' + file.name + ' (no embedded cover art)');
    });
    e.target.value = '';
  });

  $('micBtn').addEventListener('click', () => audio.useMic().catch((err) => setStatus('mic: ' + err.message)));
  $('mockBtn').addEventListener('click', () => audio.toggleMock());
  $('playBtn').addEventListener('click', () => audio.playPause());
  $('monitor').addEventListener('change', (e) => audio.setMonitor(e.target.checked));

  const seek = $('seek');
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('pointerup', () => { seeking = false; });
  seek.addEventListener('input', () => audio.seek(parseFloat(seek.value)));

  $('coverUrlBtn').addEventListener('click', async () => {
    const url = $('coverUrl').value.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      setCoverBitmap(bitmap, 'cover');
      setStatus('cover art loaded — {cover} is now available');
    } catch (err) { setStatus('cover art failed: ' + err.message); }
  });

  window.addEventListener('keydown', (e) => {
    const tag = ((e.target && e.target.tagName) || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === ' ') { audio.playPause(); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'e') { editToggle.checked = !editToggle.checked; editor.setEnabled(editToggle.checked); overlayDirty = true; }
  });
}

// Cover art -----------------------------------------------------------------

/**
 * Pulls the first ID3v2 picture frame out of an audio file so "{cover}" shows
 * the real artwork instead of nothing. Returns a Blob, or null when the file
 * has no embedded art (FLAC/OGG/most MP4s, or tags past the header).
 *
 * Deliberately tolerant: any malformed field ends the scan rather than
 * throwing, because artwork is a nice-to-have and must never break playback.
 */
function extractEmbeddedCover(file) {
  return file.slice(0, 4 * 1024 * 1024).arrayBuffer()
    .then((buf) => {
      const d = new DataView(buf);
      const u8 = new Uint8Array(buf);
      if (d.byteLength < 10 || u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return null;
      const major = u8[3];
      // ID3v2 sizes are synchsafe: 7 bits per byte, high bit always clear.
      const tagSize = (u8[6] << 21) | (u8[7] << 14) | (u8[8] << 7) | u8[9];
      let p = 10;
      const end = Math.min(d.byteLength, 10 + tagSize);
      const idLen = major === 2 ? 3 : 4;
      const headLen = major === 2 ? 6 : 10;

      while (p + headLen <= end) {
        const id = String.fromCharCode(...u8.subarray(p, p + idLen));
        if (!/^[A-Z0-9]+$/.test(id)) break;                  // padding or garbage
        // v2.2 frames carry a 3-byte size; v2.3 a 4-byte big-endian one; v2.4
        // a 4-byte synchsafe one.
        const size = major === 2
          ? (u8[p + 3] << 16) | (u8[p + 4] << 8) | u8[p + 5]
          : major === 4
            ? (u8[p + 4] << 21) | (u8[p + 5] << 14) | (u8[p + 6] << 7) | u8[p + 7]
            : ((u8[p + 4] << 24) | (u8[p + 5] << 16) | (u8[p + 6] << 8) | u8[p + 7]) >>> 0;
        const body = p + headLen;
        if (size <= 0 || body + size > d.byteLength) break;

        if (id === 'APIC' || id === 'PIC') {
          let q = body;
          q += 1;                                           // text encoding byte
          let mime = '';
          if (id === 'PIC') {                               // v2.2: fixed 3-char format
            mime = String.fromCharCode(...u8.subarray(q, q + 3)).toLowerCase();
            mime = mime === 'jpg' ? 'image/jpeg' : 'image/' + mime;
            q += 3;
          } else {
            while (q < d.byteLength && u8[q] !== 0) mime += String.fromCharCode(u8[q++]);
            q += 1;                                         // mime terminator
          }
          q += 1;                                           // picture type
          while (q < d.byteLength && u8[q] !== 0) q += 1;   // description terminator
          q += 1;
          const data = buf.slice(q, body + size);
          if (!mime.startsWith('image/')) return null;
          return new Blob([data], { type: mime });
        }
        p = body + size;
      }
      return null;
    })
    .catch(() => null);
}

async function useFileCover(file) {
  const blob = await extractEmbeddedCover(file);
  if (!blob) return false;
  try {
    setCoverBitmap(await createImageBitmap(blob), 'cover (from ' + file.name + ')');
    setStatus('cover art from ' + file.name);
    return true;
  } catch (_) {
    return false;
  }
}

// ID3 text tags --------------------------------------------------------------

/** Decodes one ID3v2 text frame body ([encoding byte][text...]) into a string. */
function decodeId3Text(u8, start, end) {
  if (start >= end) return '';
  const enc = u8[start];
  const isUtf16 = enc === 1 || enc === 2;
  let s = start + 1;
  let e = end;
  if (isUtf16) {
    // stop at the UTF-16 null terminator (two zero bytes on an even boundary)
    let k = s;
    while (k + 1 < end && !(u8[k] === 0 && u8[k + 1] === 0)) k += 2;
    e = k;
  } else {
    let k = s;
    while (k < end && u8[k] !== 0) k++;
    e = k;
  }
  if (e <= s) return '';
  const bytes = u8.subarray(s, e);
  let label = 'latin1';
  if (enc === 3) label = 'utf-8';
  else if (enc === 1) label = (u8[s] === 0xff && u8[s + 1] === 0xfe) ? 'utf-16le' : 'utf-16be';
  else if (enc === 2) label = 'utf-16be';

  let text;
  if (typeof TextDecoder !== 'undefined') {
    try { text = new TextDecoder(label).decode(bytes); }
    catch (_) { text = ''; if (label !== 'latin1') text = new TextDecoder('latin1').decode(bytes); }
  } else {
    text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  }
  // v2.4 allows several null-separated values in one frame (e.g. TPE1).
  return text.replace(/\u0000/g, '\u0001').split('\u0001')
    .map((v) => v.trim()).filter(Boolean).join(', ');
}

/**
 * Reads the ID3v2 text frames a player cares about (title / artist / album /
 * track / genre / year) plus the ID3v1 trailer as a fallback. Text frames live
 * at the very start of the file, so a bounded head read is enough for v2 and a
 * 128-byte tail read covers v1.
 */
async function extractId3Tags(file) {
  const out = { title: '', artist: '', album: '', track: '', genre: '', year: '' };
  if (!file || !file.size) return out;

  const v2map = {
    TIT2: 'title', TPE1: 'artist', TALB: 'album', TRCK: 'track', TCON: 'genre', TDRC: 'year', TYER: 'year',
    TT2: 'title', TP1: 'artist', TAL: 'album', TRK: 'track', TCO: 'genre', TYE: 'year',
  };

  try {
    const buf = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length >= 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
      const major = u8[3];
      const tagSize = (u8[6] << 21) | (u8[7] << 14) | (u8[8] << 7) | u8[9];
      const end = Math.min(u8.length, 10 + tagSize);
      let p = 10;
      const idLen = major === 2 ? 3 : 4;
      const headLen = major === 2 ? 6 : 10;
      while (p + headLen <= end) {
        const id = String.fromCharCode(...u8.subarray(p, p + idLen));
        if (!/^[A-Z0-9]+$/.test(id)) break;                 // padding or garbage
        const size = major === 2
          ? (u8[p + 3] << 16) | (u8[p + 4] << 8) | u8[p + 5]
          : major === 4
            ? (u8[p + 4] << 21) | (u8[p + 5] << 14) | (u8[p + 6] << 7) | u8[p + 7]
            : ((u8[p + 4] << 24) | (u8[p + 5] << 16) | (u8[p + 6] << 8) | u8[p + 7]) >>> 0;
        const body = p + headLen;
        if (size <= 0 || body + size > u8.length) break;
        const field = v2map[id];
        if (field && !out[field]) {
          const value = decodeId3Text(u8, body, body + size);
          if (value) out[field] = value;
        }
        p = body + size;
      }
    }
  } catch (_) { /* malformed header: fall through to ID3v1 */ }

  try {
    if (file.size > 128) {
      const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      if (tail.length >= 128 && tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) {
        const field = (a, b) => {
          let s = '';
          for (let i = a; i < b; i++) { if (tail[i] === 0) break; s += String.fromCharCode(tail[i]); }
          return s.trim();
        };
        if (!out.title) out.title = field(3, 33);
        if (!out.artist) out.artist = field(33, 63);
        if (!out.album) out.album = field(63, 93);
        if (!out.year) out.year = field(93, 97);
      }
    }
  } catch (_) { /* no v1 tag */ }

  return out;
}

// ---------------------------------------------------------------------------
// Images (cover art, background photos)
// ---------------------------------------------------------------------------

/**
 * Image id 1 is reserved for the current track's artwork, so "{cover}" always
 * resolves to something the host controls. Uploaded images start at id 2 to
 * avoid colliding with it.
 */
const COVER_ID = 1;

function setCoverBitmap(bitmap, name) {
  backend.registerImage(COVER_ID, bitmap);
  state.images.set(COVER_ID, { name: name || 'cover', width: bitmap.width, height: bitmap.height });
  engine.setCover(COVER_ID);
  state.nextImageId = Math.max(state.nextImageId, COVER_ID + 1);
  refreshImageList();

  // Derive a palette from the artwork; the "From cover" palette below follows
  // whatever track is playing, so re-theme as soon as new art arrives.
  const roles = PAL.extractRolesFromBitmap(bitmap);
  if (roles) {
    state.coverPalette = roles;
    if (state.preset && state.preset.palette === PAL.FROM_COVER) applyPalette();
  }
}

async function addImage(file) {
  const bitmap = await createImageBitmap(file);
  const id = state.nextImageId++;
  backend.registerImage(id, bitmap);
  state.images.set(id, { name: file.name, width: bitmap.width, height: bitmap.height });
  refreshImageList();
  setStatus('image #' + id + ' registered (' + bitmap.width + 'x' + bitmap.height + ')');
  return id;
}

function refreshImageList() {
  const el = $('imageList');
  if (!el) return;
  el.innerHTML = '';
  if (!state.images.size) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'no images yet';
    el.appendChild(li);
    return;
  }
  state.images.forEach((info, id) => {
    const li = document.createElement('li');
    li.textContent = '#' + id + '  ' + info.name;
    li.title = 'click to copy the id';
    li.addEventListener('click', () => {
      if (navigator.clipboard) navigator.clipboard.writeText(String(id));
      setStatus('copied image id ' + id);
    });
    el.appendChild(li);
  });
}

function wireImages() {
  $('imageFile').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) await addImage(file);
    e.target.value = '';
  });

  const wrap = $('stageWrap');
  ['dragover', 'dragenter'].forEach((ev) => wrap.addEventListener(ev, (e) => {
    e.preventDefault();
    wrap.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => wrap.addEventListener(ev, (e) => {
    e.preventDefault();
    wrap.classList.remove('drag');
  }));
  wrap.addEventListener('drop', async (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    try {
      if (file.type.startsWith('image/')) await addImage(file);
      else if (file.type.startsWith('audio/')) await audio.loadFile(file);
      else if (file.name.endsWith('.json')) {
        const preset = P.fromJson(await file.text());
        state.presets.push(preset);
        loadPreset(preset);
      }
    } catch (err) { setStatus('drop failed: ' + err.message); }
  });

  refreshImageList();
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((err) => {
    console.error(err);
    setStatus('boot failed: ' + err.message);
  });
});
