package com.castboxtv.app.viz

/**
 * Live PCM tap for the app visualization (projectM engine).
 * Fed from [AudioProcessor] (ExoPlayer decoded PCM, pre-volume),
 * drained by ProjectMView at ~30fps and forwarded to the engine's analyser.
 *
 * The audio-callback thread must never wait on this: writes happen in
 * batches (one lock per decoded buffer, not per sample) and are bounded.
 */
object AppVizAudioFeed {

    private const val CAP = 16384

    // Plain values shared with AudioProcessor via Feed for scratch sizing
    object Feed {
        const val CAP = 16384
        // No decimation: projectM's analyser needs a real-time mono stream
        // (~44.1k samples/s). Draining 2048 samples at ~30fps already demands
        // ~61k/s; any downsampling starves the beat detector. Keep at 1.
        const val DOWNSAMPLE = 1
    }

    private val buf = FloatArray(CAP)
    private var head = 0
    private var tail = 0
    private var count = 0
    private val lock = Any()

    /** Queued samples still waiting to be drained (for diagnostics). */
    fun pending(): Int = synchronized(lock) { count }

    /** Append [length] mono samples (already channel-averaged by the caller). */
    fun offerBlock(mono: FloatArray, length: Int) {
        if (length <= 0) return
        synchronized(lock) {
            val n = minOf(length, mono.size)
            for (i in 0 until n) {
                buf[head] = mono[i].coerceIn(-1f, 1f)
                head = (head + 1) % CAP
                if (count < CAP) count++ else tail = (tail + 1) % CAP
            }
        }
    }

    /** Drain up to [max] oldest samples. Returns possibly-empty array. */
    fun drain(max: Int): FloatArray {
        synchronized(lock) {
            if (count > 0) {
                val n = minOf(max, count)
                val out = FloatArray(n)
                for (i in 0 until n) {
                    out[i] = buf[tail]
                    tail = (tail + 1) % CAP
                }
                count -= n
                return out
            }
        }
        // No live PCM (nothing playing): synthesize a music-like signal so
        // benchmarks exercise the audio-reactive paths. Pure data — never
        // audible. Real music always wins (buffer non-empty above).
        if (!mockEnabled) return FloatArray(0)
        val n = max.coerceAtLeast(0)
        val out = FloatArray(n)
        val i0 = synchronized(lock) {
            val i = synthIndex
            synthIndex += n
            i
        }
        for (k in 0 until n) {
            out[k] = synthSample(i0 + k).toFloat()
        }
        return out
    }

    /**
     * Silent test signal: 120 BPM kick + bass + mids + offbeat hats.
     * Data-only for the projectM analyser; never routed to speakers.
     */
    @Volatile var mockEnabled: Boolean = false

    private var synthIndex = 0L
    private const val SYNTH_SR = 44100.0

    private fun synthSample(i: Long): Double {
        val t = i / SYNTH_SR
        val twoPi = 2.0 * Math.PI
        val beatPhase = (t * 2.0) % 1.0 // 120 BPM
        val kickEnv = maxOf(0.0, 1.0 - beatPhase * 5.0)
        var s = 0.9 * Math.sin(twoPi * 55.0 * t) * kickEnv
        s += 0.25 * Math.sin(twoPi * 110.0 * t)
        s += 0.18 * Math.sin(twoPi * 82.4 * t)
        s += 0.10 * Math.sin(twoPi * 440.0 * t + 1.7 * Math.sin(twoPi * 5.3 * t))
        val offPhase = (t * 2.0 + 0.5) % 1.0
        // deterministic pseudo-noise hat (no RNG state to guard)
        val nz = ((i * 2654435761L ushr 32) % 1000L) / 1000.0 * 2.0 - 1.0
        s += 0.07 * nz * maxOf(0.0, 1.0 - offPhase * 8.0)
        return s.coerceIn(-1.0, 1.0)
    }
}
