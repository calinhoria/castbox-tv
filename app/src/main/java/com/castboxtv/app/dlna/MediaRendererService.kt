package com.castboxtv.app.dlna

import android.util.Log
import org.fourthline.cling.model.types.ServiceType
import org.fourthline.cling.model.types.UnsignedIntegerFourBytes
import org.fourthline.cling.support.avtransport.AbstractAVTransportService
import org.fourthline.cling.support.avtransport.AVTransportErrorCode
import org.fourthline.cling.support.avtransport.AVTransportException
import org.fourthline.cling.support.model.DeviceCapabilities
import org.fourthline.cling.support.model.MediaInfo
import org.fourthline.cling.support.model.PositionInfo
import org.fourthline.cling.support.model.StorageMedium
import org.fourthline.cling.support.model.TransportAction
import org.fourthline.cling.support.model.TransportInfo
import org.fourthline.cling.support.model.TransportSettings
import org.fourthline.cling.support.model.TransportState
import org.fourthline.cling.support.model.TransportStatus

object DlnaRendererState {
    @Volatile var callback: MediaPlayerCallback? = null
    @Volatile var currentURI: String = ""
    @Volatile var currentMeta: String = ""
    @Volatile var transportState: TransportState = TransportState.NO_MEDIA_PRESENT
    @Volatile var transportStatus: TransportStatus = TransportStatus.OK
    @Volatile var transportSpeed: String = "1"
    @Volatile var currentPosition: Long = 0
    @Volatile var duration: Long = 0
    @Volatile var controllerName: String = ""
    @Volatile var upnpService: org.fourthline.cling.UpnpService? = null
    @Volatile var overlayVolume: Int = 0
    @Volatile var overlayVolumeTimestamp: Long = 0
    @Volatile var lastControllerActionTime: Long = 0
    @Volatile var currentTitle: String = ""
    @Volatile var currentArtist: String = ""
    @Volatile var currentAlbum: String = ""
    @Volatile var currentArtworkUrl: String? = null
    @Volatile var userAction: String = "none"
    @Volatile var audioSessionId: Int = 0
}

interface MediaPlayerCallback {
    fun onSetURI(uri: String, meta: String)
    fun onSetNextURI(uri: String, meta: String)
    fun onPlay()
    fun onPause()
    fun onStop()
    fun onSeek(positionMs: Long)
    fun getCurrentPosition(): Long
    fun getDuration(): Long
}

class DlnaAvTransportService : AbstractAVTransportService() {

    override fun setAVTransportURI(instanceId: UnsignedIntegerFourBytes, currentURI: String, metaData: String) {
        Log.d("DLNA", "SetAVTransportURI received")
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        DlnaRendererState.currentURI = currentURI
        DlnaRendererState.currentMeta = metaData
        DlnaRendererState.transportState = TransportState.STOPPED
        DlnaRendererState.userAction = "none"

        // Identify controller: try URL param first (most DLNA apps put c=<name> in URL)
        try {
            val urlParams = currentURI.substringAfter("?", "").substringBefore("#")
            if (urlParams.isNotEmpty()) {
                val params = urlParams.split("&").associate {
                    val k = it.substringBefore("=")
                    val v = it.substringAfter("=")
                    k to v
                }
                val clientName = params["c"] ?: params["client"]
                if (!clientName.isNullOrEmpty()) {
                    DlnaRendererState.controllerName = clientName
                    Log.d("DLNA", "Controller from URL: $clientName")
                }
            }
        } catch (e: Exception) {
            Log.e("DLNA", "Failed to parse controller from URL", e)
        }

        // Fallback: try UPnP registry
        if (DlnaRendererState.controllerName.isEmpty()) {
            try {
                val service = DlnaRendererState.upnpService
                val localUdn = service?.registry?.localDevices?.firstOrNull()?.identity?.udn
                val cdType = ServiceType("schemas-upnp-org", "ContentDirectory")
                val remote = service?.registry?.remoteDevices?.firstOrNull { dev ->
                    dev.identity?.udn != localUdn &&
                    dev.findServices(cdType).isNotEmpty() &&
                    dev.details?.friendlyName?.isNotEmpty() == true
                }
                val name = remote?.details?.friendlyName
                if (!name.isNullOrEmpty()) {
                    DlnaRendererState.controllerName = name
                    Log.d("DLNA", "Controller from registry: $name")
                }
            } catch (e: Exception) {
                Log.e("DLNA", "Failed to get controller from registry", e)
            }
        }

        DlnaRendererState.callback?.onSetURI(currentURI, metaData)
    }

    override fun setNextAVTransportURI(instanceId: UnsignedIntegerFourBytes, nextURI: String, nextMetaData: String) {
        Log.d("DLNA", "SetNextAVTransportURI received")
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        DlnaRendererState.callback?.onSetNextURI(nextURI, nextMetaData)
    }

    override fun getMediaInfo(instanceId: UnsignedIntegerFourBytes): MediaInfo {
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        return MediaInfo(
            DlnaRendererState.currentURI,
            DlnaRendererState.currentMeta,
            UnsignedIntegerFourBytes(0),
            msToHMMSS(DlnaRendererState.duration),
            StorageMedium.NETWORK
        )
    }

    override fun getTransportInfo(instanceId: UnsignedIntegerFourBytes): TransportInfo {
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        Log.d("DLNA", "getTransportInfo called, state=${DlnaRendererState.transportState}")
        return try {
            TransportInfo(DlnaRendererState.transportState, DlnaRendererState.transportStatus, DlnaRendererState.transportSpeed)
        } catch (e: Exception) {
            Log.e("DLNA", "getTransportInfo error", e)
            throw e
        }
    }

    override fun getPositionInfo(instanceId: UnsignedIntegerFourBytes): PositionInfo {
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        val relTime = msToHMMSS(DlnaRendererState.currentPosition)
        val absTime = msToHMMSS(DlnaRendererState.currentPosition)
        val dur = msToHMMSS(DlnaRendererState.duration)
        Log.d("DLNA", "getPositionInfo relTime=$relTime dur=$dur")
        return PositionInfo(
            1L,
            dur,
            DlnaRendererState.currentMeta,
            DlnaRendererState.currentURI,
            relTime,
            absTime,
            0,
            0
        )
    }

    override fun getDeviceCapabilities(instanceId: UnsignedIntegerFourBytes): DeviceCapabilities {
        return DeviceCapabilities(emptyArray())
    }

    override fun getTransportSettings(instanceId: UnsignedIntegerFourBytes): TransportSettings {
        return TransportSettings()
    }

    override fun stop(instanceId: UnsignedIntegerFourBytes) {
        Log.d("DLNA", "Stop")
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        DlnaRendererState.transportState = TransportState.STOPPED
        DlnaRendererState.callback?.onStop()
    }

    override fun play(instanceId: UnsignedIntegerFourBytes, speed: String) {
        Log.d("DLNA", "Play speed=$speed")
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        DlnaRendererState.transportSpeed = speed
        DlnaRendererState.transportState = TransportState.PLAYING
        DlnaRendererState.callback?.onPlay()
    }

    override fun pause(instanceId: UnsignedIntegerFourBytes) {
        Log.d("DLNA", "Pause")
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        DlnaRendererState.transportState = TransportState.PAUSED_PLAYBACK
        DlnaRendererState.callback?.onPause()
    }

    override fun record(instanceId: UnsignedIntegerFourBytes) {
        throw AVTransportException(AVTransportErrorCode.RECORDQUALITYMODE_NOT_SUPPORTED, "Record not supported")
    }

    override fun seek(instanceId: UnsignedIntegerFourBytes, unit: String, target: String) {
        Log.d("DLNA", "Seek unit=$unit target=$target")
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        val posMs = parseTimeToMs(target)
        DlnaRendererState.callback?.onSeek(posMs)
    }

    override fun next(instanceId: UnsignedIntegerFourBytes) {}
    override fun previous(instanceId: UnsignedIntegerFourBytes) {}
    override fun setPlayMode(instanceId: UnsignedIntegerFourBytes, newPlayMode: String) {}
    override fun setRecordQualityMode(instanceId: UnsignedIntegerFourBytes, newRecordQualityMode: String) {}

    override fun getCurrentTransportActions(instanceId: UnsignedIntegerFourBytes): Array<TransportAction> {
        return when (DlnaRendererState.transportState) {
            TransportState.PLAYING -> arrayOf(TransportAction.Play, TransportAction.Pause, TransportAction.Stop, TransportAction.Seek)
            TransportState.PAUSED_PLAYBACK -> arrayOf(TransportAction.Play, TransportAction.Stop, TransportAction.Seek)
            TransportState.STOPPED -> arrayOf(TransportAction.Play, TransportAction.Seek)
            else -> emptyArray()
        }
    }

    override fun getCurrentInstanceIds(): Array<UnsignedIntegerFourBytes> {
        return arrayOf(UnsignedIntegerFourBytes(0))
    }

    private fun parseTimeToMs(time: String): Long {
        return try {
            val parts = time.split(":")
            if (parts.size == 3) {
                val h = parts[0].toLongOrNull() ?: 0
                val m = parts[1].toLongOrNull() ?: 0
                val sParts = parts[2].split(".")
                val s = sParts[0].toLongOrNull() ?: 0
                val ms = if (sParts.size > 1) sParts[1].toLongOrNull() ?: 0 else 0
                (h * 3600 + m * 60 + s) * 1000 + ms
            } else {
                time.toLongOrNull() ?: 0
            }
        } catch (_: Exception) { 0 }
    }

    private fun msToHMMSS(ms: Long): String {
        if (ms <= 0) return "00:00:00"
        val totalSec = ms / 1000
        return String.format("%02d:%02d:%02d", totalSec / 3600, (totalSec % 3600) / 60, totalSec % 60)
    }
}
