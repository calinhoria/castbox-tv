// SPA wiring: engine <-> canvas <-> editor <-> UI.
import { VizEngine } from './engine.js';
import { CanvasBackend } from './renderer.js';
import { AudioInput } from './audio.js';
import { Editor, SURFACE, renderInspector } from './editor.js';
import * as P from './presets.js';
import * as PAL from './palettes.js';

const $ = (id) => document.getElementById(id);

// Sentinel for the palette dropdown: "this preset carries its own roles".
const CUSTOM_PALETTE = 'custom';

const state = {
  preset: null,
  presets: [],
  seedNames: new Set(),    // default presets (presets/default/)
  userNames: new Set(),    // device user files (new or seed-shadowing) -> My presets
  deviceOnline: false,
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
let lastRenderError = '';

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
  // Started here but awaited before the first preset is drawn, so a component
  // referencing a bundled id never paints as an empty box on a cold load.
  const bundledImagesReady = loadBundledImages();

  editor = new Editor({
    overlay,
    engine,
    getPreset: () => state.preset,
    forEngine: bindPresetForEngine,
    imageList: () => Array.from(state.images, ([id, info]) => ({ id, name: info.name })),
    getPalette: () => state.paletteRoles || PAL.fallbackRoles(),
    onStructure: () => { state.presetSeq = (state.presetSeq || 0) + 1; refreshLayers(); overlayDirty = true; },
    onSelect: () => { renderInspector($('inspector'), editor); refreshLayers(); overlayDirty = true; },
  });

  state.presets = await P.loadBundledPresets();
  state.seedNames = new Set(state.presets.map((p) => p.name));
  state.userNames = new Set();
  // The TV app is the only store: its dump merges seeds with device saves
  // (and honors deletions). There is no browser fallback — a failed fetch
  // leaves the bundled seeds on screen and every mutation refuses loudly.
  try {
    state.presets = await devicePresetsFull();
    markDevice(true);
  } catch (_) {
    markDevice(false);
    // No device user list: anything not a seed counts as mine.
    state.userNames = new Set(state.presets.map((p) => p.name).filter((n) => !state.seedNames.has(n)));
  }
  if (!state.presets.length) {
    const fresh = P.emptyPreset('Untitled');
    state.presets = [fresh];
  }
  // Every retry already settled by now; the wait costs nothing on a warm load.
  await bundledImagesReady;
  loadPreset(state.presets[0]);

  wireUi();
  wireImages();
  setStatus('ready · ' + engine.version + ' · ' + engine.bandCount + ' bands');

  const pill = $('enginePill');
  if (pill) {
    // A stale cached wasm drops new component types: make it visible instead
    // of a mystery. engine.js already cache-busts, this catches old tabs.
    const fresh = engine.typeId('radial_line') >= 0 && engine.typeId('progress') >= 0;
    pill.textContent = engine.version + (fresh ? '' : ' · STALE ENGINE — hard-refresh');
    if (!fresh) pill.style.borderColor = 'var(--danger)';
  }

  // Offline is the condition that let browser copies shadow shipped presets,
  // so say so loudly rather than letting the Studio quietly serve stale data.
  refreshSourceBadge();

  // ?mock=1 starts the built-in groove without needing an audio file.
  if (new URLSearchParams(location.search).get('mock') === '1') audio.useMock();

  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Preset store: the TV app is the only store. Seeds come from
// presets/default/ for the first paint; everything else is the device dump.
// Save overwrites the current preset in place; Save As always asks
// for a name first. Nothing is ever written to browser storage.
// ---------------------------------------------------------------------------
async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 5000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Full preset dump from the TV app (seeds + device saves, deletions honored). */
async function devicePresetsFull() {
  const j = await fetchJson('/api/viz-presets?full=1', 15000);
  if (!j || !Array.isArray(j.full)) throw new Error('bad device response');
  // `user` lists the device user files, so seeds and user saves group
  // correctly (the dump itself merges both). Older builds omit it: fall
  // back to treating non-seed names as mine.
  state.userNames = new Set(Array.isArray(j.user) && j.user.length
    ? j.user
    : j.full.map((p) => p && p.name).filter((n) => n && !state.seedNames.has(n)));
  return j.full.map((p) => P.normalizePreset(p));
}

async function refreshPresetsFromDevice() {
  state.presets = await devicePresetsFull();
  markDevice(true);
  refreshPresetList();
}

/**
 * Shows whether the TV is reachable. The device is the only store, so an
 * unreachable TV means every mutation below refuses instead of pretending.
 */
function refreshSourceBadge() {
  const el = $('sourceBadge');
  if (!el) return;
  if (state.deviceOnline) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.textContent = 'TV unreachable — presets are read-only bundled copies';
  el.style.display = '';
}

/** Presets come from the TV app, so a device blip must update the badge. */
function markDevice(online) {
  if (state.deviceOnline === online) return;
  state.deviceOnline = online;
  refreshSourceBadge();
}

function upsertPreset(norm) {
  const at = state.presets.findIndex((p) => p.name === norm.name);
  if (at >= 0) state.presets[at] = P.clone(norm);
  else state.presets.push(P.clone(norm));
}

/** Saves to the TV app. Fails loudly when unreachable — never locally. */
async function persistPreset(preset, asNew) {
  let name = preset.name;
  if (asNew || !state.presets.some((p) => p.name === name)) {
    const asked = window.prompt('Save preset as', name);
    if (!asked) return false;
    name = asked;
    preset.name = name;
  }
  if (!state.deviceOnline) {
    setStatus('TV unreachable — "' + name + '" was NOT saved');
    return false;
  }
  const norm = P.normalizePreset(preset);
  try {
    const body = new URLSearchParams();
    body.set('action', 'save');
    body.set('json', P.toJson(norm));
    const res = await fetch('/api/viz-preset', { method: 'POST', body });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'rejected');
    await refreshPresetsFromDevice();
    const at = state.presets.findIndex((p) => p.name === name);
    if (at >= 0) loadPreset(state.presets[at]);
    setStatus('saved "' + name + '" on the TV — pick the Built in visualiser pack to use it');
    return true;
  } catch (err) {
    markDevice(false);
    setStatus('save failed (' + (err && err.message ? err.message : err) + ') — nothing was written');
    return false;
  }
}

/** Deletes on the device. Refuses when the TV is unreachable. */
async function removePresets(names) {
  if (!state.deviceOnline) {
    setStatus('TV unreachable — nothing was deleted');
    return false;
  }
  try {
    for (const name of names) {
      const body = new URLSearchParams();
      body.set('action', 'delete');
      body.set('name', name);
      const res = await fetch('/api/viz-preset', { method: 'POST', body });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }
    await refreshPresetsFromDevice();
    return true;
  } catch (err) {
    markDevice(false);
    setStatus('delete failed (' + (err && err.message ? err.message : err) + ') — nothing was deleted');
    return false;
  }
}

// --- manage presets dialog --------------------------------------------------
function renderManageList() {
  const box = $('manageList');
  if (!box) return;
  box.innerHTML = '';
  const groups = [['Default presets', []], ['My presets', []]];
  state.presets.forEach((p) => (isMine(p.name) ? groups[1][1] : groups[0][1]).push(p));
  groups.forEach(([label, items]) => {
    if (!items.length) return;
    const head = document.createElement('h3');
    head.textContent = label + ' (' + items.length + ')';
    box.appendChild(head);
    items.forEach((p) => {
      const row = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = p.name;
      const name = document.createElement('span');
      name.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = p.components.length + ' comp';
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(tag);
      box.appendChild(row);
    });
  });
}

function openManage() {
  renderManageList();
  const back = $('manageBackdrop');
  if (back) back.hidden = false;
}

function closeManage() {
  const back = $('manageBackdrop');
  if (back) back.hidden = true;
}

function loadPreset(preset) {
  state.preset = P.normalizePreset(preset);
  applyPalette();
  // The seq guard drops late-arriving decodes from a previous preset.
  state.presetSeq = (state.presetSeq || 0) + 1;
  engine.loadPreset(bindPresetForEngine(state.preset));
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
  // An embedded `roles` block wins over the named palette; `dynamic` is always
  // artwork-derived either way.
  return PAL.rolesForPreset(state.preset, state.coverPalette);
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
  const embedded = !!(state.preset && state.preset.roles);
  const names = [CUSTOM_PALETTE].concat(PAL.paletteNames(), [PAL.FROM_COVER]);
  sel.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name === CUSTOM_PALETTE ? 'Custom (this preset)'
      : name === PAL.FROM_COVER ? '★ ' + name : name;
    sel.appendChild(opt);
  });
  sel.value = embedded ? CUSTOM_PALETTE : ((state.preset && state.preset.palette) || PAL.DEFAULT_PALETTE_NAME);
}

function refreshSwatches() {
  const el = $('paletteSwatches');
  if (!el) return;
  el.innerHTML = '';
  const roles = state.paletteRoles || {};
  const embedded = !!(state.preset && state.preset.roles);
  PAL.PALETTE_ROLES.forEach((role) => {
    const hex = roles[role] || '#000000';
    const chip = document.createElement('div');
    chip.className = 'sw';
    if (embedded) {
      // Live editing: the picker writes straight into the preset's roles.
      chip.classList.add('editable');
      const input = document.createElement('input');
      input.type = 'color';
      input.value = hex;
      input.title = role + ' — click to change (saved in this preset)';
      input.addEventListener('input', () => setEmbeddedRole(role, input.value));
      chip.appendChild(input);
    } else {
      chip.style.background = hex;
      chip.title = role + ' ' + hex + ' (from the palette)';
    }
    const label = document.createElement('span');
    label.textContent = role.slice(0, 4);
    chip.appendChild(label);
    el.appendChild(chip);
  });
  // `dynamic` is read-only: it always follows the artwork.
  const dyn = document.createElement('div');
  dyn.className = 'sw';
  dyn.style.background = roles[PAL.DYNAMIC_ROLE] || PAL.FALLBACK_DYNAMIC;
  dyn.title = 'dynamic — follows the artwork, not stored in the preset';
  const dynLabel = document.createElement('span');
  dynLabel.textContent = 'dyn';
  dyn.appendChild(dynLabel);
  el.appendChild(dyn);
}

/** Writes one role into the preset's embedded palette and re-themes. */
function setEmbeddedRole(role, hex) {
  if (!state.preset) return;
  if (!state.preset.roles) state.preset.roles = {};
  state.preset.roles[role] = hex;
  applyPalette();
  renderInspector($('inspector'), editor);
}

/** Re-themes live when the palette changes; no preset reload needed. */
function setPalette(name) {
  if (!state.preset) return;
  if (name === CUSTOM_PALETTE) {
    // Freeze the palette currently on screen into the preset, then edit it here.
    const roles = {};
    PAL.PALETTE_ROLES.forEach((role) => {
      // Normalise to #rrggbb: rgba() sources (the chip surface, say) would
      // otherwise be stored verbatim and break the schema.
      const hex = (state.paletteRoles && state.paletteRoles[role]) || '#000000';
      const c = PAL.hexToRgb(hex);
      roles[role] = PAL.rgbToHex(c.r, c.g, c.b);
    });
    state.preset.roles = roles;
  } else {
    delete state.preset.roles;   // back to the named palette
    state.preset.palette = name;
  }
  applyPalette();
  refreshPaletteSelect();
  renderInspector($('inspector'), editor);
  setStatus('palette: ' + name);
}

function isMine(name) {
  return state.userNames.has(name);
}

function refreshPresetList() {
  const sel = $('presetSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const groups = [
    ['Default presets', []],
    ['My presets', []],
  ];
  state.presets.forEach((p, i) => (isMine(p.name) ? groups[1][1] : groups[0][1]).push([p, i]));
  groups.forEach(([label, items]) => {
    if (!items.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    items.forEach(([p, i]) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.name;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  });
  const idx = state.presets.findIndex((p) => state.preset && p.name === state.preset.name);
  if (idx >= 0) sel.value = String(idx);
  // Rename needs a user preset to rename: pristine defaults keep the button
  // disabled so it is obvious it does not apply to them (use Save as…).
  const ren = $('presetRename');
  if (ren) ren.disabled = !state.preset || !isMine(state.preset.name);
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
    const hidden = !!comps[i].props.hidden;
    li.className = 'layer' + (editor.isSelected(i) ? ' selected' : '') + (hidden ? ' hidden-layer' : '');
    const name = document.createElement('span');
    name.textContent = comps[i].type;
    const eye = document.createElement('button');
    eye.className = 'eye';
    eye.textContent = hidden ? 'Show' : 'Hide';
    eye.title = hidden ? 'show this component' : 'hide this component (keeps its place)';
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      comps[i].props.hidden = !comps[i].props.hidden;
      engine.setProp(i, 'hidden', comps[i].props.hidden ? 1 : 0);
      refreshLayers();
      overlayDirty = true;
    });
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = '#' + i;
    li.appendChild(name);
    li.appendChild(eye);
    li.appendChild(meta);
    li.addEventListener('click', () => {
      editor.select(i);
      renderInspector($('inspector'), editor);
    });
    // Drag to reorder: the row carries its component index; dropping onto
    // another row moves it there (editor.move keeps engine + preset in sync).
    li.draggable = true;
    li.dataset.index = String(i);
    li.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', String(i));
      ev.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging', 'drop-target'));
    li.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      li.classList.add('drop-target');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', (ev) => {
      ev.preventDefault();
      li.classList.remove('drop-target');
      const from = parseInt(ev.dataTransfer.getData('text/plain'), 10);
      if (Number.isFinite(from) && from !== i) editor.move(from, i);
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
  engine.setVar('positionSec', pos);
  engine.setVar('durationSec', dur);
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
  try {
    backend.render();
  } catch (err) {
    // A backend bug must never kill the frame loop (and its own error
    // surface): report once per unique message and keep the preview alive.
    const msg = String((err && err.message) || err);
    if (msg !== lastRenderError) {
      lastRenderError = msg;
      console.error(err);
      setStatus('render error: ' + msg);
    }
  }
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

  $('presetSave').addEventListener('click', () => persistPreset(state.preset, false));

  $('presetSaveAs').addEventListener('click', () => persistPreset(state.preset, true));

  $('presetRename').addEventListener('click', async () => {
    const oldName = state.preset.name;
    if (!isMine(oldName)) {
      setStatus('defaults cannot be renamed — use Save as… to copy one');
      return;
    }
    const asked = window.prompt('Rename preset', oldName);
    if (!asked) return;
    const newName = asked.trim();
    if (!newName || newName === oldName) return;
    if (state.presets.some((p) => p.name === newName) &&
        !window.confirm('"' + newName + '" already exists — overwrite it?')) return;
    const renamed = P.clone(state.preset);
    renamed.name = newName;
    if (!state.deviceOnline) {
      setStatus('TV unreachable — "' + oldName + '" was NOT renamed');
      return;
    }
    try {
      const body = new URLSearchParams();
      body.set('action', 'save');
      body.set('json', P.toJson(P.normalizePreset(renamed)));
      const res = await fetch('/api/viz-preset', { method: 'POST', body });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'rejected');
      const del = new URLSearchParams();
      del.set('action', 'delete');
      del.set('name', oldName);
      await fetch('/api/viz-preset', { method: 'POST', body: del });
      await refreshPresetsFromDevice();
    } catch (err) {
      markDevice(false);
      setStatus('rename failed (' + (err && err.message ? err.message : err) + ') — nothing was renamed');
      return;
    }
    const at = state.presets.findIndex((p) => p.name === newName);
    loadPreset(state.presets[at >= 0 ? at : 0]);
    setStatus('renamed "' + oldName + '" to "' + newName + '" on the TV');
  });

  $('presetManage').addEventListener('click', openManage);
  $('manageClose').addEventListener('click', closeManage);
  $('manageBackdrop').addEventListener('click', (e) => {
    if (e.target === $('manageBackdrop')) closeManage();
  });
  $('manageAll').addEventListener('click', () => {
    document.querySelectorAll('#manageList input[type=checkbox]').forEach((cb) => { cb.checked = true; });
  });
  $('manageNone').addEventListener('click', () => {
    document.querySelectorAll('#manageList input[type=checkbox]').forEach((cb) => { cb.checked = false; });
  });
  $('manageRemove').addEventListener('click', async () => {
    const picked = Array.from(
      document.querySelectorAll('#manageList input[type=checkbox]:checked')).map((cb) => cb.value);
    if (!picked.length) { setStatus('nothing selected'); return; }
    if (!window.confirm('Remove ' + picked.length + ' preset(s)?\n\n' + picked.join('\n'))) return;
    const onDevice = await removePresets(picked);
    if (!state.presets.length) state.presets = [P.emptyPreset('Untitled')];
    loadPreset(state.presets[0]);
    renderManageList();
    setStatus('removed ' + picked.length + ' preset(s)' + (onDevice ? ' on the TV' : ' in this browser'));
  });
  $('manageRestore').addEventListener('click', async () => {
    if (!state.deviceOnline) { setStatus('TV unreachable — nothing to restore'); return; }
    const body = new URLSearchParams();
    body.set('action', 'restore');
    try {
      const res = await fetch('/api/viz-preset', { method: 'POST', body });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'rejected');
      await refreshPresetsFromDevice();
      renderManageList();
      setStatus('restored ' + j.count + ' deleted default preset(s)');
    } catch (err) {
      setStatus('restore failed: ' + err.message);
    }
  });

  $('presetDelete').addEventListener('click', async () => {
    const name = state.preset.name;
    const onDevice = await removePresets([name]);
    if (!state.presets.length) state.presets = [P.emptyPreset('Untitled')];
    loadPreset(state.presets[0]);
    setStatus('deleted "' + name + '"' + (onDevice ? ' on the TV' : ' in this browser'));
  });

  $('presetExport').addEventListener('click', () => {
    const file = state.preset.name.replace(/\s+/g, '-').toLowerCase() + '.json';
    P.downloadJson(file, P.toJson(state.preset));
  });

  // Pushes the preset to the TV app (same origin when the Studio is served
  // from the device at /studio/). On a desktop dev server this fails fast
  // with a status message instead of hanging the UI.
  const sendBtn = $('presetSendTv');
  if (sendBtn) sendBtn.remove();

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

  // Imports a preset from the clipboard. The async Clipboard API needs a
  // secure context and focus, which the TV browser often lacks, so a prompt
  // is the fallback instead of an error — pasting still works everywhere.
  $('presetPasteBtn').addEventListener('click', async () => {
    let text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch (_) { /* denied or unavailable: fall through to prompt */ }
    if (!text) {
      text = window.prompt('Paste preset JSON');
      if (!text) return;
    }
    try {
      const preset = P.fromJson(text);
      state.presets.push(preset);
      loadPreset(preset);
      setStatus('pasted "' + preset.name + '" (not saved yet — Save writes it to the TV)');
    } catch (err) { setStatus('paste failed: ' + err.message); }
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

/**
 * Bundled artwork with fixed image ids, so built-in presets can reference
 * real images portably ({cover} only covers track art). Loaded
 * fire-and-forget at boot, but with retries: one dropped fetch would
 * otherwise leave presets like "Winamp base" without their skin for the rest
 * of the session. Mirror this table on Android (VizBundledImages).
 */
const BUNDLED_IMAGES = [
  { id: 10, path: 'assets/winamp-base.jpg', name: 'winamp base skin' },
  { id: 11, path: 'assets/winamp-thumb.png', name: 'winamp posbar thumb' },
];

const BUNDLED_IMAGE_ATTEMPTS = 3;
const BUNDLED_IMAGE_RETRY_MS = 800;

/**
 * Resolves a bundled asset against *this module's* URL, not the document's.
 * The Studio is served at both /studio/ and /studio (no trailing slash), and a
 * relative fetch resolves to /assets/... in the latter — a 404 that blanks the
 * skin on a page that otherwise works. The wasm already resolves this way via
 * Emscripten's locateFile; this keeps the two consistent and makes the paths
 * independent of the mount point.
 */
const assetUrl = (path) => new URL('../' + path, import.meta.url).href;

async function loadBundledImage({ id, path, name }, attempt) {
  try {
    const res = await fetch(assetUrl(path));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bitmap = await createImageBitmap(await res.blob());
    backend.registerImage(id, bitmap);
    state.images.set(id, { name: name || path, width: bitmap.width, height: bitmap.height });
    state.nextImageId = Math.max(state.nextImageId, id + 1);
    refreshImageList();
  } catch (err) {
    if (attempt + 1 < BUNDLED_IMAGE_ATTEMPTS) {
      // Offline, a server hiccup, a decode race on slow storage: all worth
      // another try. Delay grows so a cold asset dir gets a few chances.
      await new Promise((r) => setTimeout(r, BUNDLED_IMAGE_RETRY_MS * (attempt + 1)));
      return loadBundledImage({ id, path, name }, attempt + 1);
    }
    console.warn('[viz] bundled image never loaded:', path, err);
    setStatus('could not load ' + (name || path) + ' (' + err.message + ')');
  }
}

/** Resolves once every bundled image has been fetched and registered. */
function loadBundledImages() {
  return Promise.all(BUNDLED_IMAGES.map((entry) => loadBundledImage(entry, 0)));
}

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
    // Republish regardless of palette: the always-on `dynamic` role follows
    // the artwork, so presets that tint their backdrop with it must re-theme
    // on every new cover.
    if (state.preset) applyPalette();
  }
}

/**
 * Decoded embedded images, by data URL. Once decoded, re-binding is
 * synchronous: structural edits (add/remove/reorder) rebuild the scene on
 * every keystroke and must never wait on a decode.
 */
const embeddedBitmaps = new Map();
const embeddedInflight = new Set();

/**
 * Maps the stored preset to what the engine understands: data-URL image
 * props become reserved ids (10000+). Cached bitmaps re-register
 * synchronously; new URLs decode in the background and pop in on the next
 * frame (the renderer looks bitmaps up live per frame, so no scene reload
 * is ever needed). The stored preset is never mutated — it keeps the
 * portable data URLs, which is the whole point of embedding.
 */
function bindPresetForEngine(preset) {
  const seq = state.presetSeq || 0;
  const { preset: bound, images } = P.extractEmbeddedImages(preset);
  for (const { id, url } of images) {
    const hit = embeddedBitmaps.get(url);
    if (hit) {
      backend.registerImage(id, hit.bitmap);
      state.images.set(id, hit.info);
      continue;
    }
    if (embeddedInflight.has(url)) continue;
    embeddedInflight.add(url);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const bitmap = await createImageBitmap(await res.blob());
        const info = {
          name: 'embedded image (' + Math.round(url.length / 1024) + ' KB)',
          width: bitmap.width, height: bitmap.height,
        };
        embeddedBitmaps.set(url, { id, bitmap, info });
        if (seq !== state.presetSeq) return;
        backend.registerImage(id, bitmap);
        state.images.set(id, info);
        refreshImageList();
      } catch (err) {
        console.warn('[viz] embedded image #' + id + ' failed:', err);
      } finally {
        embeddedInflight.delete(url);
      }
    })();
  }
  return bound;
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
