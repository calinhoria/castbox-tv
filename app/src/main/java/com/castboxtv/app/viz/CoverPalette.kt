package com.castboxtv.app.viz

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.Log
import androidx.palette.graphics.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL
import kotlin.math.max

object CoverPalette {

    /** Target 0-255 luminance for the `dynamic` role (the spec's 25-35%). */
    private const val TARGET_LIGHTNESS = 76f

    /** Neutral `dynamic` published before any artwork has loaded. */
    const val FALLBACK_DYNAMIC = "#1F1F1F"

    @Volatile var low: Int = Color.rgb(0, 255, 0)
    @Volatile var high: Int = Color.rgb(255, 0, 0)
    @Volatile var dominant: Int = Color.rgb(0, 255, 0)
    @Volatile var complement: Int = Color.rgb(255, 0, 255)
    @Volatile var coverBitmap32: Bitmap? = null

    /** Full-size cover art for the vze engine's image id 1 (`{cover}`). */
    @Volatile var coverFull: Bitmap? = null

    suspend fun updateFromUrl(url: String?) {
        if (url.isNullOrBlank()) return
        withContext(Dispatchers.IO) {
            try {
                val stream = URL(url).openStream()
                val bitmap = BitmapFactory.decodeStream(stream) ?: return@withContext
                stream.close()
                val prev = coverBitmap32
                coverBitmap32 = Bitmap.createScaledBitmap(bitmap, 32, 32, true)
                prev?.recycle()
                coverFull?.recycle()
                // Downscale huge art so one preset frame stays cheap.
                coverFull = if (maxOf(bitmap.width, bitmap.height) > 1024) {
                    val s = 1024f / maxOf(bitmap.width, bitmap.height)
                    Bitmap.createScaledBitmap(bitmap, (bitmap.width * s).toInt(), (bitmap.height * s).toInt(), true)
                } else {
                    bitmap.copy(bitmap.config ?: Bitmap.Config.ARGB_8888, false)
                }
                extract(bitmap)
                bitmap.recycle()
                Log.d("CoverPalette", "updated low=${Integer.toHexString(low)} high=${Integer.toHexString(high)} dominant=${Integer.toHexString(dominant)} complement=${Integer.toHexString(complement)} from $url")
            } catch (e: Exception) {
                Log.e("CoverPalette", "failed to load cover $url", e)
            }
        }
    }

    private fun extract(bitmap: Bitmap) {
        val scaled = Bitmap.createScaledBitmap(bitmap, 64, 64, true)
        val palette = Palette.from(scaled)
            .maximumColorCount(24)
            .addFilter { _, hsl ->
                // drop blacks/whites/grays
                hsl[2] in 0.18f..0.92f && hsl[1] >= 0.25f
            }
            .generate()
        scaled.recycle()

        val swatches = palette.swatches
            .filter { it.hsl[1] >= 0.3f && it.hsl[2] in 0.2f..0.9f }
            .sortedByDescending { it.population }

        if (swatches.isEmpty()) {
            // fallback to vivid-ized dominant
            val fallback = vivid(palette.getDominantColor(Color.RED))
            low = darken(fallback, 0.6f)
            high = fallback
            dominant = fallback
            complement = complementary(dominant)
            return
        }

        // Material You (Monet) seed scoring: chroma * luma * population
        // HCT approx via HSV: Score = pop * saturation * (1 - |value-0.5|*2)
        val scored = swatches.maxByOrNull { scoreSwatch(it) }
        val seedRgb = scored?.rgb ?: swatches.first().rgb
        // Cover palette still two distinct colors for gradient
        val first = seedRgb
        val second = swatches.drop(1)
            .maxByOrNull { colorDistance(first, it.rgb) * it.population }
            ?.rgb ?: lighten(first, 1.5f)

        val vivid1 = vivid(first)
        val vivid2 = vivid(second)

        // ensure contrast by brightness
        val b1 = brightness(vivid1)
        val b2 = brightness(vivid2)
        low = if (b1 <= b2) vivid1 else vivid2
        high = if (b1 <= b2) vivid2 else vivid1
        // Cover Dominant: Monet seed via HCT
        dominant = vivid(seedRgb)
        complement = complementary(dominant)
    }

    private fun colorDistance(a: Int, b: Int): Float {
        val r1 = Color.red(a)
        val g1 = Color.green(a)
        val b1 = Color.blue(a)
        val r2 = Color.red(b)
        val g2 = Color.green(b)
        val b2 = Color.blue(b)
        val dr = r1 - r2
        val dg = g1 - g2
        val db = b1 - b2
        return kotlin.math.sqrt((dr * dr + dg * dg + db * db).toFloat())
    }

    private fun brightness(c: Int): Int {
        return (Color.red(c) * 0.299 + Color.green(c) * 0.587 + Color.blue(c) * 0.114).toInt()
    }

    private fun vivid(c: Int): Int {
        val hsv = FloatArray(3)
        Color.colorToHSV(c, hsv)
        hsv[1] = max(hsv[1], 0.8f).coerceAtMost(1f)
        hsv[2] = hsv[2].coerceIn(0.45f, 0.95f)
        return Color.HSVToColor(hsv)
    }

    private fun darken(c: Int, factor: Float): Int {
        val hsv = FloatArray(3)
        Color.colorToHSV(c, hsv)
        hsv[2] *= factor
        return Color.HSVToColor(hsv)
    }

    private fun lighten(c: Int, factor: Float): Int {
        val r = (Color.red(c) * factor).toInt().coerceIn(0, 255)
        val g = (Color.green(c) * factor).toInt().coerceIn(0, 255)
        val b = (Color.blue(c) * factor).toInt().coerceIn(0, 255)
        return Color.rgb(r, g, b)
    }

    private fun complementary(c: Int): Int {
        val hsv = FloatArray(3)
        Color.colorToHSV(c, hsv)
        hsv[0] = (hsv[0] + 180f) % 360f
        return Color.HSVToColor(hsv)
    }

    private fun scoreSwatch(swatch: Palette.Swatch): Double {
        val hsv = FloatArray(3)
        Color.colorToHSV(swatch.rgb, hsv)
        val chroma = hsv[1].toDouble() // sat ≈ chroma
        val luma = hsv[2].toDouble()
        val lumaScore = (1.0 - kotlin.math.abs(luma - 0.5) * 1.6).coerceIn(0.0, 1.0)
        // penalize low chroma, boost mid luma, weight by log population
        return kotlin.math.ln(swatch.population.toDouble() + 1) * chroma * (0.5 + lumaScore * 0.5)
    }

    private fun hex(c: Int): String = "#%02X%02X%02X".format(Color.red(c), Color.green(c), Color.blue(c))

    /**
     * The vze palette roles derived from the extracted colours, so a preset on
     * the "From cover" palette follows the artwork. Mirrors the mapping in
     * visualizer/js/palettes.js (vibrant -> primary, darkest -> background).
     *
     * `dynamic` is the 7th role: the dominant artwork colour pulled down to
     * ~30% lightness. It is published for EVERY palette, not just this one, so
     * a preset can tint its backdrop with the artwork while keeping fixed brand
     * colours for text and accents.
     */
    fun roles(): Map<String, String> {
        val lum = brightness(dominant)
        return linkedMapOf(
            "bg" to hex(darken(dominant, 0.25f)),
            "surface" to hex(darken(complement, 0.45f)),
            "primary" to hex(high),
            "secondary" to hex(dominant),
            "accent" to hex(complement),
            "text" to if (lum > 158) "#0B0B0F" else "#FFFFFF",
            "dynamic" to dynamicTint(),
        )
    }

    /**
     * Dominant colour mixed toward black (or white) until it sits near 30%
     * luminance, keeping its hue. Mixing rather than scaling is what lets pure
     * black be lifted at all; the mix amount is bisected so it converges for
     * any input. Mirrors shadeToLightness in visualizer/js/palettes.js.
     */
    private fun dynamicTint(): String {
        val br = Color.red(dominant).toFloat()
        val bg = Color.green(dominant).toFloat()
        val bb = Color.blue(dominant).toFloat()
        fun luma(r: Float, g: Float, b: Float) = 0.2126f * r + 0.7152f * g + 0.0722f * b
        val darken = luma(br, bg, bb) > TARGET_LIGHTNESS
        val tr = if (darken) 0f else 255f
        val tg = if (darken) 0f else 255f
        val tb = if (darken) 0f else 255f
        var lo = 0f
        var hi = 1f
        var best = 0f
        repeat(24) {
            val t = (lo + hi) / 2f
            val r = br + (tr - br) * t
            val g = bg + (tg - bg) * t
            val b = bb + (tb - bb) * t
            best = t
            val l = luma(r, g, b)
            if (kotlin.math.abs(l - TARGET_LIGHTNESS) < 1.3f) return@repeat
            if (if (darken) l > TARGET_LIGHTNESS else l < TARGET_LIGHTNESS) lo = t else hi = t
        }
        return hex(
            Color.rgb(
                (br + (tr - br) * best).toInt().coerceIn(0, 255),
                (bg + (tg - bg) * best).toInt().coerceIn(0, 255),
                (bb + (tb - bb) * best).toInt().coerceIn(0, 255),
            )
        )
    }
}
