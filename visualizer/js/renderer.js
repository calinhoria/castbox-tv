// Canvas2D backend for the engine's draw-command stream.
//
// This file is intentionally dumb: it maps Op codes to canvas calls and knows
// nothing about presets or audio. The Android port implements the same switch
// with android.graphics.Canvas — that symmetry is the whole point.
import { OP, F } from './engine.js';

// Re-exported so backends (and tests) only need to import the renderer.
export { OP, F };

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** rgba(0..1 channels) -> a CSS colour, with an extra alpha multiplier. */
function rgba(r, g, b, a, alphaMul) {
  const to255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const mul = alphaMul === undefined ? 1 : alphaMul;
  const alpha = Math.max(0, Math.min(1, a * mul));
  return 'rgba(' + to255(r) + ',' + to255(g) + ',' + to255(b) + ',' + alpha.toFixed(3) + ')';
}

/** Rounded-rect path; falls back to ctx.rect for square corners. */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (rr <= 0.5) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Gradient spanning the rect along `angleDeg`, where
 * 0 = bottom->top, 90 = left->right, 180 = top->bottom, 270 = right->left.
 */
function gradientFor(ctx, x, y, w, h, angleDeg) {
  const rad = (angleDeg || 0) * Math.PI / 180;
  const ux = Math.sin(rad);
  const uy = -Math.cos(rad);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = (Math.abs(w * ux) + Math.abs(h * uy)) / 2;
  return ctx.createLinearGradient(cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half);
}

/**
 * Separable gaussian blur via 3 sliding-window box passes (a classic
 * gaussian approximation). Runs on a small downscaled copy, so it stays cheap
 * per frame. Exported for unit tests.
 */
export function boxBlurImageData(data, w, h, radius) {
  const r = Math.max(1, Math.min(32, Math.round(radius) || 1));
  const div = 2 * r + 1;
  const tmp = new Float32Array(Math.max(w, h) * 4);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let aR = 0, aG = 0, aB = 0, aA = 0;
    for (let i = -r; i <= r; i++) {
      const o = row + Math.min(w - 1, Math.max(0, i)) * 4;
      aR += data[o]; aG += data[o + 1]; aB += data[o + 2]; aA += data[o + 3];
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      tmp[x * 4] = aR / div; tmp[x * 4 + 1] = aG / div;
      tmp[x * 4 + 2] = aB / div; tmp[x * 4 + 3] = aA / div;
      const oOut = row + Math.max(0, x - r) * 4;
      const oIn = row + Math.min(w - 1, x + r + 1) * 4;
      aR += data[oIn] - data[oOut]; aG += data[oIn + 1] - data[oOut + 1];
      aB += data[oIn + 2] - data[oOut + 2]; aA += data[oIn + 3] - data[oOut + 3];
    }
    for (let x = 0; x < w * 4; x++) data[row + x] = tmp[x];
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let aR = 0, aG = 0, aB = 0, aA = 0;
    for (let i = -r; i <= r; i++) {
      const o = Math.min(h - 1, Math.max(0, i)) * w * 4 + x * 4;
      aR += data[o]; aG += data[o + 1]; aB += data[o + 2]; aA += data[o + 3];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w * 4 + x * 4;
      tmp[y * 4] = aR / div; tmp[y * 4 + 1] = aG / div;
      tmp[y * 4 + 2] = aB / div; tmp[y * 4 + 3] = aA / div;
      const oOut = Math.max(0, y - r) * w * 4 + x * 4;
      const oIn = Math.min(h - 1, y + r + 1) * w * 4 + x * 4;
      aR += data[oIn] - data[oOut]; aG += data[oIn + 1] - data[oOut + 1];
      aB += data[oIn + 2] - data[oOut + 2]; aA += data[oIn + 3] - data[oOut + 3];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w * 4 + x * 4;
      data[o] = tmp[y * 4]; data[o + 1] = tmp[y * 4 + 1];
      data[o + 2] = tmp[y * 4 + 2]; data[o + 3] = tmp[y * 4 + 3];
    }
  }
}

export function gaussianBlurImageData(data, w, h, radius) {
  for (let k = 0; k < 3; k++) boxBlurImageData(data, w, h, radius);
}

export class CanvasBackend {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.images = new Map();          // id -> ImageBitmap | HTMLImageElement
    this.blurCache = new Map();       // image -> {key, canvas}
    try {
      // Native canvas blur (same engine as CSS `filter: blur()`, which is
      // what music players use for their backdrops). Absent on older Safari,
      // where the gaussian fallback below takes over.
      this.filterOK = typeof this.ctx.filter === 'string';
    } catch (_) { this.filterOK = false; }
    this.lastStats = { commands: 0, texts: 0 };
  }

  registerImage(id, bitmap) {
    const prev = this.images.get(id);
    if (prev && prev !== bitmap) this.blurCache.delete(prev);
    this.images.set(id, bitmap);
    const w = bitmap.width || bitmap.naturalWidth || 0;
    const h = bitmap.height || bitmap.naturalHeight || 0;
    this.engine.setImage(id, w, h);
    return { id, width: w, height: h };
  }

  clearImages() { this.images.clear(); this.blurCache.clear(); this.engine.clearImages(); }

  /**
   * Returns a pre-blurred copy of the image for the blur pass. Strategy:
   * native ctx.filter (true GPU gaussian) where the browser supports it,
   * otherwise a downscaled copy smoothed with a real gaussian (3 box
   * passes) — never the blocky single-jump upscale. Without a DOM (unit
   * tests) there is no offscreen canvas, so the caller draws direct.
   */
  blurredSource(img, blur) {
    const key = Math.round(blur);
    let e = this.blurCache.get(img);
    if (!e || e.key !== key) {
      e = { key, canvas: this.makeBlurred(img, blur) };
      if (this.blurCache.size > 8) this.blurCache.clear();
      this.blurCache.set(img, e);
    }
    return (e && e.canvas) || img;
  }

  makeBlurred(img, blur) {
    if (typeof document === 'undefined') return null;
    const iw = img.width || img.naturalWidth || 0;
    const ih = img.height || img.naturalHeight || 0;
    if (iw <= 0 || ih <= 0) return null;
    // Step down progressively (each halving is smooth bilinear), ending at a
    // small working copy; then a real gaussian on top.
    const target = 320;
    const scale = Math.min(1, target / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * scale));
    c.height = Math.max(1, Math.round(ih * scale));
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    let src = img, sw = iw, sh = ih;
    const steps = [];
    while (Math.max(sw, sh) / 2 >= Math.max(c.width, c.height) && steps.length < 6) {
      sw = Math.max(1, Math.round(sw / 2));
      sh = Math.max(1, Math.round(sh / 2));
      const t = document.createElement('canvas');
      t.width = sw; t.height = sh;
      t.getContext('2d').drawImage(src, 0, 0, sw, sh);
      steps.push(t);
      src = t;
    }
    g.drawImage(src, 0, 0, c.width, c.height);
    try {
      const id = g.getImageData(0, 0, c.width, c.height);
      const radius = Math.max(1, Math.min(24, Math.round(blur * (c.width / iw) / 2)));
      gaussianBlurImageData(id.data, c.width, c.height, radius);
      g.putImageData(id, 0, 0);
    } catch (_) {
      // CORS-tainted canvas (remote URL art without CORS): pixel access
      // throws, the progressive downscale alone still softens it.
    }
    return c;
  }

  /** Executes the commands produced by the engine's last frame(). */
  render() {
    const M = this.engine;
    const { count, stride, data } = M.commands();
    const points = M.points();
    const pool = M.m.HEAPU8;
    const poolBase = M.m._vze_pool_data();
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let saved = 0;
    let texts = 0;

    for (let i = 0; i < count; i++) {
      const o = i * stride;
      const op = data[o + F.OP];
      const x = data[o + F.X], y = data[o + F.Y], w = data[o + F.W], h = data[o + F.H];
      const r = data[o + F.R], g = data[o + F.G], b = data[o + F.B], a = data[o + F.A];
      const r2 = data[o + F.R2], g2 = data[o + F.G2], b2 = data[o + F.B2], a2 = data[o + F.A2];
      const p0 = data[o + F.P0], p1 = data[o + F.P1], p2 = data[o + F.P2];
      const p3 = data[o + F.P3], p4 = data[o + F.P4], p5 = data[o + F.P5];
      const role = data[o + F.ROLE];

      switch (op) {
        case OP.CLEAR:
          ctx.fillStyle = rgba(r, g, b, a, 1);
          ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
          break;

        case OP.RECT: {
          roundRect(ctx, x, y, w, h, p0);
          if (p1 > 0) {
            ctx.lineWidth = p1;
            ctx.strokeStyle = rgba(r, g, b, a, 1);
            ctx.stroke();
          } else {
            ctx.fillStyle = rgba(r, g, b, a, 1);
            ctx.fill();
          }
          break;
        }

        case OP.GRADIENT_RECT: {
          const gr = gradientFor(ctx, x, y, w, h, p0);
          gr.addColorStop(0, rgba(r, g, b, a, 1));
          gr.addColorStop(1, rgba(r2, g2, b2, a2, 1));
          roundRect(ctx, x, y, w, h, p1);
          ctx.fillStyle = gr;
          ctx.fill();
          break;
        }

        case OP.LINE:
          ctx.beginPath();
          ctx.lineWidth = Math.max(0.5, p0);
          ctx.lineCap = 'round';
          ctx.strokeStyle = rgba(r, g, b, a, 1);
          ctx.moveTo(x, y);
          ctx.lineTo(w, h);
          ctx.stroke();
          break;

        case OP.GRADIENT_LINE: {
          // Stroked polyline from the point pool (same layout as a stroked
          // OP_POLYGON) with a linear gradient across its bounding box.
          const n = p0 | 0;
          if (n < 2) break;
          const off = (p1 | 0) * 2;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          const capped = Math.min(n, 4096);
          for (let k = 0; k < capped; k++) {
            const px = points[off + k * 2], py = points[off + k * 2 + 1];
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
          }
          const gr = gradientFor(ctx, minX, minY,
            Math.max(1, maxX - minX), Math.max(1, maxY - minY), p3);
          gr.addColorStop(0, rgba(r, g, b, a, 1));
          gr.addColorStop(1, rgba(r2, g2, b2, a2, 1));
          ctx.beginPath();
          ctx.lineWidth = Math.max(0.5, p2);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = gr;
          for (let k = 0; k < capped; k++) {
            const px = points[off + k * 2], py = points[off + k * 2 + 1];
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        }

        case OP.CIRCLE:
          ctx.beginPath();
          ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
          if (p0 > 0) {
            ctx.lineWidth = p0;
            ctx.strokeStyle = rgba(r, g, b, a, 1);
            ctx.stroke();
          } else {
            ctx.fillStyle = rgba(r, g, b, a, 1);
            ctx.fill();
          }
          break;

        case OP.ARC: {
          const start = (p0 * Math.PI) / 180;
          const sweep = (p1 * Math.PI) / 180;
          ctx.beginPath();
          ctx.lineWidth = Math.max(0.5, p2);
          ctx.lineCap = p3 >= 0.5 ? 'round' : 'butt';
          ctx.strokeStyle = rgba(r, g, b, a, 1);
          ctx.ellipse(x, y, Math.abs(w), Math.abs(h), 0, start, start + sweep);
          ctx.stroke();
          break;
        }

        case OP.RADIAL_GLOW: {
          // Soft orb used by the beat_glow component. p0 = solid core fraction,
          // p1 = where the falloff starts, p2 = falloff tightness, p3 = alpha
          // scale. Additive so overlapping glows bloom instead of muddying.
          const cx = x + w / 2;
          const cy = y + h / 2;
          const rad = Math.max(1, Math.min(w, h) / 2);
          const scale = Math.max(0, Math.min(1, p3));
          const grd = ctx.createRadialGradient(cx, cy, rad * p0 * (1 - scale * 0.2),
            cx, cy, rad);
          grd.addColorStop(0, rgba(r, g, b, a, scale));
          grd.addColorStop(Math.max(0.01, p0), rgba(r, g, b, a, scale));
          grd.addColorStop(Math.max(0.02, p1), rgba(r, g, b, a, scale * (0.55 - 0.25 * p2)));
          grd.addColorStop(1, rgba(r, g, b, a, 0));
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }

        case OP.POLYGON: {
          const n = p0 | 0;
          if (n < 2) break;
          const off = (p1 | 0) * 2;
          for (let k = 0; k < n; k++) {
            const px = points[off + k * 2];
            const py = points[off + k * 2 + 1];
            if (k === 0) ctx.beginPath(), ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          if (p2 > 0) {
            // Open stroke: never closePath here, or open curves gain a
            // straight chord from their end back to their start.
            ctx.lineWidth = p2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.strokeStyle = rgba(r, g, b, a, 1);
            ctx.stroke();
          } else {
            ctx.closePath();
            ctx.fillStyle = rgba(r, g, b, a, 1);
            ctx.fill();
          }
          break;
        }

        case OP.CLIP_PUSH:
          ctx.save();
          roundRect(ctx, x, y, w, h, p0);
          ctx.clip();
          saved++;
          break;

        case OP.CLIP_POP:
          if (saved > 0) { ctx.restore(); saved--; }
          break;

        case OP.IMAGE: {
          const img = this.images.get(data[o + F.IMG] | 0);
          if (img) {
            const iw = img.width || img.naturalWidth;
            const ih = img.height || img.naturalHeight;
            const blur = Math.max(0, p3);
            ctx.save();
            ctx.globalAlpha = a;
            if (role >= 0.5) {
              // circle mask: inscribed circle, so non-square boxes still
              // mask a true circle instead of an oval
              const cr = Math.min(w, h) / 2;
              ctx.beginPath();
              ctx.arc(x + w / 2, y + h / 2, Math.max(0.5, cr), 0, Math.PI * 2);
              ctx.clip();
            } else {
              roundRect(ctx, x, y, w, h, p1);
              ctx.clip();
            }
            const fit = p0 | 0;
            // Overscan by the blur radius so the softened edges still fill the
            // clip instead of leaving a dark fringe.
            const pad = blur > 0 ? blur : 0;
            const tw = w + pad * 2, th = h + pad * 2;
            let dw = tw, dh = th;
            if (fit !== 2 && iw > 0 && ih > 0) {
              const s = fit === 1 ? Math.max(tw / iw, th / ih) : Math.min(tw / iw, th / ih);
              dw = iw * s;
              dh = ih * s;
            }
            const flipX = p4 >= 0.5, flipY = p5 >= 0.5;
            const drawSrc = (src) => {
              if (flipX || flipY) {
                ctx.translate(x + w / 2, y + h / 2);
                ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
                ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
              } else {
                ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
              }
            };
            if (blur > 0.5) {
              if (this.filterOK) {
                // True GPU gaussian, same as a CSS backdrop blur.
                ctx.filter = 'blur(' + Math.min(100, blur).toFixed(1) + 'px)';
                drawSrc(img);
                ctx.filter = 'none';
              } else {
                // No native blur (older Safari): pre-blurred copy with a real
                // gaussian baked in — never the blocky single-jump upscale.
                drawSrc(this.blurredSource(img, blur));
              }
            } else {
              drawSrc(img);
            }
            if (p2 > 0) {   // tint overlay
              ctx.globalCompositeOperation = 'source-atop';
              ctx.globalAlpha = p2;
              ctx.fillStyle = rgba(r, g, b, 1, 1);
              ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
            }
            ctx.restore();
          }
          break;
        }

        case OP.TEXT: {
          const len = data[o + F.STRLEN] | 0;
          if (len <= 0) break;
          const text = M.m.UTF8ToString(poolBase + (data[o + F.STROFF] | 0), len);
          const size = Math.max(1, p0);
          const align = p1 | 0;
          const valign = p2 | 0;
          const weight = p3 >= 700 ? 700 : (p3 >= 400 ? 400 : 300);
          const spacing = p4;
          const blur = p5;

          // Optional per-component font family (pool offset + length in R2/G2).
          const fOff = data[o + F.R2] | 0;
          const fLen = data[o + F.G2] | 0;
          const family = fLen > 0
            ? '"' + M.m.UTF8ToString(poolBase + fOff, fLen) + '", ' + FONT_STACK
            : FONT_STACK;

          ctx.font = weight + ' ' + size.toFixed(1) + 'px ' + family;
          try { ctx.letterSpacing = spacing > 0 ? spacing.toFixed(1) + 'px' : '0px'; } catch (_) {}
          ctx.textAlign = align === 0 ? 'left' : (align === 2 ? 'right' : 'center');
          ctx.textBaseline = valign === 0 ? 'top' : (valign === 2 ? 'bottom' : 'middle');
          ctx.fillStyle = rgba(r, g, b, a, 1);

          if (role >= 0.5) {
            if (blur > 0) ctx.filter = 'blur(' + Math.min(40, blur * 0.35).toFixed(1) + 'px)';
            ctx.fillText(text, x, y);
            ctx.filter = 'none';
          } else {
            if (blur > 0) {
              ctx.shadowBlur = blur;
              ctx.shadowColor = rgba(r, g, b, 1, 1);
            }
            ctx.fillText(text, x, y);
            ctx.shadowBlur = 0;
          }

          // Feed the measured width back so marquee/auto-fit converge.
          const measured = ctx.measureText(text).width;
          if (data[o + F.STRID] >= 0) M.reportMeasure(data[o + F.STRID] | 0, measured);
          texts++;
          break;
        }

        default:
          break;
      }
    }
    this.lastStats.commands = count;
    this.lastStats.texts = texts;
    while (saved-- > 0) ctx.restore();
  }
}
