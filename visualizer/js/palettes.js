// Colour palettes.
//
// A palette is a named set of ROLES (bg, surface, primary, secondary, accent,
// text). A preset stores the palette name; the host publishes every role as an
// engine variable, and component colours bind to roles with `{primary}`-style
// tokens:
//
//   { "palette": "Ocean",
//     "components": [ { "type": "spectrum",
//                       "props": { "color": "{primary}", "color2": "{secondary}" } } ] }
//
// Switching the palette re-themes the whole preset live, and the special
// "From cover" palette derives its roles from the current track's artwork.

export const PALETTE_ROLES = ['bg', 'surface', 'primary', 'secondary', 'accent', 'text'];

/**
 * The 7th, always-published role. Unlike the others it is NOT part of a
 * palette: `dynamic` follows the current artwork (dominant colour darkened to
 * ~30% lightness) no matter which palette the preset names, so a preset can mix
 * fixed brand colours with an artwork-tinted backdrop.
 */
export const DYNAMIC_ROLE = 'dynamic';

// The role list used by the "auto" tokens; kept in sync with the engine docs.
export const ROLE_HINTS = {
  bg: 'backdrop',
  surface: 'panels / cards',
  primary: 'main accent',
  secondary: 'second accent',
  accent: 'highlight',
  text: 'type & icons',
  dynamic: 'artwork tint (always on)',
};

export const FROM_COVER = 'From cover';

const P = (name, bg, surface, primary, secondary, accent, text) => ({
  name,
  roles: { bg, surface, primary, secondary, accent, text },
});

/** 14 ready-made palettes. `From cover` is added dynamically, not here. */
export const PALETTES = [
  P('Neon',       '#05060a', '#131a2a', '#22e1ff', '#ff2d95', '#7cffcb', '#ffffff'),
  P('Sunset',     '#1a0b12', '#2c1322', '#ff8a3d', '#ff2d6f', '#ffd166', '#fff4e6'),
  P('Ocean',      '#04121f', '#0c2436', '#35c6ff', '#1f6feb', '#7dffd4', '#eaf6ff'),
  P('Forest',     '#06110b', '#12261a', '#4ade80', '#15803d', '#fde047', '#ecfdf5'),
  P('Mono',       '#0a0a0a', '#1a1a1a', '#f5f5f5', '#9ca3af', '#ffffff', '#ffffff'),
  P('Candy',      '#1a0f1e', '#2c1836', '#ff6ec7', '#8b5cf6', '#67e8f9', '#fff0fb'),
  P('Retro',      '#1b1436', '#2a2050', '#ff5f6d', '#ffc371', '#38bdf8', '#fef3c7'),
  P('Miami',      '#0b0327', '#1a0b3d', '#00f5d4', '#f15bb5', '#fee440', '#ffffff'),
  P('Gold',       '#120d04', '#241a08', '#ffd166', '#f59e0b', '#fff3c4', '#fffaf0'),
  P('Ice',        '#05121a', '#0e2230', '#a5f3fc', '#38bdf8', '#ffffff', '#f0fdff'),
  P('Ember',      '#150704', '#2a0f08', '#ff6b35', '#d92027', '#ffd166', '#fff1e6'),
  P('Cyberpunk',  '#0a0118', '#16022e', '#f9f002', '#ff003c', '#00e5ff', '#ffffff'),
  P('Pastel',     '#1a1a2e', '#25254a', '#a78bfa', '#f0abfc', '#7dd3fc', '#fdf4ff'),
  P('Deep Space', '#02010a', '#0b0a1f', '#6d5dfc', '#00c2ff', '#ff4d9d', '#e8e6ff'),
];

export const DEFAULT_PALETTE_NAME = PALETTES[0].name;

export function paletteNames() { return PALETTES.map((p) => p.name); }

export function paletteByName(name) {
  return PALETTES.find((p) => p.name === name) || PALETTES[0];
}

/** Neutral `dynamic` used before any artwork has loaded. */
export const FALLBACK_DYNAMIC = '#1f1f1f';

export function fallbackRoles() {
  return Object.assign({ [DYNAMIC_ROLE]: FALLBACK_DYNAMIC }, PALETTES[0].roles);
}

/** Patches the always-on `dynamic` role into a palette's role set. */
export function withDynamic(roles, dynamic) {
  return Object.assign({}, roles, { [DYNAMIC_ROLE]: dynamic || FALLBACK_DYNAMIC });
}

/**
 * Resolves the role set a preset should render with: its embedded `roles`
 * block when it has one (otherwise the palette it names), always with the
 * artwork-derived `dynamic` role patched in.
 */
export function rolesForPreset(preset, coverRoles) {
  const dyn = (coverRoles && coverRoles[DYNAMIC_ROLE]) || FALLBACK_DYNAMIC;
  const name = preset && preset.palette;
  // Named palette first, then From cover, then whatever the preset embeds — so
  // a partial `roles` block overrides just the roles it names.
  const base = name === FROM_COVER && coverRoles
    ? Object.assign({}, fallbackRoles(), coverRoles)
    : paletteByName(name).roles;
  const embedded = preset && preset.roles;
  return withDynamic(embedded && Object.keys(embedded).length
    ? Object.assign({}, base, embedded)
    : base, dyn);
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

export function shade(hex, amount) {
  return amount >= 0 ? mixHex(hex, '#ffffff', amount) : mixHex(hex, '#000000', -amount);
}

// ---------------------------------------------------------------------------
// Dominant-colour extraction from the cover art
// ---------------------------------------------------------------------------

/** Buckets pixels into a coarse RGB histogram and returns the top clusters. */
function topClusters(data, count) {
  const map = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;                 // skip transparent pixels
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let c = map.get(key);
    if (!c) { c = { n: 0, r: 0, g: 0, b: 0 }; map.set(key, c); }
    c.n++; c.r += r; c.g += g; c.b += b;
  }
  return Array.from(map.values())
    .map((c) => ({ n: c.n, r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((c) => ({ hex: rgbToHex(c.r, c.g, c.b), r: c.r, g: c.g, b: c.b, n: c.n }));
}

function saturation(c) {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max <= 0 ? 0 : (max - min) / max;
}

function hue(c) {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === c.r) h = ((c.g - c.b) / d) % 6;
  else if (max === c.g) h = (c.b - c.r) / d + 2;
  else h = (c.r - c.g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Derives the six roles from cover art. Pure colour maths over a downsampled
 * bitmap; returns null when there is no DOM/2D context to sample with.
 */
export function extractRolesFromBitmap(bitmap, size = 48) {
  if (typeof document === 'undefined' || !bitmap) return null;
  let ctx;
  try {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;
    const clusters = topClusters(pixels, 8);
    if (clusters.length < 2) return null;

    // Vibrant = saturated and reasonably bright.
    const score = (c) => saturation(c) * (0.35 + luminance(c.hex));
    const byVib = clusters.slice().sort((a, b) => score(b) - score(a));
    const primary = byVib[0];
    const secondary = byVib.find((c) => hueDist(hue(c), hue(primary)) > 25) || byVib[1] || primary;
    const accent = byVib.find((c) => c !== primary && c !== secondary) || secondary;

    // The `dynamic` role: the most common (dominant) cluster dropped to ~30%
    // lightness — a usable backdrop tint that never outshines white type.
    const dominant = clusters[0];
    const dynamic = shadeToLightness(dominant.hex, 0.3);

    // Darkest cluster becomes the backdrop; average becomes the surface.
    const byLum = clusters.slice().sort((a, b) => luminance(a.hex) - luminance(b.hex));
    const bg = shade(byLum[0].hex, -0.62);
    const surface = shade(byLum[Math.min(1, byLum.length - 1)].hex, -0.32);
    const text = luminance(primary.hex) > 0.62 ? '#0b0b0f' : '#ffffff';

    return {
      bg,
      surface,
      primary: primary.hex,
      secondary: secondary.hex,
      accent: accent.hex,
      text,
      [DYNAMIC_ROLE]: dynamic,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Darkens (or lightens) a colour until it sits at roughly `target` relative
 * luminance, keeping its hue and saturation. Used for the artwork-derived
 * `dynamic` role: the dominant colour pulled down to 25-35% lightness.
 */
export function shadeToLightness(hex, target) {
  const base = hexToRgb(hex);
  const l0 = luminance(hex);
  if (Math.abs(l0 - target) < 0.01) return rgbToHex(base.r, base.g, base.b);
  // Toward black when too bright, toward white when too dark. Mixing (rather
  // than scaling) means pure black can still be lifted, which scaling cannot.
  const darken = l0 > target;
  const to = darken ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  let lo = 0, hi = 1, best = 0;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const l = luminance(rgbToHex(base.r + (to.r - base.r) * t,
                                 base.g + (to.g - base.g) * t,
                                 base.b + (to.b - base.b) * t));
    best = t;
    if (Math.abs(l - target) < 0.004) break;
    // Keep halving the side that is still on the wrong side of the target.
    if (darken ? l > target : l < target) lo = t; else hi = t;
  }
  return rgbToHex(base.r + (to.r - base.r) * best,
                  base.g + (to.g - base.g) * best,
                  base.b + (to.b - base.b) * best);
}
