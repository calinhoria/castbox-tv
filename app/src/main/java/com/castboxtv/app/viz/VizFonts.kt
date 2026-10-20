package com.castboxtv.app.viz

import android.content.Context
import android.graphics.Typeface
import android.util.Log

/**
 * The 10 bundled families from visualizer/fonts (served as woff2 on the web,
 * as static TTFs here in assets/fonts). Maps the engine's `font` prop value
 * to a Typeface; unknown names fall back to the system default.
 */
object VizFonts {

    private const val TAG = "VizFonts"

    private val FILES = mapOf(
        "Inter" to "inter",
        "Roboto" to "roboto",
        "Open Sans" to "open-sans",
        "Lato" to "lato",
        "Montserrat" to "montserrat",
        "Poppins" to "poppins",
        "Oswald" to "oswald",
        "Raleway" to "raleway",
        "Nunito" to "nunito",
        "Playfair Display" to "playfair-display",
        "DSEG7 Classic" to "dseg7-classic",
    )

    private val cache = HashMap<String, Typeface?>()

    fun fileBase(family: String): String? = FILES[family.trim()]

    fun typeface(context: Context, family: String, weight: Int): Typeface {
        val base = fileBase(family) ?: return weightStyle(null, weight)
        val w = nearestWeight(base, weight)
        val key = "$base-$w"
        var tf = cache[key]
        if (tf == null && !cache.containsKey(key)) {
            tf = try {
                Typeface.createFromAsset(context.assets, "fonts/$key.ttf")
            } catch (e: Exception) {
                Log.w(TAG, "missing font asset fonts/$key.ttf", e)
                null
            }
            cache[key] = tf
        }
        return weightStyle(tf, weight)
    }

    private fun nearestWeight(base: String, weight: Int): Int {
        val have = if (base == "playfair-display" || base == "dseg7-classic") intArrayOf(400, 700) else intArrayOf(300, 400, 700)
        var best = have[0]
        for (w in have) {
            if (kotlin.math.abs(w - weight) < kotlin.math.abs(best - weight)) best = w
        }
        return best
    }

    private fun weightStyle(tf: Typeface?, weight: Int): Typeface {
        val base = tf ?: Typeface.DEFAULT
        // Only embolden when the file is a light/regular cut and the preset
        // asked for bold; never fake a light weight out of a bold file.
        return if (weight >= 700) Typeface.create(base, Typeface.BOLD) else base
    }
}
