package com.castboxtv.app.viz

import android.content.Context
import android.util.Log

/**
 * Winamp / MilkDrop preset support for the APP visualization (phone/TV screen,
 * NOT the 32x32 matrix). Same .milk text files as the simulator playground
 * (simulator/index.html "App visualization") and as libprojectM on Android.
 *
 * The native renderer ([AppVizView]) drives zoom/decay/rot/warp/waveMode from
 * these parsed params plus live audio (AudioSpectrum/Waveform/Levels).
 * Per-frame/per-pixel equations are parsed and shown (web UI) but evaluated
 * only as feature hints — full EEL evaluation is libprojectM's job later.
 */
object AppVizPresets {

    data class Equation(val key: String, val code: String)

    data class Features(
        val zoom: Float = 1.0f,
        val decay: Float = 0.98f,
        val rot: Float = 0f,
        val warp: Float = 1.0f,
        val waveMode: Int = 0
    )

    data class Preset(
        val name: String,
        val params: Map<String, String> = emptyMap(),
        val perFrame: List<Equation> = emptyList(),
        val perPixel: List<Equation> = emptyList(),
        val hasWarpShader: Boolean = false,
        val hasCompShader: Boolean = false,
        val features: Features = Features()
    )

    @Volatile private var cached: List<Preset>? = null
    private val loadLock = Any()

    fun load(context: Context): List<Preset> {
        cached?.let { return it }
        synchronized(loadLock) {
            cached?.let { return it }
            val out = mutableListOf<Preset>()
        try {
            val files = context.assets.list("appviz")
                ?.filter { it.endsWith(".milk", ignoreCase = true) || it.endsWith(".milk2", ignoreCase = true) }
                ?.sorted() ?: emptyList()
            for (file in files) {
                try {
                    context.assets.open("appviz/$file").bufferedReader().use { reader ->
                        out.add(parse(reader.readText(), file))
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "skip preset $file", e)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "no appviz assets", e)
        }
        if (out.isEmpty()) {
            Log.w(TAG, "no .milk assets, using embedded demos")
            DEMOS.forEach { (file, text) -> out.add(parse(text, file)) }
        }
        Log.d(TAG, "loaded ${out.size} presets")
        cached = out
        return out
        }
    }

    fun parse(text: String, fileName: String): Preset {
        val params = mutableMapOf<String, String>()
        val perFrame = mutableListOf<Equation>()
        val perPixel = mutableListOf<Equation>()
        var warp = 0
        var comp = 0
        for (rawLine in text.lineSequence()) {
            val line = rawLine.trim()
            if (line.isEmpty() || line.startsWith(";") || line.startsWith("#")) continue
            if (line.startsWith("[") && line.endsWith("]")) continue
            val eq = line.indexOf('=')
            if (eq < 0) continue
            val key = line.substring(0, eq).trim()
            var value = line.substring(eq + 1).trim()
            if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) ||
                        (value.startsWith("`") && value.endsWith("`")))
            ) {
                value = value.substring(1, value.length - 1)
            }
            val lk = key.lowercase()
            when {
                lk.startsWith("per_frame_") -> perFrame.add(Equation(key, value))
                lk.startsWith("per_pixel_") -> perPixel.add(Equation(key, value))
                lk == "warp_shader" || lk == "warpshader" -> warp += value.length
                lk == "comp_shader" || lk == "compshader" -> comp += value.length
                else -> {
                    params[key] = value
                    params[lk] = value
                }
            }
        }
        fun num(names: List<String>, def: Float): Float {
            for (n in names) {
                params[n]?.toFloatOrNull()?.let { return it }
            }
            return def
        }
        fun int(names: List<String>, def: Int): Int {
            for (n in names) {
                params[n]?.toFloatOrNull()?.let { return it.toInt() }
            }
            return def
        }
        val name = fileName
            .substringAfterLast('/')
            .removeSuffix(".milk2").removeSuffix(".milk").removeSuffix(".txt")
            .ifBlank { "Untitled" }
        return Preset(
            name = name,
            params = params,
            perFrame = perFrame.sortedBy { it.key },
            perPixel = perPixel.sortedBy { it.key },
            hasWarpShader = warp > 0,
            hasCompShader = comp > 0,
            features = Features(
                zoom = num(listOf("fZoomExponent", "zoom"), 1.0f),
                decay = num(listOf("fDecay", "decay"), 0.98f),
                rot = num(listOf("fRot", "rot"), 0f),
                warp = num(listOf("fWarpAmount", "warp"), 1.0f),
                waveMode = int(listOf("nWaveMode", "wavemode"), 0)
            )
        )
    }

    private val DEMOS = listOf(
        "demo-spiral.milk" to "MILK Preset v1.2\n[preset00]\nfRating=5.000\nfGammaAdj=2.000\nfDecay=0.980\nfZoomExponent=1.050\nfRot=0.120\nfWarpAmount=1.000\nnWaveMode=0\nfWaveAlpha=0.800\nfWaveScale=1.000\nper_frame_1=zoom = zoom + 0.05*sin(time);\nper_frame_2=rot = rot + 0.10*bass;\nper_pixel_1=x = x + 0.01*sin(y*10+time);\n",
        "demo-kaleido.milk" to "MILK Preset v1.2\n[preset00]\nfRating=4.000\nfGammaAdj=1.800\nfDecay=0.960\nfZoomExponent=0.980\nfRot=-0.200\nfWarpAmount=2.500\nnWaveMode=2\nfWaveAlpha=0.900\nbWaveDots=1\nper_frame_1=warp = warp + 0.5*treb;\nper_frame_2=cx = 0.5 + 0.1*sin(time*0.7);\n",
        "demo-basszoom.milk" to "MILK Preset v1.2\n[preset00]\nfRating=4.500\nfGammaAdj=2.200\nfDecay=0.990\nfZoomExponent=1.200\nfRot=0.020\nfWarpAmount=0.500\nnWaveMode=1\nfWaveScale=2.000\nper_frame_1=zoom = zoom + bass*0.2;\nper_frame_2=decay = decay - mid*0.05;\n"
    )

    private const val TAG = "AppVizPresets"
}
