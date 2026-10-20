package com.castboxtv.app.viz

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.util.AttributeSet
import android.util.Log
import android.view.View
import com.castboxtv.app.dlna.DlnaRendererState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Software-rendered View hosting the shared vze engine (the same core as the
 * browser Visualiser Studio). Each frame: drain PCM from [AppVizAudioFeed],
 * publish track variables + palette roles, run the engine, draw its commands
 * with [VizRenderer].
 *
 * Preset + cover art are pushed from the outside (Compose layer / service);
 * audio rate follows the ExoPlayer tap via AudioProcessor when known.
 */
class VizView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val renderer = VizRenderer(context)
    private var engineOk = false
    private var viewW = 0
    private var viewH = 0
    private var lastEngineMs = 0L
    private var winBuf = FloatArray(0)
    private var fpsFrames = 0L
    private var fpsStart = 0L
    private var lastCover: android.graphics.Bitmap? = null
    private var lastPresetName: String? = null

    var trackTitle: String = ""
    var trackArtist: String = ""
    var trackAlbum: String = ""
    var audioRate: Int = 44100

    private val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val dateFmt = SimpleDateFormat("EEE d MMM", Locale.getDefault())

    /** Loads [presetJson] into the engine; safe to call any time. */
    fun loadPreset(presetJson: String, presetName: String) {
        if (!ensureEngine()) return
        // Embedded data-URL images decode here; the stored JSON keeps them.
        val resolved = VizEmbeddedImages.resolve(presetJson, renderer::setImage)
        if (VizEngine.loadPreset(resolved, CoverPalette.roles())) {
            lastPresetName = presetName
            Log.d(TAG, "preset -> $presetName")
        }
    }

    fun currentPresetName(): String? = lastPresetName

    private fun ensureEngine(): Boolean {
        if (engineOk) return true
        if (!VizEngine.ensureLoaded()) return false
        VizBundledImages.ensure(context, renderer)
        engineOk = true
        return true
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w > 0 && h > 0 && (w != viewW || h != viewH)) {
            viewW = w
            viewH = h
            if (ensureEngine()) VizEngine.setSurface(w, h)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (viewW > 0 && ensureEngine()) VizEngine.setSurface(viewW, viewH)
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!ensureEngine() || viewW <= 0 || viewH <= 0) {
            canvas.drawColor(Color.BLACK)
            if (isAttachedToWindow) postInvalidateOnAnimation()
            return
        }

        val now = android.os.SystemClock.uptimeMillis()

        // ~30fps engine updates (mirrors ProjectM's pacing): analysis runs on
        // a steady clock while the view still presents every vsync.
        if (now - lastEngineMs >= 32L || lastEngineMs == 0L) {
            val edt = if (lastEngineMs == 0L) 16.7f
            else (now - lastEngineMs).coerceIn(1L, 100L).toFloat()
            lastEngineMs = now

            VizEngine.setAudioRate(audioRate)
            feedWindow()
            publishVars()
            publishCover()

            VizEngine.frame(edt)
        }

        canvas.drawColor(Color.BLACK)
        try {
            renderer.render(canvas)
        } catch (e: Exception) {
            Log.w(TAG, "render failed", e)
        }

        if (fpsStart == 0L) fpsStart = now
        fpsFrames++
        if (now - fpsStart >= 1000L) {
            Log.d(TAG, "viz %.1f fps".format(fpsFrames * 1000f / (now - fpsStart).coerceAtLeast(1L)))
            fpsStart = now
            fpsFrames = 0L
        }

        if (isAttachedToWindow) postInvalidateOnAnimation()
    }

    /**
     * Feeds one FULL analysis window every engine tick. The PCM tap drains
     * whatever is queued (often short), so samples accumulate in a sliding
     * window instead — feeding partial windows would zero-pad the tail and
     * flatten the right side of waveforms (the "cut line" bug).
     */
    private fun feedWindow() {
        val w = VizEngine.audioWindow
        if (winBuf.size != w) winBuf = FloatArray(w)
        val chunk = try {
            AppVizAudioFeed.drain(w)
        } catch (_: Exception) {
            FloatArray(0)
        }
        if (chunk.isNotEmpty()) {
            val n = minOf(chunk.size, w)
            winBuf.copyInto(winBuf, 0, n, w)
            chunk.copyInto(winBuf, w - n, 0, n)
        }
        VizEngine.pushAudio(winBuf, w)
    }

    private fun publishVars() {
        val now = Date()
        VizEngine.setVar("title", trackTitle)
        VizEngine.setVar("artist", trackArtist)
        VizEngine.setVar("album", trackAlbum)
        VizEngine.setVar("clock", clockFmt.format(now))
        VizEngine.setVar("time", clockFmt.format(now))
        VizEngine.setVar("date", dateFmt.format(now))
        val pos = DlnaRendererState.currentPosition.coerceAtLeast(0)
        val dur = DlnaRendererState.duration.coerceAtLeast(0)
        VizEngine.setVar("position", mmss(pos / 1000))
        VizEngine.setVar("duration", mmss(dur / 1000))
        VizEngine.setVar("positionSec", pos / 1000f)
        VizEngine.setVar("durationSec", dur / 1000f)
        VizEngine.setVar("remaining", if (dur > 0) "-" + mmss(maxOf(0, dur - pos) / 1000) else "")
        VizEngine.setVar("playing", if (DlnaRendererState.transportState ==
            org.fourthline.cling.support.model.TransportState.PLAYING) "1" else "0")
        VizEngine.setVar("source", "dlna")
        VizEngine.setVar("controller", "castbox")
    }

    private fun publishCover() {
        val cover = VizPresets.coverBitmap()
        if (cover !== lastCover) {
            lastCover = cover
            if (cover != null) {
                renderer.setImage(VizPresets.COVER_ID, cover)
                VizEngine.coverSet(VizPresets.COVER_ID)
            }
            // New artwork (or first art after load): re-theme live when the
            // preset follows the cover palette. Fixed palettes are untouched.
            VizEngine.refreshCoverPalette(CoverPalette.roles())
        }
    }

    private fun mmss(totalSeconds: Long): String {
        val s = totalSeconds.coerceAtLeast(0)
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }

    companion object {
        private const val TAG = "VizView"
    }
}
