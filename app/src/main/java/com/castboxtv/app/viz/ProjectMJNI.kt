package com.castboxtv.app.viz

/**
 * JNI bridge to the native projectM library (libprojectM.so, MilkDrop
 * engine). One instance renders into the GLSurfaceView owned by
 * [ProjectMView]; PCM comes from the ExoPlayer tap via [AppVizAudioFeed].
 */
object ProjectMJNI {

    @Volatile var loaded: Boolean = false
        private set

    fun ensureLoaded(): Boolean {
        if (loaded) return true
        return try {
            System.loadLibrary("jniwrapper")
            loaded = true
            true
        } catch (e: UnsatisfiedLinkError) {
            android.util.Log.e("ProjectMJNI", "native lib missing", e)
            false
        }
    }

    /** Creates/destroys the engine. Returns preset count (0 on failure). */
    external fun create(width: Int, height: Int, presetsDir: String): Int

    external fun destroy()

    external fun resize(width: Int, height: Int)

    /** Full render pass: projectM update + downsample composite + blit. */
    external fun renderFrame()

    /** Cheap pass: re-blit last output texture without projectM update. */
    external fun blitOnly()

    /** Mono float samples -1..1 (v4 API duplicates channels internally). */
    external fun addPcmFloat(pcmData: FloatArray, nsamples: Int)

    /** Preset display name (".milk" stripped) at sorted index, "" if OOB. */
    external fun presetNameAt(index: Int): String

    external fun selectPreset(index: Int, hardCut: Boolean): Boolean

    /** Lock stops the engine's own preset timer from switching away. */
    external fun setPresetLocked(locked: Boolean)

}
