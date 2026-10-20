// Preset schema + built-in presets.
//
// A preset is plain JSON and is the ONLY contract between the editor, the
// engine and (later) the Android app:
//
// {
//   "name": "Neon bars",
//   "surface": { "background": "#05060a" },
//   "components": [
//     { "type": "spectrum", "props": { "bars": 48, "roundness": 0.5, ... } },
//     { "type": "text",     "props": { "pattern": "{title}", "size": 0.07 } }
//   ]
// }
//
// `props` keys are the exact prop names the engine registers (vze_prop_id).
// The schema below drives the inspector UI, so adding a prop here is all it
// takes to expose it for editing.

export const SCHEMA_VERSION = 1;

import { DEFAULT_PALETTE_NAME, PALETTE_ROLES } from './palettes.js';

export const COMPONENT_TYPES = [
  { type: 'background', label: 'Background', hint: 'solid / gradient / image backdrop' },
  { type: 'spectrum', label: 'Spectrum bars', hint: 'FFT bars, optional falling peaks' },
  { type: 'line', label: 'Line', hint: 'waveform or spectrum curve' },
  { type: 'text', label: 'Text', hint: 'bound to {title} {artist} {clock} …' },
  { type: 'image', label: 'Image', hint: 'cover art or artwork' },
  { type: 'cover', label: 'Cover + radial', hint: 'cover art ringed by a radial spectrum, glow and beat pulse' },
  { type: 'orb', label: 'Orb', hint: 'cover art ringed by glow spectrum lines' },
  { type: 'progress', label: 'Song progress', hint: 'bar bound to the track position' },
  { type: 'radial_line', label: 'Radial line', hint: 'circular waveform / spectrum line' },
  { type: 'particles', label: 'Particles', hint: 'embers, snow, dust, stars or beat sparks' },
  { type: 'dotmatrix', label: 'Dot matrix', hint: 'LED dot-grid equalizer' },
  { type: 'rays', label: 'Rays', hint: 'sunburst spokes driven by the spectrum' },
  { type: 'terrain', label: 'Terrain', hint: '3D spectrum mountains with an orbiting camera' },
  { type: 'shape', label: 'Shape', hint: 'panel, divider or disc' },
  { type: 'meter', label: 'Meter', hint: 'level / progress, linear or ring' },
  { type: 'beat', label: 'Beat pulse', hint: 'rings that fire on the beat' },
  { type: 'beat_glow', label: 'Beat glow', hint: 'blooming orb that flares on the beat' },
];

const geometry = (over) => ([
  { key: 'x', label: 'X', kind: 'range', group: 'Layout', min: -0.5, max: 1.5, step: 0.002, default: 0 },
  { key: 'y', label: 'Y', kind: 'range', group: 'Layout', min: -0.5, max: 1.5, step: 0.002, default: 0 },
  { key: 'w', label: 'Width', kind: 'range', group: 'Layout', min: 0.01, max: 2, step: 0.002, default: 1 },
  { key: 'h', label: 'Height', kind: 'range', group: 'Layout', min: 0.01, max: 2, step: 0.002, default: 1 },
  { key: 'opacity', label: 'Opacity', kind: 'range', group: 'Layout', min: 0, max: 1, step: 0.01, default: 1 },
].map((p) => Object.assign(p, (over || {})[p.key] || {})));

const colorProps = (group) => ([
  { key: 'color', label: 'Color', kind: 'color', group },
  { key: 'color2', label: 'Color 2', kind: 'color', group },
  { key: 'gradient', label: 'Gradient', kind: 'bool', group },
  { key: 'gradientAngle', label: 'Gradient angle', kind: 'range', group, min: 0, max: 360, step: 1 },
  { key: 'glow', label: 'Glow', kind: 'range', group, min: 0, max: 30, step: 0.5 },
]);

export const SCHEMAS = {
  background: [
    { key: 'mode', label: 'Mode', kind: 'select', group: 'Background',
      options: [{ v: 0, t: 'Solid' }, { v: 1, t: 'Gradient' }, { v: 2, t: 'Image' }] },
    { key: 'color', label: 'Color', kind: 'color', group: 'Background' },
    { key: 'color2', label: 'Color 2', kind: 'color', group: 'Background' },
    { key: 'gradientAngle', label: 'Gradient angle', kind: 'range', group: 'Background', min: 0, max: 360, step: 1 },
    { key: 'image', label: 'Image', kind: 'image', group: 'Background', hint: 'an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset', default: '{cover}' },
    { key: 'fit', label: 'Fit', kind: 'select', group: 'Background',
      options: [{ v: 0, t: 'Contain' }, { v: 1, t: 'Cover' }, { v: 2, t: 'Stretch' }], default: 1 },
    { key: 'blur', label: 'Blur', kind: 'range', group: 'Background', min: 0, max: 100, step: 0.5 },
    { key: 'dim', label: 'Dim', kind: 'range', group: 'Background', min: 0, max: 1, step: 0.01 },
    { key: 'pulseAmount', label: 'Beat pulse', kind: 'range', group: 'Background', min: 0, max: 0.9, step: 0.01, default: 0,
      hint: 'image zooms with the beat and dips down, easing back (image mode only)' },
    ...geometry({ x: { default: 0 }, y: { default: 0 }, w: { default: 1 }, h: { default: 1 } }),
  ],

  spectrum: [
    { key: 'bars', label: 'Bars', kind: 'range', group: 'Bars', min: 2, max: 160, step: 1, default: 48 },
    { key: 'gap', label: 'Gap', kind: 'range', group: 'Bars', min: 0, max: 0.8, step: 0.01, default: 0.2 },
    { key: 'barWidth', label: 'Bar width', kind: 'range', group: 'Bars', min: 0.05, max: 1, step: 0.01, default: 0.8 },
    { key: 'roundness', label: 'Roundness', kind: 'range', group: 'Bars', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'baseline', label: 'Anchor', kind: 'select', group: 'Bars',
      options: [{ v: 0, t: 'Bottom' }, { v: 1, t: 'Center' }, { v: 2, t: 'Top' }] },
    { key: 'centered', label: 'Center bars', kind: 'bool', group: 'Bars' },
    { key: 'mirror', label: 'Mirror', kind: 'bool', group: 'Bars' },
    { key: 'reflection', label: 'Reflection (glass floor)', kind: 'bool', group: 'Bars',
      hint: 'mirrors the bars below the baseline, fading with depth; bottom anchor only (ignored when Center bars is on)' },
    ...colorProps('Color'),
    { key: 'gradientMode', label: 'Gradient mode', kind: 'select', group: 'Color',
      options: [{ v: 0, t: 'Stretch (per bar)' }, { v: 1, t: 'Reveal (box ramp)' }, { v: 2, t: 'Palette ramp' }], default: 0,
      hint: 'stretch paints every bar in full color; reveal fixes the ramp to the box so short bars stay dark; palette runs the whole palette up the box' },
    { key: 'colorMode', label: 'Bar colors', kind: 'select', group: 'Color',
      options: [{ v: 0, t: 'Manual' }, { v: 1, t: 'Random' }, { v: 2, t: 'Random palette' }, { v: 3, t: 'Complementary' }, { v: 4, t: 'Cover' }], default: 0,
      hint: 'per-bar colors; cover picks the vivid palette roles (the artwork under From cover)' },
    { key: 'gain', label: 'Gain', kind: 'range', group: 'Response', min: 0.2, max: 4, step: 0.05, default: 1.15 },
    { key: 'minHeight', label: 'Min height', kind: 'range', group: 'Response', min: 0, max: 0.5, step: 0.005, default: 0.01 },
    { key: 'maxHeight', label: 'Max height', kind: 'range', group: 'Response', min: 0.05, max: 1, step: 0.01, default: 1 },
    { key: 'smoothing', label: 'Attack smoothing', kind: 'range', group: 'Response', min: 0, max: 0.95, step: 0.01, default: 0.55 },
    { key: 'decay', label: 'Decay', kind: 'range', group: 'Response', min: 0, max: 0.99, step: 0.01, default: 0.82 },
    { key: 'logScale', label: 'Log scale', kind: 'bool', group: 'Response', default: true },
    { key: 'bandStart', label: 'Band start', kind: 'range', group: 'Response', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'bandEnd', label: 'Band end', kind: 'range', group: 'Response', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'peaks', label: 'Peaks', kind: 'bool', group: 'Peaks' },{ key: 'tilt', label: 'Tilt', kind: 'range', group: 'Response', min: -6, max: 6, step: 0.25, default: 0,
      hint: 'dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)' },

    { key: 'peakColor', label: 'Peak color', kind: 'color', group: 'Peaks', default: '#ffffff' },
    { key: 'peakWidth', label: 'Peak width', kind: 'range', group: 'Peaks', min: 1, max: 24, step: 1, default: 4 },
    { key: 'peakDelay', label: 'Peak stop delay', kind: 'range', group: 'Peaks', min: 0, max: 6, step: 0.05, default: 0,
      hint: 'seconds a cap sits still after its bar drops, before it starts falling' },
    { key: 'peakGap', label: 'Peak gap', kind: 'range', group: 'Peaks', min: 0, max: 40, step: 1, default: 0,
      hint: 'keeps the cap clear above the bar tip so it never hides inside the bar' },
    { key: 'peakFall', label: 'Peak fall', kind: 'range', group: 'Peaks', min: 0, max: 4, step: 0.05, default: 1.1 },
    { key: 'segmentShape', label: 'Segments', kind: 'select', group: 'Segments',
      options: [{ v: 0, t: 'None (solid)' }, { v: 1, t: 'Circles' }, { v: 2, t: 'Squares' }, { v: 3, t: 'Half squares' }], default: 0,
      hint: 'LED-style segments auto-fit to the bar width (squares stay square, circles stay round); each lit segment takes the ramp color at its height' },
    { key: 'segmentGap', label: 'Segment gap', kind: 'range', group: 'Segments', min: 0, max: 0.8, step: 0.01, default: 0.2,
      hint: 'gap as a fraction of the segment size' },
    ...geometry({ x: { default: 0.04 }, y: { default: 0.45 }, w: { default: 0.92 }, h: { default: 0.5 } }),
  ],

  line: [
    { key: 'lineMode', label: 'Source', kind: 'select', group: 'Line',
      options: [{ v: 0, t: 'Waveform' }, { v: 1, t: 'Spectrum curve' }] },
    { key: 'linePoints', label: 'Points', kind: 'range', group: 'Line', min: 8, max: 512, step: 4, default: 160 },
    { key: 'strokeWidth', label: 'Thickness', kind: 'range', group: 'Line', min: 0.001, max: 0.06, step: 0.001, default: 0.008, pct: true },
    ...colorProps('Color'),
    { key: 'smoothing', label: 'Smoothing', kind: 'range', group: 'Response', min: 0, max: 0.95, step: 0.01, default: 0.45 },
    { key: 'gain', label: 'Gain', kind: 'range', group: 'Response', min: 0.2, max: 4, step: 0.05, default: 1.2 },
    { key: 'fill', label: 'Fill under curve', kind: 'bool', group: 'Fill' },{ key: 'tilt', label: 'Tilt', kind: 'range', group: 'Response', min: -6, max: 6, step: 0.25, default: 0,
      hint: 'dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)' },

    { key: 'fillColor', label: 'Fill color', kind: 'color', group: 'Fill', default: '#00e5ff' },
    { key: 'fillOpacity', label: 'Fill opacity', kind: 'range', group: 'Fill', min: 0, max: 1, step: 0.01, default: 0.22 },
    ...geometry({ x: { default: 0.05 }, y: { default: 0.3 }, w: { default: 0.9 }, h: { default: 0.3 } }),
  ],

  text: [
    { key: 'pattern', label: 'Pattern', kind: 'text', group: 'Content',
      hint: 'use {title} {artist} {album} {clock} {date} {position} {duration} {remaining} {bpm}',
      default: '{title}' },
    { key: 'uppercase', label: 'Uppercase', kind: 'bool', group: 'Content' },
    { key: 'size', label: 'Size', kind: 'range', group: 'Text', min: 0.01, max: 0.35, step: 0.002, default: 0.06, pct: true },
    { key: 'weight', label: 'Weight', kind: 'select', group: 'Text',
      options: [{ v: 300, t: 'Light' }, { v: 400, t: 'Regular' }, { v: 700, t: 'Bold' }], default: 400 },
    { key: 'font', label: 'Font', kind: 'select', group: 'Text',
      options: [
        { v: '', t: 'System' }, { v: 'Inter', t: 'Inter' }, { v: 'Roboto', t: 'Roboto' },
        { v: 'Open Sans', t: 'Open Sans' }, { v: 'Lato', t: 'Lato' }, { v: 'Montserrat', t: 'Montserrat' },
        { v: 'Poppins', t: 'Poppins' }, { v: 'Oswald', t: 'Oswald' }, { v: 'Raleway', t: 'Raleway' },
        { v: 'Nunito', t: 'Nunito' }, { v: 'Playfair Display', t: 'Playfair Display' },
        { v: 'DSEG7 Classic', t: 'DSEG7 (segmented)' },
      ] },
    { key: 'italic', label: 'Italic', kind: 'bool', group: 'Text' },
    { key: 'letterSpacing', label: 'Letter spacing', kind: 'range', group: 'Text', min: 0, max: 20, step: 0.5 },
    { key: 'align', label: 'Align', kind: 'select', group: 'Text',
      options: [{ v: 0, t: 'Left' }, { v: 1, t: 'Center' }, { v: 2, t: 'Right' }] },
    { key: 'valign', label: 'Vertical', kind: 'select', group: 'Text',
      options: [{ v: 0, t: 'Top' }, { v: 1, t: 'Middle' }, { v: 2, t: 'Bottom' }] },
    { key: 'color', label: 'Color', kind: 'color', group: 'Text', default: '#ffffff' },
    { key: 'glow', label: 'Glow', kind: 'range', group: 'Text', min: 0, max: 30, step: 0.5 },
    { key: 'shadow', label: 'Shadow', kind: 'bool', group: 'Shadow', default: true },
    { key: 'shadowColor', label: 'Shadow color', kind: 'color', group: 'Shadow', default: '#000000' },
    { key: 'shadowBlur', label: 'Shadow blur', kind: 'range', group: 'Shadow', min: 0, max: 40, step: 0.5, default: 8 },
    { key: 'shadowOffset', label: 'Shadow offset', kind: 'range', group: 'Shadow', min: 0, max: 20, step: 0.5, default: 3 },
    { key: 'marquee', label: 'Scroll if too long', kind: 'bool', group: 'Scroll' },
    { key: 'marqueeSpeed', label: 'Scroll speed', kind: 'range', group: 'Scroll', min: 5, max: 200, step: 1, default: 40 },
    { key: 'marqueeGap', label: 'Wrap gap', kind: 'range', group: 'Scroll', min: 0, max: 2, step: 0.05, default: 0.5,
      hint: 'empty space behind the tail before it wraps, in box widths' },
    { key: 'marqueePause', label: 'Hold at start', kind: 'range', group: 'Scroll', min: 0, max: 30, step: 0.5, default: 5,
      hint: 'seconds the text holds still before each scroll (Spotify style)' },
    ...geometry({ x: { default: 0.06 }, y: { default: 0.08 }, w: { default: 0.88 }, h: { default: 0.12 } }),
  ],

  image: [
    { key: 'image', label: 'Image', kind: 'image', group: 'Image', hint: 'an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset', default: '{cover}' },
    { key: 'fit', label: 'Fit', kind: 'select', group: 'Image',
      options: [{ v: 0, t: 'Contain' }, { v: 1, t: 'Cover' }, { v: 2, t: 'Stretch' }], default: 1 },
    { key: 'cornerRadius', label: 'Corner radius', kind: 'range', group: 'Image', min: 0, max: 1, step: 0.01, default: 0.12 },
    { key: 'circle', label: 'Circle mask', kind: 'bool', group: 'Image' },
    { key: 'blur', label: 'Blur', kind: 'range', group: 'Image', min: 0, max: 100, step: 0.5, default: 0 },
    { key: 'flipX', label: 'Flip X', kind: 'bool', group: 'Image' },
    { key: 'flipY', label: 'Flip Y', kind: 'bool', group: 'Image' },
    { key: 'tint', label: 'Tint amount', kind: 'range', group: 'Tint', min: 0, max: 1, step: 0.01 },
    { key: 'tintColor', label: 'Tint color', kind: 'color', group: 'Tint', default: '#4d7cff' },
    ...geometry({ x: { default: 0.04 }, y: { default: 0.3 }, w: { default: 0.24 }, h: { default: 0.42 } }),
  ],

  cover: [
    { key: 'image', label: 'Image', kind: 'image', group: 'Cover', hint: 'an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset', default: '{cover}' },
    { key: 'coverScale', label: 'Cover size', kind: 'range', group: 'Cover', min: 0.1, max: 1, step: 0.01, default: 0.6, pct: true },
    { key: 'imageAspect', label: 'Image aspect', kind: 'range', group: 'Cover', min: 0.25, max: 4, step: 0.05, default: 1,
      hint: 'width ÷ height of the center image (1 = square); the spectrum ring stays circular' },
    { key: 'centerX', label: 'Center X', kind: 'range', group: 'Cover', min: 0, max: 1, step: 0.01, default: 0.5, pct: true,
      hint: 'moves the effect (rings, loops, glow) relative to the image, which stays centered' },
    { key: 'centerY', label: 'Center Y', kind: 'range', group: 'Cover', min: 0, max: 1, step: 0.01, default: 0.5, pct: true,
      hint: 'moves the effect (rings, loops, glow) relative to the image, which stays centered' },
    { key: 'fit', label: 'Fit', kind: 'select', group: 'Cover',
      options: [{ v: 0, t: 'Contain' }, { v: 1, t: 'Cover' }, { v: 2, t: 'Stretch' }], default: 1 },
    { key: 'cornerRadius', label: 'Border radius', kind: 'range', group: 'Cover', min: 0, max: 1, step: 0.01, default: 0.14 },
    { key: 'circle', label: 'Circle mask', kind: 'bool', group: 'Cover' },
    { key: 'imagePulse', label: 'Image beat pulse', kind: 'bool', group: 'Cover', default: true },
    { key: 'blur', label: 'Blur', kind: 'range', group: 'Cover', min: 0, max: 100, step: 0.5, default: 0 },
    { key: 'flipX', label: 'Flip X', kind: 'bool', group: 'Cover' },
    { key: 'flipY', label: 'Flip Y', kind: 'bool', group: 'Cover' },
    { key: 'tint', label: 'Tint amount', kind: 'range', group: 'Cover', min: 0, max: 1, step: 0.01 },
    { key: 'tintColor', label: 'Tint color', kind: 'color', group: 'Cover', default: '#4d7cff' },

    { key: 'radialBars', label: 'Bars', kind: 'range', group: 'Radial spectrum', min: 4, max: 180, step: 1, default: 64 },
    { key: 'ringRadius', label: 'Inner radius', kind: 'range', group: 'Radial spectrum', min: 0, max: 0.98, step: 0.01, default: 0.42, pct: true },
    { key: 'radialLength', label: 'Bar length', kind: 'range', group: 'Radial spectrum', min: 0.02, max: 1, step: 0.01, default: 0.5, pct: true },
    { key: 'radialGap', label: 'Bar gap', kind: 'range', group: 'Radial spectrum', min: 0, max: 0.9, step: 0.01, default: 0.3 },
    { key: 'arcStart', label: 'Start angle', kind: 'range', group: 'Radial spectrum', min: 0, max: 360, step: 1, default: 0 },
    { key: 'arcSpan', label: 'Arc span', kind: 'range', group: 'Radial spectrum', min: 30, max: 360, step: 1, default: 360 },
    { key: 'radialGain', label: 'Gain', kind: 'range', group: 'Radial spectrum', min: 0.2, max: 4, step: 0.05, default: 1.2 },
{ key: 'tilt', label: 'Tilt', kind: 'range', group: 'Response', min: -6, max: 6, step: 0.25, default: 0,
      hint: 'dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)' },
    { key: 'radialSmoothing', label: 'Attack smoothing', kind: 'range', group: 'Radial spectrum', min: 0, max: 0.95, step: 0.01, default: 0.5 },
    { key: 'radialDecay', label: 'Decay', kind: 'range', group: 'Radial spectrum', min: 0, max: 0.99, step: 0.01, default: 0.85 },
    { key: 'radialPeaks', label: 'Peak caps', kind: 'bool', group: 'Radial spectrum' },
    { key: 'radialPeakColor', label: 'Peak color', kind: 'color', group: 'Radial spectrum', default: '#ffffff' },
    { key: 'peakDelay', label: 'Peak stop delay', kind: 'range', group: 'Radial spectrum', min: 0, max: 6, step: 0.05, default: 0,
      hint: 'seconds a cap sits still after its bar drops, before it starts falling' },
    { key: 'peakGap', label: 'Peak gap', kind: 'range', group: 'Radial spectrum', min: 0, max: 40, step: 1, default: 0,
      hint: 'keeps the cap clear beyond the bar tip' },
    { key: 'mirror', label: 'Mirror', kind: 'bool', group: 'Radial spectrum',
      hint: 'folds the ring symmetric about the vertical centre' },

    { key: 'color', label: 'Bar color', kind: 'color', group: 'Color', default: '#00e5ff' },
    { key: 'color2', label: 'Bar color 2', kind: 'color', group: 'Color', default: '#ff2d95' },
    { key: 'glow', label: 'Glow', kind: 'range', group: 'Glow', min: 0, max: 30, step: 0.5, default: 14 },
    { key: 'haloColor', label: 'Glow color', kind: 'color', group: 'Glow', default: '#7c5cff' },
    { key: 'pulseAmount', label: 'Beat pulse', kind: 'range', group: 'Glow', min: 0, max: 0.9, step: 0.01, default: 0.12 },
    ...geometry({ x: { default: 0.31 }, y: { default: 0.16 }, w: { default: 0.38 }, h: { default: 0.68 } }),
  ],

  orb: [
    { key: 'image', label: 'Image', kind: 'image', group: 'Center', hint: 'an uploaded image, {cover} for the track artwork, or a data:image/... URL embedded in the preset', default: '{cover}' },
    { key: 'coverScale', label: 'Center size', kind: 'range', group: 'Center', min: 0.1, max: 1, step: 0.01, default: 0.5, pct: true },
    { key: 'imageAspect', label: 'Image aspect', kind: 'range', group: 'Center', min: 0.25, max: 4, step: 0.05, default: 1,
      hint: 'width ÷ height of the center image (1 = square); the spectrum ring stays circular' },
    { key: 'centerX', label: 'Center X', kind: 'range', group: 'Center', min: 0, max: 1, step: 0.01, default: 0.5, pct: true,
      hint: 'moves the effect (rings, loops, glow) relative to the image, which stays centered' },
    { key: 'centerY', label: 'Center Y', kind: 'range', group: 'Center', min: 0, max: 1, step: 0.01, default: 0.5, pct: true,
      hint: 'moves the effect (rings, loops, glow) relative to the image, which stays centered' },
    { key: 'fit', label: 'Fit', kind: 'select', group: 'Center',
      options: [{ v: 0, t: 'Contain' }, { v: 1, t: 'Cover' }, { v: 2, t: 'Stretch' }], default: 1 },
    { key: 'cornerRadius', label: 'Border radius', kind: 'range', group: 'Center', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'circle', label: 'Circle mask', kind: 'bool', group: 'Center', default: true },
    { key: 'imagePulse', label: 'Image beat pulse', kind: 'bool', group: 'Center', default: true },
    { key: 'blur', label: 'Blur', kind: 'range', group: 'Center', min: 0, max: 40, step: 0.5, default: 0 },

    { key: 'rings', label: 'Rings', kind: 'range', group: 'Spectrum lines', min: 1, max: 6, step: 1, default: 3 },
    { key: 'linePoints', label: 'Points', kind: 'range', group: 'Spectrum lines', min: 24, max: 512, step: 4, default: 160 },
    { key: 'ringRadius', label: 'Inner radius', kind: 'range', group: 'Spectrum lines', min: 0, max: 0.95, step: 0.01, default: 0.42, pct: true },
    { key: 'gap', label: 'Ring spacing', kind: 'range', group: 'Spectrum lines', min: 0, max: 0.9, step: 0.01, default: 0.3 },
    { key: 'radialLength', label: 'Wave height', kind: 'range', group: 'Spectrum lines', min: 0.02, max: 1, step: 0.01, default: 0.5, pct: true },
    { key: 'thickness', label: 'Line width', kind: 'range', group: 'Spectrum lines', min: 0.002, max: 0.08, step: 0.001, default: 0.014, pct: true },
    { key: 'gain', label: 'Gain', kind: 'range', group: 'Spectrum lines', min: 0.2, max: 4, step: 0.05, default: 1.25 },
{ key: 'tilt', label: 'Tilt', kind: 'range', group: 'Response', min: -6, max: 6, step: 0.25, default: 0,
      hint: 'dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)' },
    { key: 'smoothing', label: 'Attack smoothing', kind: 'range', group: 'Spectrum lines', min: 0, max: 0.95, step: 0.01, default: 0.5 },
    { key: 'decay', label: 'Decay', kind: 'range', group: 'Spectrum lines', min: 0, max: 0.99, step: 0.01, default: 0.86 },
    { key: 'mirror', label: 'Mirror', kind: 'bool', group: 'Spectrum lines',
      hint: 'folds the rings symmetric about the vertical centre (holds the drift still)' },
    { key: 'arcStart', label: 'Start angle', kind: 'range', group: 'Spectrum lines', min: 0, max: 360, step: 1, default: 0,
      hint: 'rotates the whole display (0 = top, clockwise)' },
    { key: 'angularSmooth', label: 'Angle smoothing', kind: 'range', group: 'Spectrum lines', min: 0, max: 0.95, step: 0.01, default: 0,
      hint: 'blurs each ring across its neighbours so bands never spike sharp' },
    { key: 'reflection', label: 'Reflection (glass floor)', kind: 'bool', group: 'Spectrum lines',
      hint: 'one faded flipped copy below the box' },

    { key: 'color', label: 'Line color', kind: 'color', group: 'Color', default: '#7dffd4' },
    { key: 'color2', label: 'Line color 2', kind: 'color', group: 'Color', default: '#00e5ff' },
    { key: 'paletteRings', label: 'Palette per ring', kind: 'bool', group: 'Color',
      hint: 'every ring takes one solid palette role, vivid first' },
    { key: 'fillColor', label: 'Inner fill', kind: 'color', group: 'Inner fill', default: '#00e5ff',
      hint: 'solid disc out to the innermost ring' },
    { key: 'fillOpacity', label: 'Inner fill opacity', kind: 'range', group: 'Inner fill', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'glow', label: 'Glow', kind: 'range', group: 'Glow', min: 0, max: 30, step: 0.5, default: 16 },
    { key: 'haloColor', label: 'Glow color', kind: 'color', group: 'Glow', default: '#00e5ff' },
    { key: 'pulseAmount', label: 'Beat pulse', kind: 'range', group: 'Glow', min: 0, max: 0.9, step: 0.01, default: 0.14 },
    { key: 'coreSize', label: 'Core size', kind: 'range', group: 'Glow', min: 0.1, max: 2, step: 0.05, default: 0.5 },
    ...geometry({ x: { default: 0.3 }, y: { default: 0.14 }, w: { default: 0.4 }, h: { default: 0.72 } }),
  ],

  shape: [
    { key: 'shape', label: 'Shape', kind: 'select', group: 'Shape',
      options: [{ v: 0, t: 'Rectangle' }, { v: 1, t: 'Circle' }, { v: 2, t: 'Divider' }] },
    ...colorProps('Color'),
    { key: 'cornerRadius', label: 'Corner radius', kind: 'range', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.08 },
    { key: 'filled', label: 'Filled', kind: 'bool', group: 'Shape', default: true },
    { key: 'strokeWidth', label: 'Stroke', kind: 'range', group: 'Shape', min: 0.001, max: 0.06, step: 0.001, default: 0.006, pct: true },
    ...geometry({ x: { default: 0.05 }, y: { default: 0.7 }, w: { default: 0.4 }, h: { default: 0.08 } }),
  ],

  meter: [
    { key: 'source', label: 'Source', kind: 'select', group: 'Meter',
      options: [{ v: 0, t: 'RMS' }, { v: 1, t: 'Peak' }, { v: 2, t: 'Bass' }, { v: 3, t: 'Mid' }, { v: 4, t: 'Treble' }, { v: 5, t: 'Beat' }] },
    { key: 'direction', label: 'Direction', kind: 'select', group: 'Meter',
      options: [{ v: 0, t: 'Left to Right' }, { v: 1, t: 'Bottom to Top' }, { v: 2, t: 'Ring' }] },
    { key: 'thickness', label: 'Ring thickness', kind: 'range', group: 'Meter', min: 0.005, max: 0.2, step: 0.005, default: 0.03, pct: true },
    ...colorProps('Color'),
    { key: 'cornerRadius', label: 'Corner radius', kind: 'range', group: 'Meter', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'trackColor', label: 'Track color', kind: 'color', group: 'Track', default: '#ffffff' },
    { key: 'trackOpacity', label: 'Track opacity', kind: 'range', group: 'Track', min: 0, max: 1, step: 0.01, default: 0.15 },
    ...geometry({ x: { default: 0.05 }, y: { default: 0.85 }, w: { default: 0.9 }, h: { default: 0.02 } }),
  ],

  dotmatrix: [
    { key: 'cols', label: 'Columns', kind: 'range', group: 'Grid', min: 4, max: 96, step: 1, default: 32 },
    { key: 'rows', label: 'Rows', kind: 'range', group: 'Grid', min: 2, max: 48, step: 1, default: 16 },
    { key: 'cellShape', label: 'Cell', kind: 'select', group: 'Grid',
      options: [{ v: 0, t: 'Circle' }, { v: 1, t: 'Square' }, { v: 2, t: 'Rounded square' }], default: 0 },
    { key: 'gap', label: 'Cell gap', kind: 'range', group: 'Grid', min: 0, max: 0.8, step: 0.01, default: 0.2 },
    { key: 'dimColor', label: 'Off cell color', kind: 'color', group: 'Grid', default: '#ffffff' },
    { key: 'dimOpacity', label: 'Off cell opacity', kind: 'range', group: 'Grid', min: 0, max: 0.5, step: 0.01, default: 0.07 },
    { key: 'color', label: 'Color (bottom row)', kind: 'color', group: 'Color', default: '#22e1ff' },
    { key: 'color2', label: 'Color (top row)', kind: 'color', group: 'Color', default: '#ff2d95' },
    { key: 'glow', label: 'Glow', kind: 'range', group: 'Color', min: 0, max: 30, step: 0.5, default: 0,
      hint: 'lit cells only' },
    { key: 'gain', label: 'Gain', kind: 'range', group: 'Response', min: 0.2, max: 4, step: 0.05, default: 1.15 },
    { key: 'smoothing', label: 'Attack smoothing', kind: 'range', group: 'Response', min: 0, max: 0.95, step: 0.01, default: 0.55 },
    { key: 'decay', label: 'Decay', kind: 'range', group: 'Response', min: 0, max: 0.99, step: 0.01, default: 0.82 },
    { key: 'logScale', label: 'Log scale', kind: 'bool', group: 'Response', default: true },{ key: 'tilt', label: 'Tilt', kind: 'range', group: 'Response', min: -6, max: 6, step: 0.25, default: 0,
      hint: 'dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)' },

    { key: 'bandStart', label: 'Band start', kind: 'range', group: 'Response', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'bandEnd', label: 'Band end', kind: 'range', group: 'Response', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'quantize', label: 'Snap to cells', kind: 'bool', group: 'Response', default: true,
      hint: 'off lets the top cell fade in proportionally' },
    { key: 'peaks', label: 'Peak caps', kind: 'bool', group: 'Peaks' },
    { key: 'peakWidth', label: 'Peak width', kind: 'range', group: 'Peaks', min: 1, max: 24, step: 1, default: 4 },
    { key: 'peakFall', label: 'Peak fall', kind: 'range', group: 'Peaks', min: 0, max: 4, step: 0.05, default: 1.1 },
    { key: 'peakDelay', label: 'Peak stop delay', kind: 'range', group: 'Peaks', min: 0, max: 6, step: 0.05, default: 0 },
    { key: 'peakGap', label: 'Peak gap', kind: 'range', group: 'Peaks', min: 0, max: 40, step: 1, default: 0 },
    { key: 'peakColor', label: 'Peak color', kind: 'color', group: 'Peaks', default: '#ffffff' },
    ...geometry({ x: { default: 0.1 }, y: { default: 0.12 }, w: { default: 0.8 }, h: { default: 0.76 } }),
  ],

  rays: [
    { key: 'count', label: 'Spokes', kind: 'range', group: 'Rays', min: 8, max: 360, step: 1, default: 96 },
    { key: 'innerRadius', label: 'Inner radius', kind: 'range', group: 'Rays', min: 0, max: 0.95, step: 0.01, default: 0.25, pct: true },
    { key: 'length', label: 'Length', kind: 'range', group: 'Rays', min: 0.02, max: 1, step: 0.01, default: 0.5, pct: true },
    { key: 'strokeWidth', label: 'Thickness', kind: 'range', group: 'Rays', min: 0.001, max: 0.03, step: 0.001, default: 0.004, pct: true },
    { key: 'taper', label: 'Taper', kind: 'range', group: 'Rays', min: 0, max: 1, step: 0.01, default: 0,
      hint: '0 = uniform spokes, 1 = tapered to a point' },
    { key: 'spin', label: 'Spin', kind: 'range', group: 'Motion', min: -2, max: 2, step: 0.05, default: 0.05,
      hint: 'revolutions per second' },
    { key: 'spinBeat', label: 'Spin on beat', kind: 'range', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'arcStart', label: 'Start angle', kind: 'range', group: 'Motion', min: 0, max: 360, step: 1, default: 0 },
    { key: 'arcSpan', label: 'Arc span', kind: 'range', group: 'Motion', min: 30, max: 360, step: 1, default: 360 },
    { key: 'mirror', label: 'Mirror', kind: 'bool', group: 'Motion',
      hint: 'folds the spokes symmetric about the vertical centre' },
    { key: 'pulseAmount', label: 'Beat pulse', kind: 'range', group: 'Motion', min: 0, max: 0.9, step: 0.01, default: 0.08,
      hint: 'pulls the inner radius in on the beat' },
    ...colorProps('Color'),
    { key: 'gain', label: 'Gain', kind: 'range', group: 'Response', min: 0.2, max: 4, step: 0.05, default: 1.15 },
    { key: 'smoothing', label: 'Smoothing', kind: 'range', group: 'Response', min: 0, max: 0.95, step: 0.01, default: 0.55 },{ key: 'tilt', label: 'Tilt', kind: 'range', group: 'Response', min: -6, max: 6, step: 0.25, default: 0,
      hint: 'dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)' },

    ...geometry({ x: { default: 0.2 }, y: { default: 0.06 }, w: { default: 0.6 }, h: { default: 0.66 } }),
  ],

  terrain: [
    { key: 'terrainRows', label: 'Rows', kind: 'range', group: 'Terrain', min: 16, max: 128, step: 1, default: 72,
      hint: 'one past spectrum frame per row; clamped to the point pool' },
    { key: 'terrainBands', label: 'Bands', kind: 'range', group: 'Terrain', min: 24, max: 192, step: 4, default: 96 },
    { key: 'rowIntervalMs', label: 'Row interval', kind: 'range', group: 'Terrain', min: 10, max: 200, step: 5, default: 45 },
    { key: 'flow', label: 'Flow', kind: 'select', group: 'Terrain',
      options: [{ v: 0, t: 'Toward viewer' }, { v: 1, t: 'Away from viewer' }], default: 0,
      hint: 'which end of the grid receives the newest row' },
    { key: 'heightScale', label: 'Height', kind: 'range', group: 'Terrain', min: 0.05, max: 1.5, step: 0.01, default: 0.45 },
    { key: 'floorDb', label: 'Floor', kind: 'range', group: 'Terrain', min: -90, max: -30, step: 1, default: -70,
      hint: 'dB mapped to the floor; below it is flat' },
    { key: 'logScale', label: 'Log scale', kind: 'bool', group: 'Terrain', default: true },
    { key: 'tilt', label: 'Tilt', kind: 'range', group: 'Terrain', min: 0, max: 6, step: 0.25, default: 3,
      hint: 'dB per octave on the rows, before gain' },
    { key: 'gain', label: 'Gain', kind: 'range', group: 'Terrain', min: 0.2, max: 4, step: 0.05, default: 1.3 },
    { key: 'smoothing', label: 'Attack smoothing', kind: 'range', group: 'Terrain', min: 0, max: 0.95, step: 0.01, default: 0.5 },
    { key: 'decay', label: 'Decay', kind: 'range', group: 'Terrain', min: 0, max: 0.99, step: 0.01, default: 0.8 },
    { key: 'rowSmooth', label: 'Row smoothing', kind: 'range', group: 'Terrain', min: 0, max: 1, step: 0.01, default: 0.25,
      hint: 'blends each row with its neighbours in time, calming jitter' },
    { key: 'widthTaper', label: 'Width taper', kind: 'range', group: 'Terrain', min: 0, max: 0.9, step: 0.01, default: 0.35 },

    { key: 'pitch', label: 'Pitch', kind: 'range', group: 'Camera', min: 0, max: 85, step: 1, default: 35,
      hint: 'degrees above the horizon; clamped at 85 to avoid a top-down map' },
    { key: 'fov', label: 'Field of view', kind: 'range', group: 'Camera', min: 20, max: 110, step: 1, default: 55 },
    { key: 'distance', label: 'Distance', kind: 'range', group: 'Camera', min: 0.8, max: 5, step: 0.05, default: 2.2 },
    { key: 'lookY', label: 'Look height', kind: 'range', group: 'Camera', min: -0.5, max: 0.5, step: 0.01, default: 0.05 },
    { key: 'pitchBass', label: 'Pitch on bass', kind: 'range', group: 'Camera', min: 0, max: 30, step: 0.5, default: 4 },
    { key: 'zoomBeat', label: 'Zoom on beat', kind: 'range', group: 'Camera', min: 0, max: 0.5, step: 0.01, default: 0.06 },

    { key: 'rotateMode', label: 'Rotation', kind: 'select', group: 'Rotation',
      options: [{ v: 0, t: 'Off' }, { v: 1, t: 'Spin' }, { v: 2, t: 'Sway' }, { v: 3, t: 'Beat kick' }, { v: 4, t: 'Spin + beat' }], default: 1 },
    { key: 'yawStart', label: 'Start angle', kind: 'range', group: 'Rotation', min: 0, max: 360, step: 1, default: 0 },
    { key: 'yawSpeed', label: 'Spin speed', kind: 'range', group: 'Rotation', min: -90, max: 90, step: 1, default: 12,
      hint: 'degrees per second' },
    { key: 'swayRange', label: 'Sway range', kind: 'range', group: 'Rotation', min: 0, max: 180, step: 1, default: 40 },
    { key: 'swayPeriod', label: 'Sway period', kind: 'range', group: 'Rotation', min: 2, max: 60, step: 0.5, default: 16 },
    { key: 'yawBeat', label: 'Yaw impulse', kind: 'range', group: 'Rotation', min: 0, max: 60, step: 1, default: 12 },
    { key: 'kickDecay', label: 'Kick decay', kind: 'range', group: 'Rotation', min: 0.5, max: 0.98, step: 0.01, default: 0.9 },
    { key: 'rotateAxis', label: 'Y + roll', kind: 'select', group: 'Rotation',
      options: [{ v: 0, t: 'Y only' }, { v: 1, t: 'Y + slight roll' }], default: 0 },
    { key: 'roll', label: 'Roll', kind: 'range', group: 'Rotation', min: 0, max: 15, step: 0.5, default: 0 },
    { key: 'avoidEdgeOn', label: 'Avoid edge-on', kind: 'bool', group: 'Rotation', default: true,
      hint: 'eases through 90/270 degrees instead of dwelling where rows collapse' },

    { key: 'strokeWidth', label: 'Line width', kind: 'range', group: 'Look', min: 0.0005, max: 0.01, step: 0.0005, default: 0.0015, pct: true },
    { key: 'color', label: 'Color (far rows)', kind: 'color', group: 'Look', default: '#ffffff' },
    { key: 'color2', label: 'Color (near rows)', kind: 'color', group: 'Look', default: '#22e1ff' },
    { key: 'gradient', label: 'Gradient', kind: 'bool', group: 'Look', default: true },
    { key: 'colorBy', label: 'Gradient by', kind: 'select', group: 'Look',
      options: [{ v: 0, t: 'Depth' }, { v: 1, t: 'Height' }, { v: 2, t: 'Row age' }], default: 0,
      hint: 'needs Gradient on' },
    { key: 'depthFade', label: 'Depth fade', kind: 'range', group: 'Look', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'glow', label: 'Glow (all rows)', kind: 'range', group: 'Look', min: 0, max: 30, step: 0.5, default: 0 },
    { key: 'heightGlow', label: 'Height glow', kind: 'range', group: 'Look', min: 0, max: 30, step: 0.5, default: 0,
      hint: 'applied to the near rows and the tallest peaks only — glow is the expensive op' },
    { key: 'occlude', label: 'Occlude', kind: 'bool', group: 'Look', default: false,
      hint: 'fills each row to the floor, back to front: hidden-line removal' },
    { key: 'floorGrid', label: 'Floor grid', kind: 'bool', group: 'Look', default: false },
    { key: 'floorColor', label: 'Floor color', kind: 'color', group: 'Look', default: '#ffffff' },
    { key: 'floorOpacity', label: 'Floor opacity', kind: 'range', group: 'Look', min: 0, max: 0.5, step: 0.01, default: 0.12 },
    ...geometry({ x: { default: 0 }, y: { default: 0.05 }, w: { default: 1 }, h: { default: 0.9 } }),
  ],

beat: [
    { key: 'rings', label: 'Rings', kind: 'range', group: 'Pulse', min: 1, max: 6, step: 1, default: 2 },
    { key: 'pulseMin', label: 'Min scale', kind: 'range', group: 'Pulse', min: 0.05, max: 0.9, step: 0.01, default: 0.3 },
    { key: 'pulseMax', label: 'Max scale', kind: 'range', group: 'Pulse', min: 0.2, max: 1.5, step: 0.01, default: 1 },
    { key: 'thickness', label: 'Thickness', kind: 'range', group: 'Pulse', min: 0.005, max: 0.2, step: 0.005, default: 0.02, pct: true },
    ...colorProps('Color'),
    ...geometry({ x: { default: 0.2 }, y: { default: 0.2 }, w: { default: 0.6 }, h: { default: 0.6 }, opacity: { default: 0.8 } }),
  ],

  beat_glow: [
    { key: 'intensity', label: 'Flare intensity', kind: 'range', group: 'Glow', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'haloSize', label: 'Halo size', kind: 'range', group: 'Glow', min: 0.2, max: 4, step: 0.05, default: 1.35 },
    { key: 'haloOpacity', label: 'Halo opacity', kind: 'range', group: 'Glow', min: 0, max: 1, step: 0.01, default: 0.85 },
    { key: 'coreSize', label: 'Core size', kind: 'range', group: 'Glow', min: 0.1, max: 2, step: 0.05, default: 0.55 },
    { key: 'bloom', label: 'Bloom tightness', kind: 'range', group: 'Glow', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'follow', label: 'Follow energy', kind: 'range', group: 'Glow', min: 0, max: 1, step: 0.01, default: 1,
      hint: '0 = beat phase only, 1 = smooth bass level' },
    { key: 'color', label: 'Core color', kind: 'color', group: 'Color' },
    { key: 'haloColor', label: 'Halo color', kind: 'color', group: 'Color' },
    ...geometry({ x: { default: 0.25 }, y: { default: 0.25 }, w: { default: 0.5 }, h: { default: 0.5 }, opacity: { default: 1 } }),
  ],

  radial_line: [
    { key: 'lineMode', label: 'Source', kind: 'select', group: 'Line',
      options: [{ v: 0, t: 'Waveform' }, { v: 1, t: 'Spectrum curve' }] },
    { key: 'linePoints', label: 'Points', kind: 'range', group: 'Line', min: 24, max: 512, step: 4, default: 160 },
    { key: 'strokeWidth', label: 'Thickness', kind: 'range', group: 'Line', min: 0.001, max: 0.06, step: 0.001, default: 0.008, pct: true },
    { key: 'gain', label: 'Gain', kind: 'range', group: 'Line', min: 0.2, max: 4, step: 0.05, default: 1.2 },
    { key: 'smoothing', label: 'Smoothing', kind: 'range', group: 'Line', min: 0, max: 0.95, step: 0.01, default: 0.45 },{ key: 'tilt', label: 'Tilt', kind: 'range', group: 'Response', min: -6, max: 6, step: 0.25, default: 0,
      hint: 'dB per octave on the band values, before gain (+3 lifts the treble; 0 dB at 1 kHz)' },

    { key: 'ringRadius', label: 'Base radius', kind: 'range', group: 'Circle', min: 0, max: 0.98, step: 0.01, default: 0.6, pct: true },
    { key: 'radialLength', label: 'Wave height', kind: 'range', group: 'Circle', min: 0.01, max: 1, step: 0.01, default: 0.4, pct: true },
    { key: 'pulseAmount', label: 'Beat pulse', kind: 'range', group: 'Circle', min: 0, max: 0.9, step: 0.01, default: 0.08 },
    { key: 'mirror', label: 'Mirror', kind: 'bool', group: 'Circle',
      hint: 'folds the loop symmetric about the vertical centre' },
    { key: 'arcStart', label: 'Start angle', kind: 'range', group: 'Circle', min: 0, max: 360, step: 1, default: 0,
      hint: 'rotates the whole loop (0 = top, clockwise)' },
    { key: 'image', label: 'Center image', kind: 'image', group: 'Center', hint: 'cover art, an uploaded image, or an embedded data:image/... URL in the middle', default: '{cover}' },
    { key: 'coverScale', label: 'Center size', kind: 'range', group: 'Center', min: 0.1, max: 1, step: 0.01, default: 0.5, pct: true },
    { key: 'imageAspect', label: 'Image aspect', kind: 'range', group: 'Center', min: 0.25, max: 4, step: 0.05, default: 1,
      hint: 'width ÷ height of the center image (1 = square); the spectrum ring stays circular' },
    { key: 'centerX', label: 'Center X', kind: 'range', group: 'Center', min: 0, max: 1, step: 0.01, default: 0.5, pct: true,
      hint: 'moves the effect (rings, loops, glow) relative to the image, which stays centered' },
    { key: 'centerY', label: 'Center Y', kind: 'range', group: 'Center', min: 0, max: 1, step: 0.01, default: 0.5, pct: true,
      hint: 'moves the effect (rings, loops, glow) relative to the image, which stays centered' },
    { key: 'fit', label: 'Fit', kind: 'select', group: 'Center',
      options: [{ v: 0, t: 'Contain' }, { v: 1, t: 'Cover' }, { v: 2, t: 'Stretch' }], default: 1 },
    { key: 'cornerRadius', label: 'Border radius', kind: 'range', group: 'Center', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'circle', label: 'Circle mask', kind: 'bool', group: 'Center', default: true },
    { key: 'glow', label: 'Glow', kind: 'range', group: 'Color', min: 0, max: 30, step: 0.5, default: 0,
      hint: '0 = single crisp line; higher adds a neon bloom (which reads as extra lines)' },
    { key: 'color', label: 'Color', kind: 'color', group: 'Color', default: '#00e5ff' },
    { key: 'color2', label: 'Color 2', kind: 'color', group: 'Color', default: '#ff2d95' },
    { key: 'gradient', label: 'Gradient around loop', kind: 'bool', group: 'Color' },
    ...geometry({ x: { default: 0.3 }, y: { default: 0.2 }, w: { default: 0.4 }, h: { default: 0.6 } }),
  ],

  particles: [
    { key: 'mode', label: 'Kind', kind: 'select', group: 'Particles',
      options: [{ v: 0, t: 'Embers' }, { v: 1, t: 'Snow' }, { v: 2, t: 'Dust' }, { v: 3, t: 'Stars' }, { v: 4, t: 'Beat sparks' }, { v: 5, t: 'Tunnel' }] },
    { key: 'count', label: 'Count', kind: 'range', group: 'Particles', min: 0, max: 600, step: 1, default: 120 },
    { key: 'size', label: 'Size', kind: 'range', group: 'Particles', min: 0.002, max: 0.1, step: 0.001, default: 0.02, pct: true },
    { key: 'speed', label: 'Speed', kind: 'range', group: 'Particles', min: 0, max: 3, step: 0.05, default: 1 },
    { key: 'sway', label: 'Sway', kind: 'range', group: 'Particles', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'gravity', label: 'Gravity', kind: 'range', group: 'Particles', min: -1, max: 2, step: 0.05, default: 0 },
    { key: 'twinkle', label: 'Twinkle', kind: 'range', group: 'Particles', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'beatBoost', label: 'Beat boost', kind: 'range', group: 'Particles', min: 0, max: 2, step: 0.05, default: 0.8 },
    { key: 'shape', label: 'Shape', kind: 'select', group: 'Shape',
      options: [{ v: 0, t: 'Circles' }, { v: 1, t: 'Squares' }, { v: 2, t: 'Triangles' }, { v: 3, t: 'Lines' }, { v: 4, t: 'Hearts' }, { v: 5, t: 'Mixed' }], default: 0 },
    { key: 'sizeVar', label: 'Size variation', kind: 'range', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0,
      hint: 'spreads each particle between full size and (1 - variation) of it' },
    { key: 'rotation', label: 'Random rotation', kind: 'range', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0,
      hint: 'random orientation per particle for squares, triangles and hearts (lines follow their motion)' },
    { key: 'colorMode', label: 'Colors', kind: 'select', group: 'Color',
      options: [{ v: 0, t: 'Manual' }, { v: 1, t: 'Random' }, { v: 2, t: 'Random palette' }, { v: 3, t: 'Complementary' }, { v: 4, t: 'Cover' }], default: 0,
      hint: 'cover picks the vivid palette roles (the artwork under From cover)' },
    { key: 'color', label: 'Color', kind: 'color', group: 'Color', default: '#ffb14d' },
    { key: 'color2', label: 'Color 2', kind: 'color', group: 'Color', default: '#ff5f6d' },
    { key: 'gradient', label: 'Fade color over life', kind: 'bool', group: 'Color' },
    ...geometry({ x: { default: 0 }, y: { default: 0 }, w: { default: 1 }, h: { default: 1 } }),
  ],

  progress: [
    { key: 'color', label: 'Elapsed', kind: 'color', group: 'Bar', default: '#ffffff' },
    { key: 'color2', label: 'Elapsed 2', kind: 'color', group: 'Bar', default: '#4d7cff' },
    { key: 'gradient', label: 'Gradient', kind: 'bool', group: 'Bar' },
    { key: 'gradientAngle', label: 'Gradient angle', kind: 'range', group: 'Bar', min: 0, max: 360, step: 1, default: 90 },
    { key: 'glow', label: 'Glow', kind: 'range', group: 'Bar', min: 0, max: 30, step: 0.5 },
    { key: 'trackColor', label: 'Track color', kind: 'color', group: 'Track', default: '#ffffff' },
    { key: 'trackOpacity', label: 'Track opacity', kind: 'range', group: 'Track', min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: 'cornerRadius', label: 'Corner radius', kind: 'range', group: 'Bar', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'thumb', label: 'Thumb image', kind: 'image', group: 'Thumb', default: '0',
      hint: 'an image id for the handle (e.g. bundled 11 = Winamp posbar thumb); 0/none hides it' },
    { key: 'thumbScale', label: 'Thumb size', kind: 'range', group: 'Thumb', min: 0.5, max: 4, step: 0.1, default: 1.5,
      hint: 'handle height relative to the bar height' },
    ...geometry({ x: { default: 0.05 }, y: { default: 0.9 }, w: { default: 0.9 }, h: { default: 0.02 } }),
  ],
};

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------
export function schemaFor(type) { return SCHEMAS[type] || []; }

export function defaultsFor(type) {
  const props = {};
  schemaFor(type).forEach((p) => { if (p.default !== undefined) props[p.key] = p.default; });
  return props;
}

// A freshly added component should look good immediately.
const SEEDS = {
  background: { color: '#05060a', color2: '#221045' },
  spectrum: { color: '#22e1ff', color2: '#ff2d95', gradient: true },
  line: { color: '#7cffcb', color2: '#3d5afe' },
  meter: { color: '#ffd166', color2: '#ff2d95' },
  beat: { color: '#ff6ec7' },
  beat_glow: { color: '#ffffff', haloColor: '#7c5cff' },
  cover: { color: '#22e1ff', color2: '#ff2d95', haloColor: '#7c5cff', glow: 14 },
  orb: { color: '#7dffd4', color2: '#00e5ff', haloColor: '#00e5ff', glow: 16, circle: true },
  progress: { color: '#ffffff', color2: '#4d7cff', trackColor: '#ffffff' },
  radial_line: { color: '#00e5ff', color2: '#ff2d95' },
  dotmatrix: { color: '#22e1ff', color2: '#ff2d95', dimColor: '#ffffff' },
  rays: { color: '#00e5ff', color2: '#ff2d95' },
  terrain: { color: '#ffffff', color2: '#22e1ff', gradient: true },
  particles: { color: '#ffb14d', color2: '#ff5f6d' },
  text: { color: '#ffffff', shadow: true },
  shape: { color: '#ffffff', color2: '#3d5afe' },
  image: {},
};

export function createComponent(type) {
  return { type, props: Object.assign(defaultsFor(type), SEEDS[type] || {}) };
}

export function clone(o) { return JSON.parse(JSON.stringify(o)); }


// ---------------------------------------------------------------------------
// Normalisation + persistence
// ---------------------------------------------------------------------------
export function emptyPreset(name) {
  return {
    version: SCHEMA_VERSION,
    name: name || 'Untitled',
    palette: DEFAULT_PALETTE_NAME,
    components: [createComponent('background'), createComponent('spectrum'), createComponent('text')],
  };
}

/** Fills in schema defaults so partial or older presets still render. */
export function normalizePreset(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const out = {
    version: SCHEMA_VERSION,
    name: typeof p.name === 'string' && p.name ? p.name : 'Untitled',
    author: typeof p.author === 'string' ? p.author : 'user',
    palette: typeof p.palette === 'string' && p.palette ? p.palette : DEFAULT_PALETTE_NAME,
    components: [],
  };
  // Optional embedded palette. When present it REPLACES the named palette, so
  // a preset can be shared without shipping the palette it was authored with.
  // `dynamic` is never stored: it always follows the current artwork.
  if (p.roles && typeof p.roles === 'object') {
    const roles = {};
    for (const role of PALETTE_ROLES) {
      const hex = p.roles[role];
      if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex.trim())) roles[role] = hex.trim();
    }
    if (Object.keys(roles).length) out.roles = roles;
  }
  // Optional embedded image table. Images live here — NEVER inside component
  // props — so deleting a component can never drop the art, and saving never
  // loses images the scene no longer references. Components point at entries
  // by id ("10000"). The device never stores decoded bitmaps: every host
  // decodes the table from the preset JSON at load.
  // Older pastes carried raw data URLs in props; they are upgraded into the
  // table here so every downstream consumer only ever sees the table form.
  const usedImageIds = new Set();
  if (Array.isArray(p.images)) {
    const table = [];
    for (const e of p.images) {
      if (!e || typeof e !== 'object') continue;
      const id = Number(e.id);
      const url = e.url;
      if (!Number.isInteger(id) || id < EMBEDDED_IMAGE_BASE) continue;
      if (typeof url !== 'string' || !url.startsWith('data:image/')) continue;
      if (table.length >= EMBEDDED_IMAGE_MAX || usedImageIds.has(id)) continue;
      usedImageIds.add(id);
      table.push({ id, url });
    }
    if (table.length) out.images = table;
  }
  const comps = Array.isArray(p.components) ? p.components : [];
  comps.forEach((c) => {
    if (!c || !SCHEMAS[c.type]) return;
    out.components.push({ type: c.type, props: Object.assign(defaultsFor(c.type), c.props || {}) });
  });
  // Upgrade: stray data URLs left in props (pre-table pastes) move into the
  // table, so the stored form is always table-only. Deleting the component
  // that carried one can no longer orphan art the preset still wants.
  {
    const table = out.images || (out.images = []);
    const byUrl = new Map(table.map((e) => [e.url, e.id]));
    let next = EMBEDDED_IMAGE_BASE;
    for (const comp of out.components) {
      if (!comp.props) continue;
      for (const key of Object.keys(comp.props)) {
        const v = comp.props[key];
        if (typeof v !== 'string' || !v.startsWith('data:image/')) continue;
        let id = byUrl.get(v);
        if (id === undefined) {
          if (table.length >= EMBEDDED_IMAGE_MAX) continue;
          while (usedImageIds.has(next)) next++;
          id = next++;
          usedImageIds.add(id);
          byUrl.set(v, id);
          table.push({ id, url: v });
        }
        comp.props[key] = String(id);
      }
    }
    if (!table.length) delete out.images;
  }
  if (!out.components.length) out.components.push(createComponent('background'));
  return out;
}

export function toJson(preset) { return JSON.stringify(normalizePreset(preset), null, 2); }

export function fromJson(text) { return normalizePreset(JSON.parse(text)); }

// --- embedded base64 images -------------------------------------------------
// Images live in a top-level `images` table — [{ id, url }] with data:image/
// URLs — NEVER inside component props, so deleting a component can never
// drop the art. Components reference entries by id ("10000"). The engine
// only understands numeric ids and {cover} (vze.cpp resolveImageId), so each
// host decodes the table at load and registers every entry under its id.
// The stored JSON keeps the table, which is what makes the preset portable:
// paste it into any Studio and the art comes with it. No host ever stores
// decoded bitmaps; art is always decoded from the preset JSON at load.
//
// IDs 10000+ never collide with real images (cover=1, uploads from 2,
// bundled 10/11). Cap of 8: base64 is ~33% overhead and TV RAM is finite.
export const EMBEDDED_IMAGE_BASE = 10000;
export const EMBEDDED_IMAGE_MAX = 8;

/**
 * Pure id-mapping step (no DOM, no decoding — unit-testable). Normalising
 * upgrades stray prop data URLs into the table, so this just reads it back:
 * a clone of the preset plus the [{ id, url }] list the host decodes.
 */
export function extractEmbeddedImages(preset) {
  const norm = normalizePreset(preset);
  const images = Array.isArray(norm.images) ? norm.images.slice() : [];
  return { preset: norm, images };
}

// --- default presets --------------------------------------------------------
// The defaults live as plain files in presets/default/ (plus index.json) —
// never embedded in code. tools/generate-presets.mjs refreshes the generated
// ones; hand-authored files are edited by hand or re-exported from the Studio.
export async function loadBundledPresets(base = 'presets/') {
  const out = [];
  try {
    const res = await fetch(base + 'default/index.json', { cache: 'no-store' });
    if (!res.ok) return out;
    const files = await res.json();
    if (!Array.isArray(files)) return out;
    for (const file of files) {
      if (typeof file !== 'string' || !/^[\w.-]+\.json$/.test(file)) continue;
      try {
        const r = await fetch(base + 'default/' + file, { cache: 'no-store' });
        if (r.ok) out.push(normalizePreset(await r.json()));
      } catch (_) { /* one bad file must not sink the list */ }
    }
  } catch (_) { /* unreachable backend: caller falls back */ }
  return out;
}

// --- user presets live on the TV only ---------------------------------------
// There is intentionally no browser storage here: the device is the only
// store, so a stale browser copy can never shadow a shipped preset again.

export function downloadJson(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
