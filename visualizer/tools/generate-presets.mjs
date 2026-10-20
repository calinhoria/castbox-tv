// (Re)generates presets/default/*.json for the GENERATED presets (author:
// "generated"): one per palette x layout, plus Cover radial and Orb.
// Hand-authored files in the same dir are never touched — edit those by
// hand or re-export them from the Studio. Also rewrites index.json, the
// manifest the SPA fetches. Run: node tools/generate-presets.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, FROM_COVER } from '../js/palettes.js';
import { SCHEMA_VERSION, normalizePreset, toJson } from '../js/presets.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'presets', 'default');

const slug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------
// Generated presets — every palette paired with a layout, so the palette
// picker has something to switch between out of the box. Colours are role
// tokens ({primary}, {bg} …) so re-theming is instant.
// ---------------------------------------------------------------------------
const sh = (w) => Math.round((w * 1280 / 720) * 1000) / 1000;   // square box height for a width

const LAYOUTS = [
  {
    suffix: 'bar wall',
    build: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'spectrum', props: {
        x: 0.05, y: 0.42, w: 0.9, h: 0.46, bars: 64, gap: 0.24, barWidth: 0.78, roundness: 0.9,
        baseline: 0, gradient: true, color: '{primary}', color2: '{secondary}', gain: 1.25,
        minHeight: 0.02, peaks: true, peakColor: '{accent}', peakWidth: 4, peakFall: 1.2,
        glow: 9, smoothing: 0.55, decay: 0.85, logScale: true } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.07, w: 0.88, h: 0.1, size: 0.06,
        weight: 700, align: 0, color: '{text}', shadow: true, shadowBlur: 12, shadowOffset: 2 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.18, w: 0.88, h: 0.07, size: 0.03,
        weight: 300, align: 0, color: '{accent}', shadow: false } },
      { type: 'text', props: { pattern: '{clock}', x: 0.9, y: 0.07, w: 0.06, h: 0.06, size: 0.028,
        weight: 400, align: 2, color: '{accent}', shadow: false } },
    ],
  },
  {
    suffix: 'orb',
    build: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'cover', props: {
        x: 0.31, y: 0.14, w: 0.38, h: sh(0.38), image: '{cover}', fit: 1, coverScale: 0.58,
        cornerRadius: 0.16, radialBars: 72, ringRadius: 0.62, radialLength: 0.42, radialGap: 0.34,
        arcStart: 0, arcSpan: 360, radialGain: 1.25, radialSmoothing: 0.5, radialDecay: 0.86,
        color: '{primary}', color2: '{secondary}', glow: 16, haloColor: '{accent}', pulseAmount: 0.16 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.83, w: 0.88, h: 0.08, size: 0.05,
        weight: 700, align: 1, color: '{text}', shadow: true, shadowBlur: 12 } },
      { type: 'text', props: { pattern: '{artist} · {album}', x: 0.06, y: 0.92, w: 0.88, h: 0.05,
        size: 0.026, weight: 300, align: 1, color: '{accent}', shadow: false, marquee: true } },
    ],
  },
  {
    suffix: 'ring',
    build: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 30, dim: 0.68, color: '#000000' } },
      { type: 'cover', props: {
        x: 0.34, y: 0.18, w: 0.32, h: sh(0.32), image: '{cover}', fit: 1, circle: true, coverScale: 0.68,
        radialBars: 96, ringRadius: 0.76, radialLength: 0.24, radialGap: 0.4, arcStart: 0, arcSpan: 360,
        radialGain: 1.2, radialSmoothing: 0.45, radialDecay: 0.88,
        color: '{primary}', color2: '{secondary}', glow: 18, haloColor: '{primary}', pulseAmount: 0.18 } },
      { type: 'text', props: { pattern: '{title}', x: 0.1, y: 0.05, w: 0.8, h: 0.09, size: 0.046,
        weight: 700, align: 1, color: '{text}', shadow: true } },
      { type: 'text', props: { pattern: '{artist}', x: 0.1, y: 0.86, w: 0.8, h: 0.06, size: 0.026,
        weight: 400, align: 1, color: '{accent}', shadow: true, shadowBlur: 8 } },
    ],
  },
  {
    suffix: 'pulse',
    build: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 34, dim: 0.72, color: '#000000' } },
      { type: 'cover', props: {
        x: 0.06, y: 0.24, w: 0.28, h: sh(0.28), image: '{cover}', fit: 1, coverScale: 0.6,
        cornerRadius: 0.18, radialBars: 56, ringRadius: 0.72, radialLength: 0.3, radialGap: 0.3,
        radialGain: 1.2, color: '{primary}', color2: '{secondary}', glow: 14,
        haloColor: '{accent}', pulseAmount: 0.14 } },
      { type: 'spectrum', props: {
        x: 0.4, y: 0.28, w: 0.54, h: 0.3, bars: 40, gap: 0.26, roundness: 0.8, centered: true,
        gradient: true, color: '{primary}', color2: '{secondary}', gain: 1.3, minHeight: 0.03,
        glow: 8, smoothing: 0.5, decay: 0.86 } },
      { type: 'meter', props: { x: 0.4, y: 0.63, w: 0.54, h: 0.014, source: 0, direction: 0,
        color: '{primary}', cornerRadius: 1, trackColor: '{text}', trackOpacity: 0.12 } },
      { type: 'meter', props: { x: 0.4, y: 0.67, w: 0.54, h: 0.014, source: 1, direction: 0,
        color: '{secondary}', cornerRadius: 1, trackColor: '{text}', trackOpacity: 0.12 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.82, w: 0.88, h: 0.08, size: 0.048,
        weight: 700, align: 0, color: '{text}', shadow: true, marquee: true } },
      { type: 'text', props: { pattern: '{artist} — {album}', x: 0.06, y: 0.91, w: 0.88, h: 0.05,
        size: 0.024, weight: 300, align: 0, color: '{accent}', shadow: false, marquee: true } },
    ],
  },
];

// ---------------------------------------------------------------------------
// Spotify TV: a brand spec rather than a genre. Colours are mostly literals
// (the brand greens/greys are fixed); only the top of the backdrop gradient is
// artwork-derived via the always-on {dynamic} role.
// ---------------------------------------------------------------------------
const spotifyTv = {
  version: SCHEMA_VERSION,
  name: 'Spotify TV',
  author: 'generated',
  palette: 'Mono',
  components: [
    // bg-base #121212 with a {dynamic} tint washing down from the top.
    { type: 'background', props: {
      mode: 1, color: '{dynamic}', color2: '#121212', gradientAngle: 90 } },
    // Top bar, 64px: source chip on the left, clock on the right.
    { type: 'shape', props: { shape: 1, filled: true, cornerRadius: 1, x: 0.022, y: 0.028,
      w: 0.31, h: 0.052, color: 'rgba(255,255,255,0.08)' } },
    { type: 'text', props: { pattern: 'Playing from {station}', x: 0.036, y: 0.032, w: 0.28, h: 0.045,
      size: 0.021, weight: 500, align: 0, valign: 1, color: '#B3B3B3', shadow: false } },
    { type: 'text', props: { pattern: '{clock}', x: 0.9, y: 0.032, w: 0.078, h: 0.045,
      size: 0.026, weight: 500, align: 2, valign: 1, color: '#FFFFFF', shadow: false } },
    // Cover art 640x640 -> half-height square on the left.
    { type: 'image', props: { image: '{cover}', fit: 1, cornerRadius: 0.03, blur: 0,
      x: 0.05, y: 0.2, w: 0.5, h: 0.5 } },
    // Title 64px bold + artist 36px to its right.
    { type: 'text', props: { pattern: '{title}', x: 0.585, y: 0.34, w: 0.39, h: 0.115,
      size: 0.062, weight: 700, align: 0, valign: 1, color: '#FFFFFF', shadow: false } },
    { type: 'text', props: { pattern: '{artist}', x: 0.585, y: 0.465, w: 0.39, h: 0.06,
      size: 0.036, weight: 400, align: 0, valign: 1, color: '#B3B3B3', shadow: false } },
    // Progress only, with the elapsed / total timestamps either side.
    { type: 'text', props: { pattern: '{position}', x: 0.05, y: 0.845, w: 0.06, h: 0.05,
      size: 0.022, weight: 400, align: 0, valign: 1, color: '#B3B3B3', shadow: false } },
    { type: 'text', props: { pattern: '{duration}', x: 0.89, y: 0.845, w: 0.06, h: 0.05,
      size: 0.022, weight: 400, align: 2, valign: 1, color: '#B3B3B3', shadow: false } },
    { type: 'progress', props: { x: 0.115, y: 0.858, w: 0.77, h: 0.011,
      color: '#1DB954', trackColor: '#FFFFFF', trackOpacity: 0.28,
      cornerRadius: 1, glow: 0 } },
  ],
};

// Showcases for the dotmatrix / rays components.
const SHOWCASE = [
  {
    name: 'Pixel Bars', palette: 'Neon',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'dotmatrix', props: {
        x: 0.08, y: 0.16, w: 0.84, h: 0.66, cols: 48, rows: 20, cellShape: 0, gap: 0.22,
        color: '{primary}', color2: '{secondary}', dimColor: '{text}', dimOpacity: 0.09,
        glow: 10, gain: 1.3, smoothing: 0.5, decay: 0.85, quantize: true,
        peaks: true, peakWidth: 4, peakFall: 1.2, peakColor: '{accent}' } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.05, w: 0.88, h: 0.09, size: 0.05,
        weight: 700, align: 0, color: '{text}', shadow: true, shadowBlur: 12 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.86, w: 0.88, h: 0.06, size: 0.028,
        weight: 300, align: 0, color: '{accent}', shadow: false, marquee: true } },
    ],
  },
  {
    name: 'Sunburst', palette: 'Sunset',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 40, dim: 0.74, color: '#1a0b12' } },
      { type: 'rays', props: {
        x: 0.16, y: 0.02, w: 0.68, h: 0.72, count: 160, innerRadius: 0.14, length: 0.62,
        strokeWidth: 0.003, taper: 0.85, spin: 0.03, spinBeat: 0.45,
        arcStart: 0, arcSpan: 360, pulseAmount: 0.1,
        color: '{primary}', color2: '{secondary}', gradient: true,
        gain: 1.25, smoothing: 0.42 } },
      { type: 'image', props: { image: '{cover}', fit: 1, circle: true, cornerRadius: 0.5,
        x: 0.4, y: 0.24, w: 0.2, h: 0.2 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.8, w: 0.88, h: 0.08, size: 0.05,
        weight: 700, align: 1, color: '{text}', shadow: true, shadowBlur: 14 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.88, w: 0.88, h: 0.05, size: 0.024,
        weight: 300, align: 1, color: '{accent}', shadow: false, marquee: true } },
    ],
  },
].map((t) => ({
  version: SCHEMA_VERSION,
  name: t.name,
  author: 'generated',
  palette: t.palette,
  components: t.components(),
}));

// Terrain showcases: the same component, three very different readings.
const TERRAIN_THEMES = [
  {
    name: 'Unknown Pleasures', palette: 'Mono',
    components: () => [
      { type: 'background', props: { mode: 0, color: '#000000' } },
      { type: 'terrain', props: {
        terrainRows: 88, terrainBands: 128, rowIntervalMs: 55, flow: 0,
        heightScale: 0.5, gain: 1.5, floorDb: -74, logScale: true, tilt: 3.5,
        smoothing: 0.45, decay: 0.82, rowSmooth: 0.3, widthTaper: 0.4,
        pitch: 28, fov: 52, distance: 2.3, lookY: 0.02,
        rotateMode: 0, yawStart: 0, avoidEdgeOn: true,
        strokeWidth: 0.0012, color: '#ffffff', color2: '#ffffff',
        gradient: false, colorBy: 0, depthFade: 0.55,
        occlude: true, x: 0, y: 0.06, w: 1, h: 0.88 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.015, w: 0.88, h: 0.07, size: 0.032,
        weight: 500, align: 0, color: '{text}', shadow: false, uppercase: true, letterSpacing: 6 } },
    ],
  },
  {
    name: 'Orbit', palette: 'Neon',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'terrain', props: {
        terrainRows: 72, terrainBands: 96, rowIntervalMs: 45, flow: 0,
        heightScale: 0.45, gain: 1.3, floorDb: -70, logScale: true, tilt: 3,
        smoothing: 0.5, decay: 0.8, rowSmooth: 0.25, widthTaper: 0.35,
        pitch: 34, fov: 55, distance: 2.2, lookY: 0.05,
        pitchBass: 5, zoomBeat: 0.07,
        rotateMode: 1, yawSpeed: 8, avoidEdgeOn: true,
        strokeWidth: 0.0015, color: '{text}', color2: '{primary}',
        gradient: true, colorBy: 1, depthFade: 0.45, heightGlow: 12,
        x: 0, y: 0.04, w: 1, h: 0.92 } },
      { type: 'text', props: { pattern: '{title}', x: 0.05, y: 0.945, w: 0.62, h: 0.05, size: 0.03,
        weight: 700, align: 0, valign: 1, color: '{text}', shadow: true, shadowBlur: 10 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.62, y: 0.945, w: 0.33, h: 0.05, size: 0.024,
        weight: 300, align: 2, valign: 1, color: '{accent}', shadow: false, marquee: true } },
    ],
  },
  {
    name: 'Beat Cathedral', palette: 'Deep Space',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 44, dim: 0.8, color: '#02010a' } },
      { type: 'terrain', props: {
        terrainRows: 64, terrainBands: 96, rowIntervalMs: 40, flow: 1,
        heightScale: 0.55, gain: 1.45, floorDb: -68, logScale: true, tilt: 4,
        smoothing: 0.4, decay: 0.78, rowSmooth: 0.2, widthTaper: 0.3,
        pitch: 40, fov: 60, distance: 2.0, lookY: 0.08,
        pitchBass: 6, zoomBeat: 0.12,
        rotateMode: 3, yawBeat: 22, kickDecay: 0.88, avoidEdgeOn: true,
        strokeWidth: 0.0018, color: '{secondary}', color2: '{accent}',
        gradient: true, colorBy: 2, depthFade: 0.4, heightGlow: 16,
        occlude: false, floorGrid: true, floorColor: '{primary}', floorOpacity: 0.14,
        x: 0, y: 0.05, w: 1, h: 0.9 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.02, w: 0.88, h: 0.07, size: 0.038,
        weight: 300, align: 1, color: '{text}', shadow: true, shadowBlur: 14,
        uppercase: true, letterSpacing: 4 } },
    ],
  },
].map((t) => ({
  version: SCHEMA_VERSION,
  name: t.name,
  author: 'generated',
  palette: t.palette,
  components: t.components(),
}));


/** One generated preset per palette, cycling through the four layouts. */
function generatePresets() {
  return PALETTES.map((pal, i) => {
    const layout = LAYOUTS[i % LAYOUTS.length];
    return {
      version: SCHEMA_VERSION,
      name: pal.name + ' ' + layout.suffix,
      author: 'generated',
      palette: pal.name,
      components: layout.build(),
    };
  });
}


// A cover-centric preset whose colours follow the artwork automatically.
const extras = [];
extras.push({
  version: SCHEMA_VERSION,
  name: 'Cover radial',
  author: 'generated',
  palette: FROM_COVER,
  components: [
    { type: 'background', props: { mode: 2, image: '{cover}', blur: 36, dim: 0.7, color: '#000000' } },
    { type: 'cover', props: {
      x: 0.3, y: 0.12, w: 0.4, h: sh(0.4), image: '{cover}', fit: 1, coverScale: 0.56,
      cornerRadius: 0.5, circle: true, radialBars: 84, ringRadius: 0.64, radialLength: 0.36,
      radialGap: 0.32, arcStart: 0, arcSpan: 360, radialGain: 1.25, radialPeaks: true,
      radialSmoothing: 0.45, radialDecay: 0.88, color: '{primary}', color2: '{secondary}',
      glow: 18, haloColor: '{accent}', pulseAmount: 0.18 } },
    { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.85, w: 0.88, h: 0.08, size: 0.05,
      weight: 700, align: 1, color: '{text}', shadow: true, shadowBlur: 12, marquee: true } },
    { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.93, w: 0.88, h: 0.05, size: 0.026,
      weight: 400, align: 1, color: '{accent}', shadow: false, marquee: true } },
  ],
});

// Orb showcase: nothing but glow spectrum lines around the cover — the
// immersive Built-in-visualiser look with no text or meters.
extras.push({
  version: SCHEMA_VERSION,
  name: 'Orb',
  author: 'generated',
  palette: FROM_COVER,
  components: [
    { type: 'background', props: { mode: 2, image: '{cover}', blur: 40, dim: 0.78, color: '#000000' } },
    { type: 'orb', props: {
      x: 0.28, y: 0.08, w: 0.44, h: sh(0.44), image: '{cover}', fit: 1, coverScale: 0.42,
      circle: true, cornerRadius: 0.5, rings: 3, linePoints: 180, ringRadius: 0.52,
      gap: 0.3, radialLength: 0.42, thickness: 0.013, gain: 1.3, smoothing: 0.45,
      decay: 0.87, color: '{primary}', color2: '{secondary}',
      glow: 18, haloColor: '{accent}', pulseAmount: 0.16, coreSize: 0.5 } },
  ],
});

// ---------------------------------------------------------------------------
// Themed presets: each one is a deliberate pick of layout + effects + a palette
// that makes the theme make sense. Colours are role tokens, so any theme can be
// re-themed from the palette picker without touching its structure.
// ---------------------------------------------------------------------------
const THEMES = [
  {
    name: 'Mario Party', palette: 'Candy',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 120 } },
      { type: 'spectrum', props: {
        x: 0.04, y: 0.34, w: 0.92, h: 0.5, bars: 20, gap: 0.34, barWidth: 0.86, roundness: 1,
        gradient: true, color: '{primary}', color2: '{secondary}', glow: 12, reflection: true,
        gain: 1.5, smoothing: 0.4, decay: 0.8, minHeight: 0.06, logScale: false } },
      { type: 'particles', props: {
        mode: 4, count: 90, size: 0.026, speed: 1.4, sway: 0.8, gravity: -0.2, beatBoost: 1.6,
        shape: 2, rotation: 1, sizeVar: 0.5, colorMode: 2, gradient: true } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.06, w: 0.88, h: 0.12, size: 0.072,
        weight: 800, align: 1, color: '{text}', shadow: true, shadowBlur: 10, shadowOffset: 4 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.86, w: 0.88, h: 0.06, size: 0.032,
        weight: 600, align: 1, color: '{accent}', shadow: false } },
    ],
  },
  {
    name: 'Halloween Spook', palette: 'Ember',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 40, dim: 0.86, color: '#000000' } },
      { type: 'cover', props: {
        x: 0.32, y: 0.16, w: 0.36, h: sh(0.36), image: '{cover}', fit: 1, circle: true,
        coverScale: 0.66, radialBars: 72, ringRadius: 0.8, radialLength: 0.2, radialGap: 0.44,
        radialGain: 1.1, radialSmoothing: 0.6, color: '{secondary}', color2: '{accent}',
        glow: 10, haloColor: '{secondary}', pulseAmount: 0.1 } },
      { type: 'particles', props: {
        mode: 0, count: 70, size: 0.014, speed: 0.6, sway: 0.7, gravity: -0.35, twinkle: 0.9,
        beatBoost: 0.6, colorMode: 0, color: '#ff6b35', color2: '#f59e0b', gradient: true } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.84, w: 0.88, h: 0.08, size: 0.05,
        weight: 700, align: 1, color: '{accent}', shadow: true, shadowBlur: 14, shadowOffset: 3 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.92, w: 0.88, h: 0.05, size: 0.024,
        weight: 400, align: 1, color: '{secondary}', shadow: false, uppercase: true, letterSpacing: 3 } },
    ],
  },
  {
    name: 'Paris Vibes', palette: 'Pastel',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 46, dim: 0.62, color: '{bg}' } },
      { type: 'spectrum', props: {
        x: 0.1, y: 0.4, w: 0.8, h: 0.34, bars: 56, gap: 0.3, barWidth: 0.5, roundness: 1,
        centered: true, gradient: true, color: '{primary}', color2: '{accent}', glow: 6,
        gain: 1.1, smoothing: 0.6, decay: 0.9, logScale: true } },
      { type: 'text', props: { pattern: '{title}', x: 0.08, y: 0.08, w: 0.84, h: 0.1, size: 0.042,
        weight: 300, italic: true, align: 1, color: '{text}', shadow: true, shadowBlur: 10, letterSpacing: 2 } },
      { type: 'text', props: { pattern: '{artist}  ·  {album}', x: 0.08, y: 0.84, w: 0.84, h: 0.06,
        size: 0.022, weight: 300, align: 1, color: '{accent}', shadow: false, letterSpacing: 1 } },
      { type: 'progress', props: { x: 0.1, y: 0.78, w: 0.8, h: 0.006, color: '{primary}',
        trackColor: '{text}', trackOpacity: 0.16, cornerRadius: 1 } },
    ],
  },
  {
    name: 'Tokyo Neon', palette: 'Neon',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 42, dim: 0.8, color: '#000000' } },
      { type: 'orb', props: {
        x: 0.28, y: 0.06, w: 0.44, h: sh(0.44), image: '{cover}', fit: 1, coverScale: 0.4,
        circle: true, rings: 4, linePoints: 200, ringRadius: 0.5, gap: 0.24, radialLength: 0.4,
        thickness: 0.009, gain: 1.35, smoothing: 0.4, decay: 0.88, angularSmooth: 0.35,
        paletteRings: true, color: '{primary}', color2: '{secondary}', glow: 22,
        haloColor: '{accent}', pulseAmount: 0.2 } },
      { type: 'text', props: { pattern: '{title}', x: 0.04, y: 0.84, w: 0.92, h: 0.08, size: 0.046,
        weight: 700, align: 0, color: '{text}', shadow: true, shadowBlur: 12, marquee: true } },
      { type: 'text', props: { pattern: '{artist}', x: 0.04, y: 0.92, w: 0.92, h: 0.05, size: 0.024,
        weight: 400, align: 0, color: '{accent}', shadow: false, uppercase: true, letterSpacing: 4 } },
    ],
  },
  {
    name: 'Midnight Jazz', palette: 'Mono',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'line', props: {
        x: 0.06, y: 0.34, w: 0.88, h: 0.3, lineMode: 0, linePoints: 200, strokeWidth: 0.004,
        color: '{text}', gradient: false, fill: true, fillColor: '{text}', fillOpacity: 0.1,
        gain: 1.3, smoothing: 0.55 } },
      { type: 'meter', props: { x: 0.06, y: 0.7, w: 0.88, h: 0.01, source: 0, direction: 0,
        color: '{text}', cornerRadius: 1, trackColor: '{text}', trackOpacity: 0.1 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.08, w: 0.88, h: 0.1, size: 0.05,
        weight: 300, align: 0, color: '{text}', shadow: false, letterSpacing: 2 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.74, w: 0.6, h: 0.06, size: 0.026,
        weight: 300, align: 0, color: '{primary}', shadow: false } },
      { type: 'text', props: { pattern: '{clock}', x: 0.88, y: 0.08, w: 0.06, h: 0.06, size: 0.028,
        weight: 300, align: 2, color: '{primary}', shadow: false } },
    ],
  },
  {
    name: 'Cyber Grid', palette: 'Cyberpunk',
    components: () => [
      { type: 'background', props: { mode: 0, color: '{bg}' } },
      { type: 'spectrum', props: {
        x: 0.04, y: 0.24, w: 0.92, h: 0.6, bars: 32, gap: 0.3, barWidth: 0.8, roundness: 0,
        segmentShape: 1, segmentGap: 0.28, gradient: true, gradientMode: 2, color: '{primary}',
        color2: '{accent}', glow: 14, gain: 1.35, smoothing: 0.35, decay: 0.78, logScale: true,
        peaks: true, peakColor: '{secondary}', peakWidth: 5, peakFall: 1.4 } },
      { type: 'progress', props: { x: 0.04, y: 0.9, w: 0.92, h: 0.012, color: '{primary}',
        color2: '{secondary}', gradient: true, cornerRadius: 0, trackColor: '{accent}', trackOpacity: 0.12 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.06, w: 0.88, h: 0.1, size: 0.056,
        weight: 800, align: 0, uppercase: true, letterSpacing: 2, color: '{primary}',
        shadow: true, shadowColor: '{secondary}', shadowBlur: 14, marquee: true } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.16, w: 0.88, h: 0.06, size: 0.026,
        weight: 400, align: 0, color: '{accent}', shadow: false, uppercase: true, letterSpacing: 3 } },
    ],
  },
  {
    name: 'Deep Ocean', palette: 'Ocean',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'orb', props: {
        x: 0.3, y: 0.1, w: 0.4, h: sh(0.4), image: '{cover}', fit: 1, coverScale: 0.46,
        circle: true, rings: 3, linePoints: 180, ringRadius: 0.54, gap: 0.32, radialLength: 0.34,
        thickness: 0.011, gain: 1.15, smoothing: 0.65, decay: 0.93, angularSmooth: 0.6,
        fillColor: '{surface}', fillOpacity: 0.55, color: '{primary}', color2: '{secondary}',
        glow: 12, haloColor: '{accent}', pulseAmount: 0.12 } },
      { type: 'particles', props: {
        mode: 1, count: 60, size: 0.012, speed: 0.35, sway: 0.6, gravity: 0.1, twinkle: 0.8,
        beatBoost: 0.3, colorMode: 4, opacity: 0.5 } },
      { type: 'text', props: { pattern: '{title}', x: 0.08, y: 0.82, w: 0.84, h: 0.07, size: 0.038,
        weight: 300, align: 1, color: '{text}', shadow: true, shadowBlur: 10 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.08, y: 0.89, w: 0.84, h: 0.05, size: 0.022,
        weight: 300, align: 1, color: '{accent}', shadow: false } },
    ],
  },
  {
    name: 'Forest Calm', palette: 'Forest',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 52, dim: 0.7, color: '{bg}' } },
      { type: 'line', props: {
        x: 0.06, y: 0.36, w: 0.88, h: 0.26, lineMode: 1, linePoints: 160, strokeWidth: 0.005,
        color: '{primary}', gradient: false, fill: true, fillColor: '{primary}', fillOpacity: 0.16,
        gain: 1.15, smoothing: 0.7, decay: 0.92 } },
      { type: 'particles', props: {
        mode: 2, count: 80, size: 0.01, speed: 0.25, sway: 0.9, gravity: -0.05, twinkle: 0.5,
        beatBoost: 0.25, colorMode: 0, color: '#fde047', color2: '#4ade80', gradient: true, opacity: 0.4 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.08, w: 0.88, h: 0.09, size: 0.04,
        weight: 400, align: 0, color: '{text}', shadow: true, shadowBlur: 8 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.78, w: 0.88, h: 0.06, size: 0.026,
        weight: 300, align: 0, color: '{accent}', shadow: false } },
    ],
  },
  {
    name: 'Candy Pop', palette: 'Candy',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 45 } },
      { type: 'spectrum', props: {
        x: 0.06, y: 0.26, w: 0.88, h: 0.46, bars: 48, gap: 0.2, barWidth: 0.7, roundness: 1,
        centered: true, mirror: true, gradient: true, color: '{primary}', color2: '{accent}',
        glow: 16, gain: 1.4, smoothing: 0.45, decay: 0.84, minHeight: 0.03 } },
      { type: 'beat_glow', props: {
        x: 0.36, y: 0.3, w: 0.28, h: 0.28, intensity: 1.2, haloSize: 1.8, haloOpacity: 0.5,
        coreSize: 0.4, bloom: 0.55, follow: 1, color: '{secondary}', haloColor: '{primary}' } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.06, w: 0.88, h: 0.1, size: 0.052,
        weight: 800, align: 1, color: '{text}', shadow: true, shadowBlur: 12 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.84, w: 0.88, h: 0.06, size: 0.028,
        weight: 500, align: 1, color: '{accent}', shadow: false, marquee: true } },
    ],
  },
  {
    name: 'Golden Hour', palette: 'Gold',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 38, dim: 0.6, color: '#120d04' } },
      { type: 'cover', props: {
        x: 0.06, y: 0.2, w: 0.34, h: sh(0.34), image: '{cover}', fit: 1, coverScale: 0.72,
        cornerRadius: 0.3, radialBars: 80, ringRadius: 0.84, radialLength: 0.22, radialGap: 0.36,
        radialGain: 1.2, radialSmoothing: 0.55, color: '{primary}', color2: '{secondary}',
        glow: 18, haloColor: '{accent}', pulseAmount: 0.14 } },
      { type: 'spectrum', props: {
        x: 0.44, y: 0.3, w: 0.5, h: 0.34, bars: 40, gap: 0.26, roundness: 0.9, centered: true,
        gradient: true, color: '{primary}', color2: '{accent}', glow: 10, gain: 1.25, smoothing: 0.55 } },
      { type: 'particles', props: {
        mode: 0, count: 50, size: 0.014, speed: 0.4, sway: 0.5, gravity: -0.15, twinkle: 0.7,
        beatBoost: 0.5, colorMode: 0, color: '#ffd166', color2: '#f59e0b', gradient: true, opacity: 0.55 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.82, w: 0.88, h: 0.08, size: 0.046,
        weight: 400, align: 0, color: '{text}', shadow: true, shadowBlur: 12, marquee: true } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.9, w: 0.88, h: 0.05, size: 0.024,
        weight: 300, align: 0, color: '{accent}', shadow: false } },
    ],
  },
  {
    name: 'Ice Cold', palette: 'Ice',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'spectrum', props: {
        x: 0.05, y: 0.24, w: 0.9, h: 0.56, bars: 64, gap: 0.34, barWidth: 0.42, roundness: 1,
        baseline: 0, gradient: true, color: '{primary}', color2: '{secondary}', glow: 8,
        reflection: true, gain: 1.2, smoothing: 0.6, decay: 0.9, logScale: true } },
      { type: 'particles', props: {
        mode: 1, count: 110, size: 0.011, speed: 0.5, sway: 0.8, gravity: 0.15, twinkle: 0.9,
        beatBoost: 0.3, colorMode: 4, opacity: 0.45 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.07, w: 0.88, h: 0.1, size: 0.044,
        weight: 300, align: 0, color: '{text}', shadow: true, shadowBlur: 12, letterSpacing: 1 } },
      { type: 'text', props: { pattern: '{artist}  ·  {album}', x: 0.06, y: 0.86, w: 0.88, h: 0.05,
        size: 0.022, weight: 300, align: 0, color: '{accent}', shadow: false } },
      { type: 'progress', props: { x: 0.06, y: 0.93, w: 0.88, h: 0.005, color: '{primary}',
        trackColor: '{text}', trackOpacity: 0.12, cornerRadius: 1 } },
    ],
  },
  {
    name: 'Volcanic', palette: 'Ember',
    components: () => [
      { type: 'background', props: { mode: 0, color: '{bg}' } },
      { type: 'spectrum', props: {
        x: 0.03, y: 0.36, w: 0.94, h: 0.56, bars: 40, gap: 0.18, barWidth: 0.82, roundness: 0.4,
        baseline: 0, gradient: true, gradientMode: 1, color: '{secondary}', color2: '{primary}',
        glow: 24, gain: 1.6, minHeight: 0.04, maxHeight: 1, smoothing: 0.28, decay: 0.76,
        peaks: true, peakColor: '{accent}', peakWidth: 3, peakFall: 0.9 } },
      { type: 'particles', props: {
        mode: 0, count: 150, size: 0.016, speed: 1.6, sway: 0.6, gravity: -0.55, beatBoost: 1.4,
        shape: 2, rotation: 1, sizeVar: 0.6, colorMode: 0, color: '#ff6b35', color2: '#ffd166',
        gradient: true } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.06, w: 0.88, h: 0.1, size: 0.062,
        weight: 800, align: 0, uppercase: true, color: '{primary}', shadow: true,
        shadowColor: '{secondary}', shadowBlur: 16, shadowOffset: 4 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.17, w: 0.88, h: 0.05, size: 0.026,
        weight: 400, align: 0, color: '{accent}', shadow: false, uppercase: true, letterSpacing: 3 } },
    ],
  },
  {
    name: 'Miami Vice', palette: 'Miami',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'spectrum', props: {
        x: 0.05, y: 0.3, w: 0.9, h: 0.44, bars: 28, gap: 0.26, barWidth: 0.74, roundness: 0.8,
        centered: true, mirror: true, gradient: true, gradientMode: 2, color: '{primary}',
        color2: '{secondary}', glow: 20, reflection: true, gain: 1.4, smoothing: 0.4, decay: 0.82 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.06, w: 0.88, h: 0.1, size: 0.05,
        weight: 700, align: 0, uppercase: true, letterSpacing: 3, color: '{accent}',
        shadow: true, shadowColor: '{primary}', shadowBlur: 14 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.16, w: 0.88, h: 0.05, size: 0.024,
        weight: 400, align: 0, color: '{secondary}', shadow: false, uppercase: true, letterSpacing: 5 } },
      { type: 'progress', props: { x: 0.06, y: 0.86, w: 0.88, h: 0.008, color: '{primary}',
        color2: '{secondary}', gradient: true, cornerRadius: 1, trackColor: '{text}', trackOpacity: 0.1 } },
    ],
  },
  {
    name: 'Retro Arcade', palette: 'Retro',
    components: () => [
      { type: 'background', props: { mode: 0, color: '{bg}' } },
      { type: 'spectrum', props: {
        x: 0.06, y: 0.28, w: 0.88, h: 0.5, bars: 24, gap: 0.24, barWidth: 0.84, roundness: 0,
        segmentShape: 3, segmentGap: 0.18, gradient: true, gradientMode: 1, color: '{primary}',
        color2: '{accent}', glow: 10, gain: 1.35, smoothing: 0.3, decay: 0.75, logScale: true,
        peaks: true, peakColor: '{text}', peakWidth: 6, peakFall: 1.6 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.06, w: 0.88, h: 0.1, size: 0.06,
        weight: 700, align: 1, color: '{primary}', shadow: true, shadowColor: '{secondary}',
        shadowBlur: 12, shadowOffset: 3 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.82, w: 0.88, h: 0.06, size: 0.028,
        weight: 400, align: 1, color: '{accent}', shadow: false, uppercase: true, letterSpacing: 2 } },
      { type: 'meter', props: { x: 0.36, y: 0.9, w: 0.28, h: 0.012, source: 5, direction: 0,
        color: '{secondary}', cornerRadius: 0, trackColor: '{text}', trackOpacity: 0.12 } },
    ],
  },
  {
    name: 'Space Odyssey', palette: 'Deep Space',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 44, dim: 0.84, color: '#02010a' } },
      { type: 'orb', props: {
        x: 0.28, y: 0.05, w: 0.44, h: sh(0.44), image: '0', fit: 1, circle: true,
        coreSize: 0.34, rings: 5, linePoints: 240, ringRadius: 0.4, gap: 0.16, radialLength: 0.3,
        thickness: 0.008, gain: 1.25, smoothing: 0.42, decay: 0.88, arcStart: 90,
        angularSmooth: 0.4, paletteRings: true, fillColor: '{surface}', fillOpacity: 0.4,
        color: '{primary}', color2: '{secondary}', glow: 20, haloColor: '{accent}', pulseAmount: 0.16 } },
      { type: 'particles', props: {
        mode: 3, count: 180, size: 0.008, speed: 0.2, sway: 0.2, gravity: 0, twinkle: 1,
        beatBoost: 0.4, colorMode: 4, opacity: 0.8 } },
      { type: 'text', props: { pattern: '{title}', x: 0.08, y: 0.82, w: 0.84, h: 0.08, size: 0.042,
        weight: 300, align: 1, uppercase: true, letterSpacing: 6, color: '{text}',
        shadow: true, shadowBlur: 14 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.08, y: 0.9, w: 0.84, h: 0.05, size: 0.024,
        weight: 300, align: 1, color: '{accent}', shadow: false } },
    ],
  },
  {
    name: 'Sunset Drive', palette: 'Sunset',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 90 } },
      { type: 'radial_line', props: {
        x: 0.28, y: 0.06, w: 0.44, h: 0.72, lineMode: 0, linePoints: 220, strokeWidth: 0.006,
        ringRadius: 0.58, radialLength: 0.44, pulseAmount: 0.14, arcStart: 30, gradient: true,
        image: '{cover}', coverScale: 0.42, circle: true, color: '{primary}', color2: '{secondary}',
        glow: 14 } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.8, w: 0.88, h: 0.08, size: 0.046,
        weight: 700, align: 1, color: '{text}', shadow: true, shadowBlur: 12 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.88, w: 0.88, h: 0.05, size: 0.024,
        weight: 300, align: 1, color: '{accent}', shadow: false } },
    ],
  },
  {
    name: 'Neon Noir', palette: 'Mono',
    components: () => [
      { type: 'background', props: { mode: 0, color: '#000000' } },
      { type: 'line', props: {
        x: 0.05, y: 0.32, w: 0.9, h: 0.34, lineMode: 1, linePoints: 200, strokeWidth: 0.004,
        color: '#ffffff', gradient: false, fill: true, fillColor: '#ffffff', fillOpacity: 0.08,
        gain: 1.25, smoothing: 0.5 } },
      { type: 'beat_glow', props: {
        x: 0.3, y: 0.28, w: 0.4, h: 0.4, intensity: 0.7, haloSize: 2.2, haloOpacity: 0.28,
        coreSize: 0.3, bloom: 0.7, follow: 1, color: '#f5f5f5', haloColor: '#9ca3af' } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.08, w: 0.88, h: 0.1, size: 0.044,
        weight: 300, align: 0, color: '#ffffff', shadow: true, shadowBlur: 16, letterSpacing: 3 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.76, w: 0.88, h: 0.06, size: 0.024,
        weight: 300, align: 0, color: '#9ca3af', shadow: false, uppercase: true, letterSpacing: 4 } },
      { type: 'progress', props: { x: 0.06, y: 0.88, w: 0.88, h: 0.004, color: '#ffffff',
        trackColor: '#ffffff', trackOpacity: 0.14, cornerRadius: 1 } },
    ],
  },
  {
    name: 'Winter Wonderland', palette: 'Ice',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 44, dim: 0.66, color: '{bg}' } },
      { type: 'particles', props: {
        mode: 1, count: 200, size: 0.014, speed: 0.45, sway: 0.9, gravity: 0.22, twinkle: 1,
        beatBoost: 0.35, sizeVar: 0.6, colorMode: 4, opacity: 0.7 } },
      { type: 'spectrum', props: {
        x: 0.12, y: 0.36, w: 0.76, h: 0.4, bars: 36, gap: 0.32, barWidth: 0.6, roundness: 1,
        centered: true, gradient: true, color: '{primary}', color2: '{text}', glow: 7,
        gain: 1.15, smoothing: 0.62, decay: 0.9 } },
      { type: 'text', props: { pattern: '{title}', x: 0.08, y: 0.08, w: 0.84, h: 0.1, size: 0.048,
        weight: 300, align: 1, color: '{text}', shadow: true, shadowBlur: 14 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.08, y: 0.82, w: 0.84, h: 0.06, size: 0.026,
        weight: 300, align: 1, color: '{accent}', shadow: false } },
    ],
  },
  {
    name: 'Latin Heat', palette: 'Miami',
    components: () => [
      { type: 'background', props: { mode: 1, color: '{bg}', color2: '{surface}', gradientAngle: 30 } },
      { type: 'spectrum', props: {
        x: 0.04, y: 0.32, w: 0.92, h: 0.48, bars: 44, gap: 0.22, barWidth: 0.8, roundness: 0.6,
        baseline: 0, gradient: true, gradientMode: 1, color: '{primary}', color2: '{secondary}',
        glow: 22, reflection: true, gain: 1.5, smoothing: 0.32, decay: 0.8, minHeight: 0.04,
        peaks: true, peakColor: '{accent}', peakWidth: 4, peakFall: 1.1 } },
      { type: 'particles', props: {
        mode: 4, count: 120, size: 0.02, speed: 1.8, sway: 0.7, gravity: -0.1, beatBoost: 1.8,
        shape: 5, sizeVar: 0.55, colorMode: 2, gradient: true } },
      { type: 'text', props: { pattern: '{title}', x: 0.06, y: 0.06, w: 0.88, h: 0.1, size: 0.058,
        weight: 800, align: 0, color: '{accent}', shadow: true, shadowColor: '{primary}',
        shadowBlur: 14, shadowOffset: 3 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.06, y: 0.86, w: 0.88, h: 0.06, size: 0.03,
        weight: 500, align: 0, color: '{text}', shadow: false, marquee: true } },
    ],
  },
  {
    name: 'Chill Lounge', palette: 'Pastel',
    components: () => [
      { type: 'background', props: { mode: 2, image: '{cover}', blur: 50, dim: 0.6, color: '#1a1a2e' } },
      { type: 'orb', props: {
        x: 0.32, y: 0.12, w: 0.36, h: sh(0.36), image: '{cover}', fit: 1, coverScale: 0.44,
        circle: true, rings: 2, linePoints: 160, ringRadius: 0.6, gap: 0.4, radialLength: 0.26,
        thickness: 0.01, gain: 1.1, smoothing: 0.68, decay: 0.94, angularSmooth: 0.55,
        color: '{primary}', color2: '{secondary}', glow: 10, haloColor: '{accent}', pulseAmount: 0.1 } },
      { type: 'text', props: { pattern: '{title}', x: 0.08, y: 0.8, w: 0.84, h: 0.08, size: 0.04,
        weight: 300, align: 1, color: '{text}', shadow: true, shadowBlur: 12 } },
      { type: 'text', props: { pattern: '{artist}', x: 0.08, y: 0.88, w: 0.84, h: 0.05, size: 0.022,
        weight: 300, align: 1, color: '{accent}', shadow: false } },
      { type: 'meter', props: { x: 0.3, y: 0.94, w: 0.4, h: 0.008, source: 0, direction: 0,
        color: '{primary}', cornerRadius: 1, trackColor: '{text}', trackOpacity: 0.08 } },
    ],
  },
].map((t) => ({
  version: SCHEMA_VERSION,
  name: t.name,
  author: 'generated',
  palette: t.palette,
  components: t.components(),
}));

const generated = [...generatePresets(), ...extras, spotifyTv, ...SHOWCASE,
  ...TERRAIN_THEMES, ...THEMES];
mkdirSync(outDir, { recursive: true });
// Drop stale generated files; hand-authored ones are never touched.
for (const f of readdirSync(outDir).filter((f) => f.endsWith(".json"))) {
  try {
    if (JSON.parse(readFileSync(join(outDir, f), "utf8")).author === "generated") rmSync(join(outDir, f));
  } catch (_) { /* keep unreadable files */ }
}
const written = [];
for (const p of generated) {
  const file = slug(p.name) + ".json";
  writeFileSync(join(outDir, file), toJson(normalizePreset(p)) + "\n");
  written.push(file);
}
written.sort();
const all = readdirSync(outDir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
writeFileSync(join(outDir, "index.json"), JSON.stringify(all, null, 2) + "\n");
written.forEach((f) => console.log("wrote presets/default/" + f));
console.log("wrote presets/default/index.json (" + all.length + " files)");
