package com.castboxtv.app.viz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.os.SystemClock
import android.util.AttributeSet
import android.view.View
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Native app-visualization renderer (phone/TV screen, NOT the 32x32 matrix).
 * Mirrors the simulator playground lite renderer so presets look the same in
 * both places: feedback warp (zoom/rot/decay from the .milk params) +
 * audio-reactive waveform, orbs and bass ring from
 * AudioSpectrum / AudioWaveform / AudioLevels.
 *
 * Colors come either from the preset hue rotation or from the cover palette
 * ([CoverPalette]) when [useCoverPalette] is on.
 */
class AppVizView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private var preset: AppVizPresets.Preset = AppVizPresets.Preset("boot")
    private var presetIndex: Int = 0
    private var useCoverPalette: Boolean = false

    private var prev: Bitmap? = null
    private var prevCanvas: Canvas? = null
    private var backingW = 0
    private var backingH = 0

    private val bitmapPaint = Paint().apply { isAntiAlias = true; isFilterBitmap = true }
    private val fadePaint = Paint().apply { style = Paint.Style.FILL; color = Color.argb(15, 0, 0, 0) }
    private val linePaint = Paint().apply {
        style = Paint.Style.STROKE; isAntiAlias = true; strokeCap = Paint.Cap.ROUND
    }
    private val fillPaint = Paint().apply { style = Paint.Style.FILL; isAntiAlias = true }
    private val warpMatrix = Matrix()
    private val bootMs = SystemClock.uptimeMillis()

    fun setPreset(p: AppVizPresets.Preset, index: Int) {
        if (preset.name == p.name && presetIndex == index) return
        preset = p
        presetIndex = index
        android.util.Log.d(TAG, "preset -> #$index ${p.name}")
        // hard cut so the switch is immediately visible (no old-trail blend)
        prev?.eraseColor(Color.BLACK)
    }

    fun setUseCoverPalette(use: Boolean) {
        useCoverPalette = use
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        // Half-res backing buffer: cheap software feedback, upscaled on draw.
        val scale = MAX_BACKING / maxOf(w, h).toFloat().coerceAtLeast(1f)
        backingW = maxOf(160, (w * min(1f, scale)).toInt())
        backingH = maxOf(90, (h * min(1f, scale)).toInt())
        prev?.recycle()
        prev = Bitmap.createBitmap(backingW, backingH, Bitmap.Config.ARGB_8888).also {
            it.eraseColor(Color.BLACK)
            prevCanvas = Canvas(it)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val buf = prev ?: return
        val pc = prevCanvas ?: return
        val w = backingW.toFloat()
        val h = backingH.toFloat()

        val rawSpectrum = try { AudioSpectrum.get() } catch (_: Exception) { FloatArray(11) }
        val rawWave = try { AudioWaveform.get(32) } catch (_: Exception) { FloatArray(32) }
        val t = (SystemClock.uptimeMillis() - bootMs) / 1000f
        // Idle fallback: with no audio playing every preset looks dead-flat.
        // Synthesize drive from time so switches stay obvious (mock-data mode).
        val silent = avg(rawSpectrum, 0, rawSpectrum.size) < 0.04f &&
            rawWave.all { kotlin.math.abs(it) < 0.02f }
        val spectrum = if (silent) {
            FloatArray(rawSpectrum.size) { i -> 0.3f + 0.25f * sin(t * (0.8f + i * 0.13f) + i) }
        } else rawSpectrum
        val wave = if (silent) {
            FloatArray(32) { i ->
                sin(i / 32f * 6.2832f * 2f + t * 2f) * 0.5f +
                    sin(i / 32f * 6.2832f * 3f - t * 1.4f) * 0.3f
            }
        } else rawWave
        val bass = avg(spectrum, 0, 2)
        val mid = avg(spectrum, 2, 6)
        val treb = avg(spectrum, 6, spectrum.size)
        val energy = (bass + mid + treb) / 3f

        val feat = preset.features
        val zoom = 1f + feat.zoom * 0.02f + bass * 0.06f
        val rotDeg = feat.rot * 2.9f + sin(t * 0.4f) * 0.6f
        val decay = feat.decay.coerceIn(0.5f, 0.999f)

        // 1. feedback warp of previous frame
        warpMatrix.reset()
        warpMatrix.postTranslate(-w / 2f, -h / 2f)
        warpMatrix.postScale(zoom, zoom)
        warpMatrix.postRotate(rotDeg)
        warpMatrix.postTranslate(w / 2f, h / 2f)
        bitmapPaint.alpha = (decay * 255).toInt()
        pc.drawBitmap(buf, warpMatrix, bitmapPaint)
        pc.drawRect(0f, 0f, w, h, fadePaint)

        // 2. audio-reactive drawing.
        // Per-preset identity seed: every preset gets its own orbit speed,
        // phase, orb count and wave style so switches/cycling are obvious
        // even with the same track and same cover colors.
        val seed = ((presetIndex * 0.6180339f) % 1f + 1f) % 1f
        val hueBase = (presetIndex * 47) % 360
        val orbCount = 3 + (presetIndex % 4)
        val orbitSpeed = 0.6f + seed * 1.4f
        val waveStyle = preset.features.waveMode % 3
        val cx = w / 2f
        val cy = h / 2f

        linePaint.strokeWidth = maxOf(2f, h * 0.008f) * (1f + (presetIndex % 3) * 0.5f)
        linePaint.color = waveColor(0.5f + treb * 0.5f, hueBase)
        if (waveStyle == 2) {
            // circular wave: radius modulated by the waveform ring
            val baseR = min(w, h) * 0.22f
            val circle = android.graphics.Path()
            val steps = 64
            for (s in 0..steps) {
                val ang = s / steps.toFloat() * (Math.PI * 2).toFloat()
                val sample = wave[(s * wave.size / steps) % wave.size]
                val r = baseR * (1f + sample * (0.4f + energy) + bass * 0.3f)
                val x = cx + cos(ang) * r * (w / h.coerceAtLeast(1f))
                val y = cy + sin(ang) * r
                if (s == 0) circle.moveTo(x, y) else circle.lineTo(x, y)
            }
            circle.close()
            pc.drawPath(circle, linePaint)
        } else {
            val path = android.graphics.Path()
            for (i in wave.indices) {
                val x = i / (wave.size - 1).toFloat() * w
                val y = cy - wave[i] * h * 0.35f * (0.5f + energy)
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            pc.drawPath(path, linePaint)
            if (waveStyle == 1) {
                // mirrored copy
                linePaint.alpha = 110
                val path2 = android.graphics.Path()
                for (i in wave.indices) {
                    val x = i / (wave.size - 1).toFloat() * w
                    val y = cy + wave[i] * h * 0.35f * (0.5f + energy)
                    if (i == 0) path2.moveTo(x, y) else path2.lineTo(x, y)
                }
                pc.drawPath(path2, linePaint)
                linePaint.alpha = 255
            }
        }

        val orbs = orbCount
        for (k in 0 until orbs) {
            val band = spectrum.getOrElse(k * spectrum.size / orbs) { 0f }
            val ang = t * (0.3f + 0.12f * k) * orbitSpeed + seed * 6.28f + k * 2.4f
            val rad = min(w, h) * (0.12f + 0.3f * ((k + 1) / orbs.toFloat())) * (1f + band * 0.8f)
            val x = cx + cos(ang) * rad * (w / h)
            val y = cy + sin(ang * 1.3f) * rad * 0.7f
            val r = maxOf(2f, 4f + band * 26f + bass * 8f)
            fillPaint.shader = RadialGradient(
                x, y, r,
                orbColor(k, orbs, mid, hueBase, 0.9f),
                orbColor(k, orbs, mid, hueBase, 0f),
                Shader.TileMode.CLAMP
            )
            pc.drawCircle(x, y, r, fillPaint)
        }
        fillPaint.shader = null

        if (bass > 0.55f) {
            linePaint.strokeWidth = 3f
            linePaint.color = waveColor(0.85f, (hueBase + 180) % 360)
            linePaint.alpha = min(200, ((bass - 0.55f) * 500).toInt())
            pc.drawCircle(cx, cy, min(w, h) * (0.2f + bass * 0.25f), linePaint)
            if (presetIndex % 2 == 1) {
                pc.drawCircle(cx, cy, min(w, h) * (0.1f + bass * 0.15f), linePaint)
            }
            linePaint.alpha = 255
        }

        // 3. upscale to view
        canvas.drawColor(Color.BLACK)
        canvas.drawBitmap(buf, null, android.graphics.Rect(0, 0, width, height), bitmapPaint)

        if (isAttachedToWindow) postInvalidateOnAnimation()
    }

    private fun avg(a: FloatArray, from: Int, to: Int): Float {
        var s = 0f
        var n = 0
        for (i in from until min(to, a.size)) {
            val v = a[i]
            if (v.isFinite()) {
                s += v
                n++
            }
        }
        return if (n == 0) 0f else (s / n).coerceIn(0f, 1f)
    }

    private fun waveColor(frac: Float, hueBase: Int): Int {
        if (useCoverPalette) {
            return lerp(CoverPalette.low, CoverPalette.high, frac.coerceIn(0f, 1f))
        }
        return Color.HSVToColor(floatArrayOf(((hueBase + frac * 120f) % 360f + 360f) % 360f, 1f, 1f))
    }

    private fun orbColor(k: Int, orbs: Int, mid: Float, hueBase: Int, alphaF: Float): Int {
        val alpha = (alphaF * 255).toInt().coerceIn(0, 255)
        if (useCoverPalette) {
            val base = lerp(CoverPalette.dominant, CoverPalette.complement, k / orbs.toFloat())
            return (base and 0x00FFFFFF) or (alpha shl 24)
        }
        val hue = ((hueBase + k * 40 + mid * 80) % 360 + 360) % 360
        return Color.HSVToColor(alpha, floatArrayOf(hue, 1f, 0.65f))
    }

    private fun lerp(a: Int, b: Int, f: Float): Int {
        val t = f.coerceIn(0f, 1f)
        val inv = 1f - t
        return Color.argb(
            (Color.alpha(a) * inv + Color.alpha(b) * t).toInt(),
            (Color.red(a) * inv + Color.red(b) * t).toInt(),
            (Color.green(a) * inv + Color.green(b) * t).toInt(),
            (Color.blue(a) * inv + Color.blue(b) * t).toInt()
        )
    }

    companion object {
        private const val MAX_BACKING = 480
        private const val TAG = "AppVizView"
    }
}
