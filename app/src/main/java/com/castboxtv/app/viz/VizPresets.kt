package com.castboxtv.app.viz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import java.io.File
import org.json.JSONObject

/**
 * Storage for the "Built in visualiser" pack: the vze JSON presets authored
 * in Visualiser Studio.
 *
 * Seed: bundled studio preset assets (one .json per preset, the same files
 * the web Studio ships). User presets saved from the Studio (POST /api/viz-preset, or the
 * "Send to TV" button) land in filesDir/viz-presets and shadow same-named
 * seeds. Deleted seeds stay deleted (tombstones).
 */
object VizPresets {

    private const val TAG = "VizPresets"
    const val COVER_ID = 1

    @Volatile private var cache: List<Entry>? = null
    @Volatile private var names: List<String>? = null
    private val lock = Any()

    /** One row of the preset table: raw JSON plus whether a user file backs it. */
    private data class Entry(val name: String, val json: String, val isUser: Boolean)

    private fun userDir(context: Context): File = File(context.filesDir, "viz-presets").also { it.mkdirs() }

    private fun tombstones(context: Context): MutableSet<String> {
        val f = File(userDir(context), ".deleted")
        if (!f.exists()) return mutableSetOf()
        return f.readLines().map { it.trim() }.filter { it.isNotEmpty() }.toMutableSet()
    }

    private fun saveTombstones(context: Context, deleted: Set<String>) {
        try {
            File(userDir(context), ".deleted").writeText(deleted.joinToString("\n"))
        } catch (e: Exception) {
            Log.w(TAG, "tombstone save failed", e)
        }
    }

    fun invalidate() {
        synchronized(lock) { cache = null; names = null }
    }

    /**
     * Single-pass load of the whole preset table: every seed asset and every
     * user file is read and parsed exactly once. The old code re-read all
     * files per name (names x files), which pushed ?full=1 past the Studio's
     * 5s timeout and made the TV look permanently unreachable.
     * Seeds load first so user saves with the same name shadow them.
     */
    private fun load(context: Context): List<Entry> {
        cache?.let { return it }
        synchronized(lock) {
            cache?.let { return it }
            val table = linkedMapOf<String, Entry>()
            try {
                context.assets.list("studio/presets/default")
                    ?.filter { it.endsWith(".json", ignoreCase = true) }
                    ?.sorted()
                    ?.forEach { file ->
                        try {
                            context.assets.open("studio/presets/default/$file").bufferedReader().use { r ->
                                val text = r.readText()
                                val name = JSONObject(text).optString("name", file.removeSuffix(".json"))
                                if (name.isNotBlank()) table[name] = Entry(name, text, false)
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "skip seed $file", e)
                        }
                    }
            } catch (e: Exception) {
                Log.w(TAG, "no studio preset assets", e)
            }
            try {
                userDir(context).listFiles()
                    ?.filter { it.isFile && it.name.endsWith(".json", ignoreCase = true) }
                    ?.sortedBy { it.name }
                    ?.forEach { f ->
                        try {
                            val text = f.readText()
                            val name = JSONObject(text).optString("name", f.name.removeSuffix(".json"))
                            if (name.isNotBlank()) table[name] = Entry(name, text, true)
                        } catch (e: Exception) {
                            Log.w(TAG, "skip user preset ${f.name}", e)
                        }
                    }
            } catch (e: Exception) {
                Log.w(TAG, "user preset scan failed", e)
            }
            val deleted = tombstones(context)
            val result = table.values.filter { it.name !in deleted }.sortedBy { it.name }
            cache = result
            names = result.map { it.name }
            Log.d(TAG, "loaded ${result.size} presets")
            return result
        }
    }

    /** Sorted preset names (".json" stripped), seeds + user saves minus deletions. */
    fun names(context: Context): List<String> {
        names?.let { return it }
        return load(context).map { it.name }
    }

    /** Drops every tombstone, bringing deleted seeds back. Returns the count. */
    fun restore(context: Context): Int {
        val deleted = tombstones(context)
        val n = deleted.size
        if (n > 0) {
            saveTombstones(context, emptySet())
            invalidate()
            Log.i(TAG, "restored $n deleted preset(s)")
        }
        return n
    }

    /** Names backed by user files (new or seed-shadowing), for Studio grouping. */
    fun userNames(context: Context): List<String> =
        load(context).filter { it.isUser }.map { it.name }

    /** Raw JSON for [name], or null. */
    fun json(context: Context, name: String): String? =
        load(context).find { it.name == name }?.json

    /** Raw JSONs aligned with names(), for the Studio full dump. */
    fun fullJsons(context: Context): List<String> = load(context).map { it.json }

    /**
     * Saves [presetJson] (must carry a "name") to filesDir/viz-presets.
     * Returns the stored name, or null when the JSON is unusable.
     */
    fun save(context: Context, presetJson: String): String? {
        val name = try {
            JSONObject(presetJson).optString("name", "").trim()
        } catch (_: Exception) {
            ""
        }
        if (name.isEmpty()) return null
        return try {
            val safe = name.replace(Regex("[^a-zA-Z0-9 _.-]"), "_").take(80).ifBlank { "preset" }
            File(userDir(context), "$safe.json").writeText(presetJson)
            val deleted = tombstones(context)
            if (deleted.remove(name)) saveTombstones(context, deleted)
            invalidate()
            Log.i(TAG, "saved preset \"$name\"")
            name
        } catch (e: Exception) {
            Log.w(TAG, "preset save failed", e)
            null
        }
    }

    /** Deletes [name]; returns true when a file was removed or a seed was tombstoned. */
    fun delete(context: Context, name: String): Boolean {
        var removed = false
        userDir(context).listFiles()
            ?.filter { it.isFile && it.name.endsWith(".json", ignoreCase = true) }
            ?.forEach { f ->
                try {
                    if (JSONObject(f.readText()).optString("name") == name && f.delete()) removed = true
                } catch (_: Exception) {}
            }
        // tombstone the seed so it stays deleted across restarts
        val deleted = tombstones(context)
        if (deleted.add(name)) {
            saveTombstones(context, deleted)
            removed = true
        }
        invalidate()
        return removed
    }

    /** Cover bitmap for the engine (full-size art when available). */
    fun coverBitmap(): Bitmap? = CoverPalette.coverFull ?: CoverPalette.coverBitmap32
}
