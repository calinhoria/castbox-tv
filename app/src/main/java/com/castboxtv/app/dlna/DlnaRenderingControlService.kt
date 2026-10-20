package com.castboxtv.app.dlna

import android.content.Context
import android.media.AudioManager
import android.util.Log
import org.fourthline.cling.model.types.UnsignedIntegerFourBytes
import org.fourthline.cling.model.types.UnsignedIntegerTwoBytes
import org.fourthline.cling.support.model.Channel
import org.fourthline.cling.support.renderingcontrol.AbstractAudioRenderingControl
import org.fourthline.cling.support.renderingcontrol.RenderingControlException

class DlnaRenderingControlService : AbstractAudioRenderingControl() {

    override fun getMute(instanceId: UnsignedIntegerFourBytes, channel: String): Boolean {
        val muted = audioManager?.isStreamMute(AudioManager.STREAM_MUSIC) ?: false
        Log.d("DLNA", "getMute channel=$channel muted=$muted")
        return muted
    }

    override fun setMute(instanceId: UnsignedIntegerFourBytes, channel: String, newMute: Boolean) {
        Log.d("DLNA", "setMute channel=$channel mute=$newMute")
        audioManager?.let { am ->
            am.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                if (newMute) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE,
                0
            )
        }
    }

    override fun getVolume(instanceId: UnsignedIntegerFourBytes, channel: String): UnsignedIntegerTwoBytes {
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        val vol = audioManager?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: 0
        val maxVol = audioManager?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: 15
        val percent = if (maxVol > 0) (vol * 100 / maxVol) else 0
        Log.d("DLNA", "getVolume channel=$channel raw=$vol/$maxVol percent=$percent")
        return UnsignedIntegerTwoBytes(percent.toLong())
    }

    override fun setVolume(instanceId: UnsignedIntegerFourBytes, channel: String, newVolume: UnsignedIntegerTwoBytes) {
        val maxVol = audioManager?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: 15
        val targetVol = (newVolume.value.toInt() * maxVol / 100).coerceIn(0, maxVol)
        Log.d("DLNA", "setVolume channel=$channel percent=${newVolume.value} raw=$targetVol/$maxVol")
        audioManager?.setStreamVolume(AudioManager.STREAM_MUSIC, targetVol, 0)
        val percent = newVolume.value.toInt()
        DlnaRendererState.overlayVolume = percent
        DlnaRendererState.overlayVolumeTimestamp = System.currentTimeMillis()
        volumeChangeListener?.invoke(percent)
    }

    override fun getCurrentChannels(): Array<Channel> {
        return arrayOf(Channel.Master)
    }

    override fun getCurrentInstanceIds(): Array<UnsignedIntegerFourBytes> {
        return arrayOf(UnsignedIntegerFourBytes(0))
    }

    companion object {
        @Volatile
        var audioManager: AudioManager? = null
            private set

        @Volatile
        var volumeChangeListener: ((Int) -> Unit)? = null

        fun init(context: Context) {
            audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            Log.d("DLNA", "AudioManager initialized")
        }
    }
}
