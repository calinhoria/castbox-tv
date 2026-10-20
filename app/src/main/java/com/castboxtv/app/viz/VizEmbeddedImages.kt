package com.castboxtv.app.viz

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import org.json.JSONObject

/**
 * Embedded base64 images in presets.
 *
 * Any string prop starting with "data:image/" is decoded at load and
 * registered with the renderer under a reserved id (10000+, mirroring
 * extractEmbeddedImages in visualizer/js/presets.js). Images primarily live
 * in the preset's top-level `images` table ([{id, url}]) so deleting a
 * component can never drop them; stray prop data URLs (pre-table pastes)
 * are upgraded into the same id space. The stored JSON keeps the data
 * URLs, which is what makes the preset portable. The mapping is
 * deterministic per preset, so reloading re-registers the same ids
 * instead of leaking bitmap slots.
 *
 * Bitmaps are downsampled to a 1024px long edge: a pasted preset can carry
 * phone-camera-sized art and the TV does not need all of it. Malformed
 * entries are skipped (the engine then draws nothing for that prop, same
 * as an unknown numeric id). Past the cap the extras are left untouched.
 */
object VizEmbeddedImages {

    private const val TAG = "VizEmbeddedImages"

    const val BASE = 10000
    const val MAX = 8
    private const val MAX_EDGE = 1024

    /**
     * Embedded image table: decoded from the preset JSON at load, never
     * stored as files. Deleting a component cannot drop these — they live
     * outside the component list. Falls back to stray prop data URLs for
     * pre-table pastes.
     */
    fun resolve(json: String, setImage: (Int, Bitmap) -> Unit): String {
        if (!json.contains("data:image/")) return json
        val root = try {
            JSONObject(json)
        } catch (e: Exception) {
            Log.w(TAG, "bad preset json: ${e.message}")
            return json
        }
        // The table wins; collect its ids so the fallback scan below can
        // never collide with them.
        val tableIds = mutableSetOf<Int>()
        var registered = 0
        val table = root.optJSONArray("images")
        if (table != null) {
            for (i in 0 until table.length()) {
                if (registered >= MAX) break
                val e = table.optJSONObject(i) ?: continue
                val id = e.optInt("id", -1)
                val url = e.optString("url", "")
                if (id < BASE || !url.startsWith("data:image/") || id in tableIds) continue
                val bmp = decode(url) ?: continue
                tableIds.add(id)
                registered++
                try {
                    setImage(id, bmp)
                } catch (ex: Exception) {
                    Log.w(TAG, "embedded image #$id register failed", ex)
                }
            }
        }
        // Pre-table pastes carried raw data URLs in props; upgrade them into
        // the same id space, continuing past the table.
        var next = BASE
        val comps = root.optJSONArray("components") ?: return root.toString()
        val seen = linkedMapOf<String, Int>()
        for (i in 0 until comps.length()) {
            val props = comps.optJSONObject(i)?.optJSONObject("props") ?: continue
            val keys = props.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val v = props.optString(key, "")
                if (!v.startsWith("data:image/")) continue
                var id = seen[v]
                if (id == null) {
                    if (registered >= MAX) {
                        Log.w(TAG, "embedded image cap ($MAX) hit, skipping one")
                        continue
                    }
                    val bmp = decode(v)
                    if (bmp == null) {
                        Log.w(TAG, "could not decode an embedded image, skipping")
                        continue
                    }
                    while (next in tableIds || seen.containsValue(next)) next++
                    id = next++
                    seen[v] = id
                    registered++
                    try {
                        setImage(id, bmp)
                    } catch (e: Exception) {
                        Log.w(TAG, "embedded image #$id register failed", e)
                        continue
                    }
                }
                props.put(key, id.toString())
            }
        }
        return root.toString()
    }

    private fun decode(dataUrl: String): Bitmap? {
        return try {
        val comma = dataUrl.indexOf(',')
        if (comma < 0) return null
        val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
        // Bounds first so a 12MP paste does not blow up TV RAM.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > MAX_EDGE || bounds.outHeight / sample > MAX_EDGE) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        } catch (e: Exception) {
            Log.w(TAG, "embedded image decode failed", e)
            null
        }
    }
}
