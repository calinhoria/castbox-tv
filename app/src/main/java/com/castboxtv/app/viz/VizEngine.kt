package com.castboxtv.app.viz

import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONObject

/**
 * Kotlin binding for the shared "vze" visualiser engine — the exact same
 * C++ core that powers the browser Visualiser Studio (visualizer/engine/src),
 * compiled into libjniwrapper via CMake. It never draws: it analyses audio,
 * lays out a JSON preset and emits a flat draw-command stream that
 * [VizRenderer] turns into Android Canvas calls.
 */
object VizEngine {

    private const val TAG = "VizEngine"

    @Volatile private var loaded = false
    private val typeCache = HashMap<String, Int>()
    private val propCache = HashMap<String, Int>()
    private var audioBuf: ByteBuffer? = null

    /** Palette name of the currently loaded preset (null = none loaded). */
    @Volatile var currentPalette: String? = null
        private set

    val cmdStride: Int get() = nativeCmdStride()
    val bandCount: Int get() = nativeBandCount()
    val audioWindow: Int get() = nativeAudioWindow()

    fun ensureLoaded(): Boolean {
        if (loaded) return true
        return try {
            System.loadLibrary("jniwrapper")
            nativeInit()
            loaded = true
            Log.i(TAG, "vze engine ready: ${nativeVersion()}")
            true
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "native engine missing", e)
            false
        }
    }

    fun setSurface(w: Int, h: Int) {
        nativeSetSurface(w, h)
        audioBuf = null
    }

    fun setAudioRate(sampleRate: Int) = nativeSetAudioRate(sampleRate)

    private fun typeId(name: String): Int = typeCache.getOrPut(name) { nativeTypeId(name) }
    private fun propId(name: String): Int = propCache.getOrPut(name) { nativePropId(name) }

    /**
     * Loads a preset (the JSON format from visualizer/js/presets.js) and
     * publishes the palette roles as engine variables, so `{primary}` etc.
     * resolve. Returns false when the JSON is unusable.
     */
    fun loadPreset(json: String, coverRoles: Map<String, String>? = null): Boolean {
        if (!ensureLoaded()) return false
        val root = try {
            JSONObject(json)
        } catch (e: Exception) {
            Log.w(TAG, "bad preset json: ${e.message}")
            return false
        }
        // A preset may carry its own `roles` block, which replaces the named palette
        // so the preset is self-contained.
        val embedded = VizPalettes.embeddedRoles(root)
        VizPalettes.withDynamic(embedded ?: VizPalettes.rolesFor(
                root.optString("palette", VizPalettes.DEFAULT), coverRoles), coverRoles)
            .forEach { (role, hex) -> nativeVarSet(role, hex) }
        currentPalette = if (embedded != null) VizPalettes.EMBEDDED else root.optString("palette", VizPalettes.DEFAULT)
        nativeSceneClear()
        val comps = root.optJSONArray("components") ?: return false
        for (i in 0 until comps.length()) {
            val c = comps.optJSONObject(i) ?: continue
            val typeName = c.optString("type")
            val tid = typeId(typeName)
            if (tid < 0) continue
            val idx = nativeSceneAdd(tid)
            if (idx < 0) continue
            val props = c.optJSONObject("props") ?: continue
            val keys = props.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val pid = propId(key)
                if (pid < 0) continue
                when (val v = props.get(key)) {
                    is Boolean -> nativeSceneSetNum(idx, pid, if (v) 1f else 0f)
                    is Number -> nativeSceneSetNum(idx, pid, v.toFloat())
                    is String -> nativeSceneSetStr(idx, pid, v)
                }
            }
        }
        return true
    }

    fun setVar(name: String, value: String) = nativeVarSet(name, value)
    fun setVar(name: String, value: Float) = nativeVarSetNumber(name, value)

    /**
     * Re-publishes the artwork-derived roles when the track changes. The
     * `dynamic` role always follows the artwork, whatever palette is loaded
     * (so a preset can tint its backdrop while keeping fixed brand colours);
     * the remaining roles only move when the preset is on From cover, since
     * fixed palettes must not be clobbered by track changes.
     */
    fun refreshCoverPalette(cover: Map<String, String>) {
        if (!ensureLoaded()) return
        cover[VizPalettes.DYNAMIC]?.let { nativeVarSet(VizPalettes.DYNAMIC, it) }
        if (currentPalette == VizPalettes.FROM_COVER) {
            cover.forEach { (role, hex) -> nativeVarSet(role, hex) }
        }
    }

    /** Feeds one analysis window of mono samples (-1..1). */
    fun pushAudio(samples: FloatArray, length: Int) {
        if (!ensureLoaded()) return
        val buf = audioBuf ?: nativeAudioBuffer().also {
            it.order(ByteOrder.nativeOrder())
            audioBuf = it
        }
        val f = buf.asFloatBuffer()
        val n = minOf(length, audioWindow)
        for (i in 0 until n) f.put(i, samples[i])
        nativeAudioCommit(n)
    }

    fun frame(dtMs: Float) = nativeFrame(dtMs)

    fun cmdCount(): Int = nativeCmdCount()
    fun cmdFloats(): ByteBuffer = nativeCmdData().also { it.order(ByteOrder.nativeOrder()) }
    fun pointCount(): Int = nativePointCount()
    fun pointFloats(): ByteBuffer = nativePointData().also { it.order(ByteOrder.nativeOrder()) }
    fun poolLen(): Int = nativePoolLen()
    fun poolBytes(): ByteBuffer = nativePoolData().also { it.order(ByteOrder.nativeOrder()) }

    fun coverSet(id: Int) = nativeCoverSet(id)
    fun imageSet(id: Int, naturalW: Float, naturalH: Float) = nativeImageSet(id, naturalW, naturalH)
    fun measurePut(strId: Int, width: Float) = nativeMeasurePut(strId, width)
    fun level(source: Int): Float = nativeLevel(source)

    // --- native -------------------------------------------------------------
    external fun nativeInit()
    external fun nativeVersion(): String
    external fun nativeCmdStride(): Int
    external fun nativeBandCount(): Int
    external fun nativeAudioWindow(): Int
    external fun nativeSetSurface(w: Int, h: Int)
    external fun nativeSetAudioRate(sampleRate: Int)
    external fun nativeTypeId(name: String): Int
    external fun nativePropId(name: String): Int
    external fun nativeSceneClear()
    external fun nativeSceneAdd(typeId: Int): Int
    external fun nativeSceneCount(): Int
    external fun nativeSceneSetNum(index: Int, prop: Int, value: Float)
    external fun nativeSceneSetStr(index: Int, prop: Int, value: String)
    external fun nativeVarSet(name: String, value: String)
    external fun nativeVarSetNumber(name: String, value: Float)
    external fun nativeCoverSet(id: Int)
    external fun nativeImageSet(id: Int, naturalW: Float, naturalH: Float)
    external fun nativeAudioBuffer(): ByteBuffer
    external fun nativeAudioCommit(samples: Int)
    external fun nativeFrame(dtMs: Float)
    external fun nativeCmdCount(): Int
    external fun nativeCmdData(): ByteBuffer
    external fun nativePointCount(): Int
    external fun nativePointData(): ByteBuffer
    external fun nativePoolData(): ByteBuffer
    external fun nativePoolLen(): Int
    external fun nativeMeasurePut(strId: Int, width: Float)
    external fun nativeLevel(source: Int): Float
}
