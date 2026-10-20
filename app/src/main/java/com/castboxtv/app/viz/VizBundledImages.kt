package com.castboxtv.app.viz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log

/**
 * Bundled artwork with fixed image ids, mirroring BUNDLED_IMAGES in
 * visualizer/js/main.js so built-in presets can reference real images
 * portably (numeric ids; the engine resolves them verbatim).
 *
 * Decoded once per process into [CACHE], then handed to every renderer that
 * asks. The decode is deliberately NOT guarded by a "done" flag: VizRenderer
 * keeps its image table per instance, so a renderer created after the first
 * one (activity recreation, a second VizView, the /api/viz-test renderer)
 * would otherwise silently never receive ids 10/11 and presets like
 * "Winamp base" would render with their skin missing. Re-applying is cheap —
 * two map puts and an imageSet — so every renderer gets seeded every time.
 */
object VizBundledImages {

    private const val TAG = "VizBundledImages"

    private data class Entry(val id: Int, val asset: String)

    private val ENTRIES = listOf(
        Entry(10, "studio/assets/winamp-base.jpg"),
        Entry(11, "studio/assets/winamp-thumb.png"),
    )

    /** id -> decoded bitmap, populated on first call and kept for the process. */
    private val CACHE = HashMap<Int, Bitmap>()

    /** True once the decode pass has run, successfully or not. */
    @Volatile private var decoded = false

    /** Seeds [renderer] with every bundled image. Safe to call repeatedly. */
    fun ensure(context: Context, renderer: VizRenderer) {
        if (!decoded) {
            synchronized(this) {
                if (!decoded) {
                    for (e in ENTRIES) {
                        val bmp = decode(context, e)
                        if (bmp != null) CACHE[e.id] = bmp
                    }
                    decoded = true
                }
            }
        }
        if (CACHE.isEmpty()) return
        // One line per renderer seeded, so a renderer that somehow missed out
        // is visible in logcat rather than silently rendering a blank panel.
        Log.d(TAG, "seeding ${CACHE.size} bundled image(s) into renderer " +
            Integer.toHexString(System.identityHashCode(renderer)))
        synchronized(CACHE) {
            for ((id, bmp) in CACHE) {
                // A recycled bitmap here would poison every later renderer.
                if (bmp.isRecycled) {
                    Log.w(TAG, "cached bundled image #$id was recycled; dropping")
                    CACHE.remove(id)
                    continue
                }
                renderer.setImage(id, bmp)
            }
        }
    }

    private fun decode(context: Context, e: Entry): Bitmap? = try {
        context.assets.open(e.asset).use { input ->
            val bmp = BitmapFactory.decodeStream(input)
            if (bmp != null) {
                Log.i(TAG, "bundled image #${e.id} ${e.asset} (${bmp.width}x${bmp.height})")
            } else {
                Log.w(TAG, "could not decode ${e.asset}")
            }
            bmp
        }
    } catch (ex: Exception) {
        Log.w(TAG, "bundled image missing: ${e.asset}", ex)
        null
    }
}