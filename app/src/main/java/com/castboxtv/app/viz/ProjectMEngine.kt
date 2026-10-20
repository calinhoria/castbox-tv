package com.castboxtv.app.viz

import android.content.Context
import android.opengl.GLSurfaceView
import android.util.Log
import java.io.File
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

/**
 * Native projectM (MilkDrop) engine host for the Play Now background.
 *
 * Lifecycle:
 *  - [ensurePresetsOnDisk] copies bundled asset presets to
 *    filesDir/appviz (real files — projectM scans a directory).
 *  - GLSurfaceView renders via projectM; Kotlin drives preset selection
 *    (settings + cycling) and pumps PCM from [AppVizAudioFeed].
 */
object ProjectMEngine {

    private const val TAG = "ProjectMEngine"

    /** Preset pack names. */
    const val PACK_FULL: String = "full"
    const val PACK_CLASSIC: String = "classic"
    const val PACK_BUTTERCHURN: String = "butterchurn"
    const val PACK_FAVORITES: String = "favorites"
    /** Visualiser Studio (vze JSON) pack — "Built in visualiser" in the UI. */
    const val PACK_BUILTIN: String = "builtin"

    /** Assets dir backing for a pack. */
    private fun assetDirFor(pack: String): String = when (pack) {
        PACK_CLASSIC -> "appviz-classic"
        PACK_BUTTERCHURN -> "appviz-butterchurn"
        PACK_FULL -> "appviz"
        PACK_FAVORITES -> "appviz-favorites"
        else -> "appviz"
    }

    /** Storage dir inside filesDir for a pack. */
    fun storageDirFor(pack: String): String = when (pack) {
        PACK_CLASSIC -> "appviz-classic"
        PACK_BUTTERCHURN -> "appviz-butterchurn"
        PACK_FAVORITES -> "appviz-favorites"
        else -> "appviz"
    }

    /** Sorted preset names (".milk" stripped) as the engine sees them. */
    @Volatile var presetNames: List<String> = emptyList()
        private set

    @Volatile var ready: Boolean = false
        private set

    /**
     * Rebuild filesDir/appviz-favorites from the saved favorite names by
     * copying the matching .milk files from whichever pack dir (or asset
     * store) has them.
     */
    fun refreshFavoritesDir(context: Context, favorites: List<String>): File = runBlocking(Dispatchers.IO) {
        val dir = File(context.filesDir, assetDirFor(PACK_FAVORITES))
        dir.deleteRecursively()
        dir.mkdirs()
        val sourceDirs = listOf(
            File(context.filesDir, storageDirFor(PACK_FULL)),
            File(context.filesDir, storageDirFor(PACK_CLASSIC)),
            File(context.filesDir, storageDirFor(PACK_BUTTERCHURN)),
        )
        var copied = 0
        for (name in favorites) {
            if (name.isBlank()) continue
            val wanted = "$name.milk"
            val src = sourceDirs.map { File(it, wanted) }.firstOrNull { it.exists() }
            if (src != null) {
                src.copyTo(File(dir, wanted), overwrite = true)
                copied++
                continue
            }
            // fall back to assets (pack not yet copied to disk)
            val assetDir = if (context.assets.list(assetDirFor(PACK_FULL))?.contains(wanted) == true) {
                assetDirFor(PACK_FULL)
            } else assetDirFor(PACK_CLASSIC)
            try {
                context.assets.open("$assetDir/$wanted").use { input ->
                    File(dir, wanted).outputStream().use { output -> input.copyTo(output) }
                }
                copied++
            } catch (_: Exception) {
                Log.w(TAG, "favorite preset not found: $name")
            }
        }
        Log.d(TAG, "favorites dir: ${dir.listFiles()?.size ?: 0} requested ${favorites.size}")
        dir
    }

    /**
     * Copy asset presets to real files for the requested pack; dispatch.
     * Cream pack: unzip assets/appviz-cotc/cream.zip to storage (skips when
     * already extracted), flat .milk layout + extraction progress reporting.
     */
    suspend fun ensurePresetsOnDisk(context: Context, pack: String): File = withContext(Dispatchers.IO) {
        val assetDir = assetDirFor(pack)
        val dir = File(context.filesDir, assetDir.replace('/', '_'))
        if (!dir.exists()) dir.mkdirs()
        var copied = 0
        try {
            val assets = context.assets.list(assetDir)
                ?.filter { it.endsWith(".milk", true) || it.endsWith(".milk2", true) }
                ?: emptyList()
            for (name in assets) {
                val out = File(dir, name)
                if (!out.exists() || out.length() == 0L) {
                    context.assets.open("$assetDir/$name").use { input ->
                        val tmp = File(dir, "$name.tmp")
                        tmp.outputStream().use { output -> input.copyTo(output) }
                        if (!tmp.renameTo(out)) {
                            out.outputStream().use { output -> input.copyTo(output) }
                            tmp.delete()
                        }
                    }
                    copied++
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "preset copy failed", e)
        }
        // mirror: drop on-disk presets no longer bundled (pack pruned)
        try {
            val assets = context.assets.list(assetDir)
                ?.filter { it.endsWith(".milk", true) || it.endsWith(".milk2", true) }
                ?.toSet() ?: emptySet()
            var pruned = 0
            dir.listFiles()?.forEach { f ->
                if (f.isFile && f.name.endsWith(".milk", true) && !assets.contains(f.name)) {
                    if (f.delete()) pruned++
                }
            }
            if (pruned > 0) Log.i(TAG, "pack=$pack pruned $pruned retired presets")
        } catch (e: Exception) {
            Log.w(TAG, "preset prune failed", e)
        }
        Log.d(TAG, "pack=$pack presets on disk: ${dir.list()?.size ?: 0} (copied $copied)")
        dir
    }

    /**
     * Create the native engine. Must run on the GL thread (called from the
     * renderer callbacks). Returns preset count.
     */
    fun createOnGlThread(width: Int, height: Int, presetsDir: File): Int {
        if (!ProjectMJNI.ensureLoaded()) return 0
        val count = ProjectMJNI.create(width, height, presetsDir.absolutePath)
        val names = ArrayList<String>(count)
        for (i in 0 until count) {
            names.add(ProjectMJNI.presetNameAt(i))
        }
        presetNames = names
        ready = count > 0
        // engine's internal timer off; cycling handled by app settings
        ProjectMJNI.setPresetLocked(true)
        Log.i(TAG, "engine ready: $count presets, dir=${presetsDir.absolutePath}")
        return count
    }

    fun selectByName(name: String, hardCut: Boolean = true): Boolean {
        if (!ready) return false
        val idx = presetNames.indexOf(name)
        if (idx < 0) return false
        return ProjectMJNI.selectPreset(idx, hardCut)
    }

    fun destroy() {
        if (ProjectMJNI.loaded) {
            ProjectMJNI.destroy()
        }
        ready = false
        presetNames = emptyList()
    }
}

/** GLSurfaceView that owns the native renderer + PCM pump. */
class ProjectMView @JvmOverloads constructor(
    context: Context,
    attrs: android.util.AttributeSet? = null
) : GLSurfaceView(context, attrs) {

    private val renderer = EngineRenderer()

    init {
        setEGLContextClientVersion(2)
        preserveEGLContextOnPause = true
        setRenderer(renderer)
        renderMode = RENDERMODE_CONTINUOUSLY
    }

    fun selectPresetByName(name: String, hardCut: Boolean = true): Boolean {
        if (lastRequested == name) return true // recomposition spam guard
        lastRequested = name
        // Load on the GL thread: JNI preset parse must not block Compose UI.
        queueEvent { ProjectMEngine.selectByName(name, hardCut) }
        return true
    }

    private var lastRequested: String? = null

    private class EngineRenderer : GLSurfaceView.Renderer {

        @Volatile private var presetsDir: File? = null
        @Volatile private var created = false

        fun setPresetsDir(dir: File) {
            presetsDir = dir
        }

        fun destroyEngine() {
            ProjectMEngine.destroy()
            created = false
            lastUpdateMs = 0L
        }

        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            try {
                android.opengl.GLES20.glGetString(android.opengl.GLES20.GL_RENDERER)?.let {
                    Log.i("ProjectMEngine", "GL_RENDERER: $it")
                }
                android.opengl.GLES20.glGetString(android.opengl.GLES20.GL_VERSION)?.let {
                    Log.i("ProjectMEngine", "GL_VERSION: $it")
                }
                android.opengl.GLES20.glGetString(android.opengl.GLES20.GL_VENDOR)?.let {
                    Log.i("ProjectMEngine", "GL_VENDOR: $it")
                }
            } catch (_: Exception) {}
            tryCreate()
        }

        fun tryCreate(): Boolean {
            synchronized(this) {
                if (created) return true
                // GL thread: safe to create native engine here
                val dir = presetsDir ?: return false
                val metrics = android.content.res.Resources.getSystem().displayMetrics
                val count = ProjectMEngine.createOnGlThread(
                    metrics.widthPixels.coerceAtLeast(2),
                    metrics.heightPixels.coerceAtLeast(2),
                    dir
                )
                created = count > 0
                return created
            }
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            synchronized(this) {
                Log.i("ProjectMEngine", "onSurfaceChanged: ${width}x${height}")
                if (created) ProjectMJNI.resize(width, height)
            }
        }

        override fun onDrawFrame(gl: GL10?) {
            if (!created && !tryCreate()) return
            if (fpsWindowStart == 0L) fpsWindowStart = android.os.SystemClock.uptimeMillis()
            val now = android.os.SystemClock.uptimeMillis()
            val t0 = now

            if (now - lastUpdateMs >= TARGET_UPDATE_MS) {
                // expensive pass: projectM update + PCM pump at ~30fps
                val chunk = AppVizAudioFeed.drain(2048)
                if (chunk.isNotEmpty()) {
                    ProjectMJNI.addPcmFloat(chunk, chunk.size)
                    pcmSamples += chunk.size
                    var peak = 0f
                    for (s in chunk) {
                        val a = kotlin.math.abs(s)
                        if (a > peak) peak = a
                    }
                    if (peak > pcmPeak) pcmPeak = peak
                } else {
                    pcmEmpty++
                }
                ProjectMJNI.renderFrame()
                lastUpdateMs = now
                fullUpdates++
                val ms = android.os.SystemClock.uptimeMillis() - t0
                frameMsAccum += ms
            } else {
                // cheap blit of the last output texture, no projectM work
                ProjectMJNI.blitOnly()
            }
            displayFrames++

            if (now - fpsWindowStart >= 1000) {
                val fps = displayFrames * 1000f / (now - fpsWindowStart).coerceAtLeast(1L)
                val avgMs = if (fullUpdates > 0) frameMsAccum.toFloat() / fullUpdates else 0f
                // pcm feed health: starved updates + peak level. Tells "music
                // playing but viz dead" apart from preset/render problems.
                val starved = if (fullUpdates > 0) pcmEmpty * 100 / fullUpdates else 0
                AppVizDebugState.stats.value = "%.1f fps · %.1fms · pcm%d%% %.2f".format(fps, avgMs, 100 - starved, pcmPeak)
                Log.d("ProjectMEngine", "%.1f fps · %.1fms · pcm fed %d%% peak %.2f".format(fps, avgMs, 100 - starved, pcmPeak))
                fpsWindowStart = now
                displayFrames = 0L
                fullUpdates = 0L
                frameMsAccum = 0L
                pcmSamples = 0L
                pcmEmpty = 0L
                pcmPeak = 0f
            }
        }

        private var lastUpdateMs = 0L
        private var frameMsAccum = 0L
        private var fullUpdates = 0L
        private var displayFrames = 0L
        private var fpsWindowStart = 0L
        private var pcmSamples = 0L
        private var pcmEmpty = 0L
        private var pcmPeak = 0f

        companion object {
            // 30fps projectM updates: keeps CPU/GPU headroom for music + crossfade
            private const val TARGET_UPDATE_MS = 32L
        }
    }

    /** Attach the preset dir (works before or after surface creation). */
    fun providePresets(dir: File) {
        renderer.setPresetsDir(dir)
        queueEvent { renderer.tryCreate() }
    }

    /** Switch pack: destroy engine state, point at the new dir, recreate. */
    fun switchPack(dir: File) {
        queueEvent {
            renderer.destroyEngine()
            renderer.setPresetsDir(dir)
        }
    }
}
