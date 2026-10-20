package com.castboxtv.app.dlna

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import androidx.media3.session.MediaSession
import com.castboxtv.app.MainActivity
import com.castboxtv.app.R
import com.castboxtv.app.audio.CrossfadeAlgorithm
import com.castboxtv.app.viz.AudioProcessor
import com.castboxtv.app.viz.CoverPalette
import com.castboxtv.app.settings.SettingsManager
import com.castboxtv.app.web.WebInterfaceServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.fourthline.cling.android.AndroidUpnpService
import org.fourthline.cling.android.AndroidUpnpServiceImpl
import org.fourthline.cling.binding.annotations.AnnotationLocalServiceBinder
import org.fourthline.cling.model.DefaultServiceManager
import org.fourthline.cling.model.meta.DeviceDetails
import org.fourthline.cling.model.meta.DeviceIdentity
import org.fourthline.cling.model.meta.Icon
import org.fourthline.cling.model.meta.LocalDevice
import org.fourthline.cling.model.meta.LocalService
import org.fourthline.cling.model.meta.ManufacturerDetails
import org.fourthline.cling.model.meta.ModelDetails
import org.fourthline.cling.model.types.DeviceType
import org.fourthline.cling.model.types.UDN
import org.fourthline.cling.support.avtransport.AbstractAVTransportService
import org.fourthline.cling.support.connectionmanager.ConnectionManagerService
import org.fourthline.cling.support.model.TransportState
import org.fourthline.cling.support.model.TransportStatus
import org.fourthline.cling.support.renderingcontrol.AbstractAudioRenderingControl
import org.xml.sax.InputSource
import java.io.StringReader
import java.util.UUID
import javax.xml.parsers.DocumentBuilderFactory

class DlnaMediaService : Service(), MediaPlayerCallback {

    private val binder = LocalBinder()
    private var upnpService: AndroidUpnpService? = null
    private var exoPlayer: ExoPlayer? = null
    private var nextExoPlayer: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private var settingsManager: SettingsManager? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var localDevice: LocalDevice? = null
    private var positionSyncRunnable: Runnable? = null

    var onTrackChanged: ((title: String, artist: String, album: String, artworkUrl: String?) -> Unit)? = null
    var onPlaybackStateChanged: ((isPlaying: Boolean) -> Unit)? = null
    var onDisconnected: (() -> Unit)? = null

    private var currentTitle = ""
    private var currentArtist = ""
    private var currentAlbum = ""
    private var currentArtworkUrl: String? = null

    private var currentUri = ""
    private var nextUri = ""
    private var nextMeta = ""
    private var nextTitle = ""
    private var nextArtist = ""
    private var nextAlbum = ""
    private var nextArtworkUrl: String? = null

    private var stoppedUri = ""
    private var stoppedPositionMs = 0L
    private var stoppedAtMs = 0L
    private val STOP_RESUME_WINDOW_MS = 10_000L
    // Set on OUR transitions (crossfade finish / gapless advance). A Stop inside
    // the window is a controller racing us, not a user request: ignore one.
    private var lastTransitionMs = 0L
    private var stopIgnoredForTransitionMs = -1L
    private val STOP_IGNORE_WINDOW_MS = 5_000L

    private var pendingNextUri = ""
    private var pendingNextMeta = ""

    private var crossfadeJob: Job? = null
    @Volatile private var crossfadeActive = false
    // Bump on every topology change (fade start/cancel). finishCrossfade captures
    // the value and its posted block no-ops when stale, so a fade that was
    // cancelled (skip/jump during the 6s window) can never swap players twice.
    private var crossfadeGeneration = 0
    private var crossfadeWatcher: Runnable? = null
    @Volatile private var lastCrossfadeEndTimeMs: Long = 0
    private var lastCrossfadeUri: String = ""
    private var lastCrossfadeDurationMs: Long = 0

    private var idleHandler: Runnable? = null
    private val IDLE_TIMEOUT_MS = 10_000L
    private var disconnectChecker: Runnable? = null
    private val DISCONNECT_TIMEOUT_MS = 60_000L
    @Volatile private var sentToBackground = false
    @Volatile private var wasDisconnected = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var upnpServiceConnection: ServiceConnection? = null
    private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null
    private var webServer: WebInterfaceServer? = null

    inner class LocalBinder : Binder() {
        fun getService(): DlnaMediaService = this@DlnaMediaService
    }

    override fun onBind(intent: Intent): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        settingsManager = SettingsManager(this)
        com.castboxtv.app.viz.AppVizAudioFeed.mockEnabled = settingsManager?.appVizMockAudio == true
        DlnaRenderingControlService.init(this)
        DlnaRendererState.callback = this

        webServer = WebInterfaceServer(this, 8092).apply { start() }

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "castboxtv:playback").apply {
            acquire() // keep CPU alive while service runs; released in onDestroy
        }
        Log.d("DLNA", "WakeLock acquired")

        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        multicastLock = wm.createMulticastLock("castboxtv:ssdp").apply {
            setReferenceCounted(false)
            acquire()
        }
        Log.d("DLNA", "MulticastLock acquired")

        exoPlayer = buildPlayer()
        nextExoPlayer = buildPlayer()

        mediaSession = MediaSession.Builder(this, exoPlayer!!).build()

        positionSyncRunnable = object : Runnable {
            override fun run() {
                exoPlayer?.let { player ->
                    if (player.isPlaying || player.playbackState == Player.STATE_READY) {
                        DlnaRendererState.currentPosition = player.currentPosition.coerceAtLeast(0)
                        DlnaRendererState.duration = player.duration.coerceAtLeast(0)
                    }
                }
                mainHandler.postDelayed(this, 500)
            }
        }
        mainHandler.post(positionSyncRunnable!!)

        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification("Waiting for connection..."))
        connectUpnp()
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL,
                "DLNA Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "DLNA Audio Renderer"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(status: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL)
            .setContentTitle(settingsManager?.displayName ?: "CastBox TV")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun updateNotification() {
        val isPlaying = exoPlayer?.isPlaying == true
        val title = currentTitle.ifEmpty { "No Media" }
        val status = if (isPlaying) "Playing: $title" else "Paused: $title"
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(status))
    }

    fun initUpnp(upnpService: AndroidUpnpService) {
        val changed = this.upnpService == null || this.upnpService !== upnpService
        this.upnpService = upnpService
        DlnaRendererState.upnpService = upnpService.get()
        if (changed || localDevice == null) registerDevice()
    }

    private fun connectUpnp() {
        if (upnpService != null) return
        try {
            startService(Intent(this, AndroidUpnpServiceImpl::class.java))
            val conn = object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                    val androidUpnp = service as? AndroidUpnpService ?: return
                    initUpnp(androidUpnp)
                    SseManager.registerServlets()
                }
                override fun onServiceDisconnected(name: ComponentName?) {
                    upnpService = null
                    DlnaRendererState.upnpService = null
                }
            }
            upnpServiceConnection = conn
            bindService(Intent(this, AndroidUpnpServiceImpl::class.java), conn, Context.BIND_AUTO_CREATE)
        } catch (e: Exception) {
            Log.e("DLNA", "Failed to connect UPnP service", e)
        }
    }

    @Suppress("DEPRECATION")
    private fun wakeUpIfNeeded() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isInteractive) {
            Log.d("DLNA", "Device already interactive")
            return
        }
        try {
            val wakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
                "castboxtv:wakeup"
            )
            wakeLock.acquire(10_000)
            Log.d("DLNA", "Waking screen for DLNA playback")
        } catch (e: Exception) {
            Log.e("DLNA", "Failed to wake screen", e)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun registerDevice() {
        try {
            val identity = DeviceIdentity(UDN(settingsManager?.deviceUdn ?: UUID.randomUUID()))
            val deviceType = DeviceType("schemas-upnp-org", "MediaRenderer", 1)

            val icon = try {
                val data = BitmapFactory.decodeResource(resources, R.drawable.ic_launcher_foreground)
                val baos = java.io.ByteArrayOutputStream()
                data.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, baos)
                Icon("image/png", 48, 48, 24, "ic_launcher", baos.toByteArray())
            } catch (_: Exception) { null }

            val deviceDetails = DeviceDetails(
                settingsManager?.displayName ?: "CastBox TV",
                ManufacturerDetails("CastBox"),
                ModelDetails("Audio Renderer", "1.0", "1.0")
            )

            val binder = AnnotationLocalServiceBinder()
            val avTransportLocalService = binder.read(AbstractAVTransportService::class.java)

            @Suppress("UNCHECKED_CAST")
            (avTransportLocalService as LocalService<DlnaAvTransportService>).setManager(
                DefaultServiceManager(avTransportLocalService, DlnaAvTransportService::class.java)
            )

            val renderingControlLocalService = binder.read(AbstractAudioRenderingControl::class.java)
            @Suppress("UNCHECKED_CAST")
            (renderingControlLocalService as LocalService<DlnaRenderingControlService>).setManager(
                DefaultServiceManager(renderingControlLocalService, DlnaRenderingControlService::class.java)
            )

            val connectionManagerLocalService = binder.read(ConnectionManagerService::class.java)
            @Suppress("UNCHECKED_CAST")
            (connectionManagerLocalService as LocalService<DlnaConnectionManagerService>).setManager(
                DefaultServiceManager(connectionManagerLocalService, DlnaConnectionManagerService::class.java)
            )

            localDevice = LocalDevice(
                identity, deviceType, deviceDetails, icon,
                arrayOf(
                    avTransportLocalService,
                    renderingControlLocalService,
                    connectionManagerLocalService
                ) as Array<LocalService<*>>
            )

            upnpService?.registry?.addDevice(localDevice)
            Log.d("DLNA", "Device registered: ${settingsManager?.displayName}")
        } catch (e: Exception) {
            Log.e("DLNA", "Failed to register device", e)
        }
    }

    fun unregisterDevice() {
        localDevice?.let { upnpService?.registry?.removeDevice(it) }
        localDevice = null
    }

    fun reregisterDevice() {
        unregisterDevice()
        registerDevice()
    }

    fun playUrl(url: String, title: String, artist: String, album: String, artworkUrl: String?) {
        cancelCrossfade()
        stopAndClearNextPlayer()
        stoppedUri = ""
        stoppedPositionMs = 0L
        stoppedAtMs = 0L
        currentUri = url
        currentTitle = cleanTitle(title, artist)
        currentArtist = artist
        currentAlbum = album
        currentArtworkUrl = artworkUrl
        DlnaRendererState.currentTitle = currentTitle
        DlnaRendererState.currentArtist = currentArtist
        DlnaRendererState.currentAlbum = currentAlbum
        DlnaRendererState.currentArtworkUrl = currentArtworkUrl

        exoPlayer?.volume = 1f
        exoPlayer?.setMediaItem(MediaItem.fromUri(Uri.parse(url)))
        exoPlayer?.prepare()
        exoPlayer?.play()

        DlnaRendererState.transportState = TransportState.PLAYING
        onTrackChanged?.invoke(title, artist, album, artworkUrl)
        serviceScope.launch { CoverPalette.updateFromUrl(artworkUrl) }
        updateNotification()
    }

    fun togglePlayPause() {
        mainHandler.post {
            exoPlayer?.let { player ->
                if (player.isPlaying) player.pause() else player.play()
            }
        }
    }

    fun getCurrentVolume(): Int {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val curVol = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        return if (maxVol > 0) (curVol * 100) / maxVol else 0
    }

    // MediaPlayerCallback
    override fun onSetURI(uri: String, meta: String) {
        // The UPnP/DLNA callback arrives on a binder thread, but ExoPlayer may
        // only be touched on the app's main thread — reading playbackState or
        // currentMediaItem elsewhere throws IllegalStateException. That silently
        // made the duplicate guard below always see state=null/loadedMatch=false,
        // fall through to a full re-prepare, and restart the just-crossfaded
        // track from 0 ("song restarts after the crossfade"). Do it all on main.
        mainHandler.post { handleSetUri(uri, meta) }
    }

    private fun handleSetUri(uri: String, meta: String) {
        // Controller advances playlist explicitly after track end even when we
        // already crossfaded/gapless-advanced into that track. Restarting the
        // already-playing URI from 0 is the "crossfade replays next song"
        // bug, so ignore SetURI for the track we're already playing.
        // Never re-prepare a healthy loaded item: a duplicate SetURI must not
        // restart the current track, no matter how early in the track it arrives
        // (the old pos>1500ms check still restarted it in the first 1.5s).
        if (uri.isNotEmpty() && (uri == currentUri || uri == lastCrossfadeUri)) {
            val pos = try { exoPlayer?.currentPosition ?: 0 } catch (_: Exception) { 0 }
            val state = try { exoPlayer?.playbackState } catch (_: Exception) { null }
            val loadedUri = try { exoPlayer?.currentMediaItem?.localConfiguration?.uri?.toString() } catch (_: Exception) { null }
            val playable = state == Player.STATE_READY || state == Player.STATE_BUFFERING
            if (loadedUri == uri && playable) {
                Log.w("DLNA", "ignoring duplicate SetURI for loaded track (pos=${pos}ms)")
                DlnaRendererState.currentURI = uri
                DlnaRendererState.currentMeta = meta
                DlnaRendererState.transportState = TransportState.PLAYING
                mainHandler.post { exoPlayer?.play() }
                return
            }
            Log.w("DLNA", "duplicate SetURI but item not playable (loadedMatch=${loadedUri == uri}, state=$state), full handling")
        }
        // SetURI for the queued next track arriving mid-crossfade: we are
        // already fading into it, so keep the crossfade running.
        if (crossfadeActive && uri.isNotEmpty() && uri == nextUri) {
            Log.w("DLNA", "ignoring SetURI for next track mid-crossfade")
            DlnaRendererState.currentURI = uri
            DlnaRendererState.currentMeta = meta
            DlnaRendererState.transportState = TransportState.PLAYING
            return
        }
        cancelIdleTimer()
        startDisconnectChecker()
        wasDisconnected = false
        sentToBackground = false
        wakeUpIfNeeded()
        bringToForeground()
        cancelCrossfade()
        stopAndClearNextPlayer()
        currentUri = uri

        // Stop-race resume: if this URI is what we just stopped moments ago
        // (controller racing our crossfade finish), pick up where it was
        // instead of restarting from 0.
        val resumePos = if (uri == stoppedUri &&
            System.currentTimeMillis() - stoppedAtMs < STOP_RESUME_WINDOW_MS &&
            stoppedPositionMs > 2000
        ) {
            stoppedPositionMs
        } else 0L
        stoppedUri = ""
        stoppedPositionMs = 0L
        stoppedAtMs = 0L

        val parsed = parseDidlLite(meta)
        currentArtist = parsed["artist"] ?: ""
        currentAlbum = parsed["album"] ?: ""
        currentTitle = cleanTitle(parsed["title"] ?: extractTitleFromUri(uri), currentArtist)
        currentArtworkUrl = parsed["artwork"]
        Log.d("DLNA", "Current song: $currentTitle - $currentArtist")
        DlnaRendererState.currentTitle = currentTitle
        DlnaRendererState.currentArtist = currentArtist
        DlnaRendererState.currentAlbum = currentAlbum
        DlnaRendererState.currentArtworkUrl = currentArtworkUrl
        serviceScope.launch { CoverPalette.updateFromUrl(currentArtworkUrl) }

        mainHandler.post {
            try {
                exoPlayer?.volume = 1f
                val mediaItem = MediaItem.fromUri(Uri.parse(uri))
                exoPlayer?.setMediaItem(mediaItem)
                exoPlayer?.prepare()
                exoPlayer?.play()
                if (resumePos > 0) {
                    exoPlayer?.seekTo(resumePos)
                    Log.w("DLNA", "resumed stopped track at ${resumePos}ms instead of restarting")
                }
                Log.d("DLNA", "onSetURI: prepare + play called")
            } catch (e: Exception) {
                Log.e("DLNA", "onSetURI: prepare failed", e)
            }
        }
        DlnaRendererState.transportState = TransportState.STOPPED
        DlnaRendererState.currentPosition = 0
        DlnaRendererState.duration = 0
        mainHandler.post {
            Log.d("DLNA", "onTrackChanged callback: title=$currentTitle, artist=$currentArtist, artwork=${currentArtworkUrl?.take(60)}")
            onTrackChanged?.invoke(currentTitle, currentArtist, currentAlbum, currentArtworkUrl)
        }
    }

    override fun onPlay() {
        Log.d("DLNA", "onPlay")
        wakeUpIfNeeded()
        bringToForeground()
        mainHandler.post {
            exoPlayer?.play()
            if (crossfadeActive) nextExoPlayer?.play()
        }
    }

    override fun onPause() {
        Log.d("DLNA", "onPause")
        mainHandler.post {
            exoPlayer?.pause()
            if (crossfadeActive) nextExoPlayer?.pause()
        }
    }

    override fun onStop() {
        Log.d("DLNA", "onStop")
        val now = System.currentTimeMillis()
        // A controller racing our crossfade finish sends Stop as its own track
        // advance within moments of OUR transition. Ignoring one such Stop keeps
        // playback seamless — the follow-up SetURI(same) then hits the duplicate
        // guard while the item is still loaded. A second Stop (or one outside
        // the window) always executes, so a genuine user stop is never lost.
        if (now - lastTransitionMs < STOP_IGNORE_WINDOW_MS && stopIgnoredForTransitionMs != lastTransitionMs) {
            stopIgnoredForTransitionMs = lastTransitionMs
            Log.w("DLNA", "ignoring Stop within transition window")
            return
        }
        cancelCrossfade()
        stopAndClearNextPlayer()
        stopCrossfadeWatcher()
        mainHandler.post {
            // Remember what was playing for the stop-race resume fallback.
            if (currentUri.isNotEmpty()) {
                stoppedUri = currentUri
                stoppedPositionMs = try { exoPlayer?.currentPosition?.coerceAtLeast(0) ?: 0 } catch (_: Exception) { 0 }
                stoppedAtMs = System.currentTimeMillis()
            }
            exoPlayer?.stop()
            exoPlayer?.clearMediaItems()
        }
    }

    fun skipToNext() {
        Log.d("DLNA", "skipToNext")
        DlnaRendererState.lastControllerActionTime = System.currentTimeMillis()
        if (nextUri.isNotEmpty()) {
            cancelCrossfade()
            stopCrossfadeWatcher()
            crossfadeActive = false
            advanceToNext()
            return
        }
        mainHandler.post {
            exoPlayer?.let { player ->
                player.seekTo(player.duration)
                player.stop()
            }
            DlnaRendererState.transportState = TransportState.STOPPED
            DlnaRendererState.currentPosition = 0
        }
    }

    /**
     * Gapless advance: swap in the prepared next player instantly (no fade)
     * and promote next-track metadata to current. Callers must ensure a next
     * URI is queued; the swap is skipped otherwise.
     */
    private fun advanceToNext() {
        if (nextUri.isEmpty()) return
        stopCrossfadeWatcher()
        val nextPlayer = nextExoPlayer ?: return
        Log.d("DLNA", "advanceToNext: $nextUri")
        mainHandler.post {
            val oldCurrent = exoPlayer
            try {
                if (nextPlayer.playbackState != Player.STATE_READY) {
                    nextPlayer.setMediaItem(MediaItem.fromUri(Uri.parse(nextUri)))
                    nextPlayer.prepare()
                }
                nextPlayer.volume = 1f
                nextPlayer.play()
                oldCurrent?.stop()
                oldCurrent?.clearMediaItems()
                exoPlayer = nextPlayer
                nextExoPlayer = oldCurrent

                currentTitle = nextTitle
                currentArtist = nextArtist
                currentAlbum = nextAlbum
                currentArtworkUrl = nextArtworkUrl
                DlnaRendererState.currentTitle = currentTitle
                DlnaRendererState.currentArtist = currentArtist
                DlnaRendererState.currentAlbum = currentAlbum
                DlnaRendererState.currentArtworkUrl = currentArtworkUrl
                DlnaRendererState.currentURI = nextUri
                DlnaRendererState.currentMeta = nextMeta
                serviceScope.launch { CoverPalette.updateFromUrl(currentArtworkUrl) }

                currentUri = nextUri
                stoppedUri = ""
                stoppedPositionMs = 0L
                stoppedAtMs = 0L
                lastTransitionMs = System.currentTimeMillis()
                nextUri = ""
                nextMeta = ""
                nextTitle = ""
                nextArtist = ""
                nextAlbum = ""
                nextArtworkUrl = null

                try {
                    mediaSession?.release()
                    mediaSession = MediaSession.Builder(this@DlnaMediaService, exoPlayer!!).build()
                } catch (e: Exception) {
                    Log.e("DLNA", "Failed to recreate media session", e)
                }

                DlnaRendererState.transportState = TransportState.PLAYING
                DlnaRendererState.duration = exoPlayer?.duration?.coerceAtLeast(0) ?: 0
                DlnaRendererState.currentPosition = exoPlayer?.currentPosition?.coerceAtLeast(0) ?: 0
                onTrackChanged?.invoke(currentTitle, currentArtist, currentAlbum, currentArtworkUrl)
                updateNotification()
                promotePendingNext()
            } catch (e: Exception) {
                Log.e("DLNA", "advanceToNext failed", e)
            }
        }
    }

    override fun onSeek(positionMs: Long) {
        mainHandler.post { exoPlayer?.seekTo(positionMs) }
    }

    override fun getCurrentPosition(): Long = DlnaRendererState.currentPosition

    override fun getDuration(): Long = DlnaRendererState.duration

    private fun parseDidlLite(meta: String): Map<String, String?> {
        if (meta.isBlank()) return emptyMap()
        return try {
            val factory = DocumentBuilderFactory.newInstance()
            factory.isNamespaceAware = true
            val builder = factory.newDocumentBuilder()
            val doc = builder.parse(InputSource(StringReader(meta)))
            val result = mutableMapOf<String, String?>()

            val dcNs = "http://purl.org/dc/elements/1.1/"
            val upnpNs = "urn:schemas-upnp-org:metadata-1-0/upnp/"

            val titles = doc.getElementsByTagNameNS(dcNs, "title")
            if (titles.length > 0) result["title"] = titles.item(0).textContent

            val artists = doc.getElementsByTagNameNS(upnpNs, "artist")
            if (artists.length > 0) result["artist"] = artists.item(0).textContent
            else {
                val creators = doc.getElementsByTagNameNS(dcNs, "creator")
                if (creators.length > 0) result["artist"] = creators.item(0).textContent
            }

            val albums = doc.getElementsByTagNameNS(upnpNs, "album")
            if (albums.length > 0) result["album"] = albums.item(0).textContent

            val artUri = doc.getElementsByTagNameNS(upnpNs, "albumArtURI")
            if (artUri.length > 0) result["artwork"] = artUri.item(0).textContent

            val resources = doc.getElementsByTagNameNS("*", "res")
            if (resources.length > 0) {
                val res = resources.item(0)
                val dur = res?.attributes?.getNamedItem("duration")?.textContent
                if (dur != null) result["duration"] = dur
            }

            Log.d("DLNA", "Parsed DIDL-Lite: title=${result["title"]}, artist=${result["artist"]}, artwork=${result["artwork"]?.take(100)}, duration=${result["duration"]}")
            result
        } catch (e: Exception) {
            Log.w("DLNA", "Failed to parse DIDL-Lite: ${e.message}")
            emptyMap()
        }
    }

    private fun extractTitleFromUri(uri: String): String {
        return try {
            val path = Uri.parse(uri).lastPathSegment ?: return "Unknown"
            path.substringBeforeLast(".")
        } catch (_: Exception) {
            "Unknown"
        }
    }

    private fun cleanTitle(title: String, artist: String): String {
        var t = title
        // "Artist – Title" / "Artist — Title" / "Artist - Title" → just title (only if prefix matches artist field)
        val dashMatch = Regex(" - | – | — ").find(t)
        if (dashMatch != null && artist.isNotEmpty()) {
            val prefix = t.substring(0, dashMatch.range.first).trim()
            val suffix = t.substring(dashMatch.range.last + 1).trim()
            if (prefix.equals(artist, ignoreCase = true) || artist.contains(prefix, ignoreCase = true) || prefix.contains(artist, ignoreCase = true)) {
                t = suffix
            }
        }
        // Strip common YouTube junk
        t = t.replace(Regex("\\(.*?official.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\[.*?official.*?\\]", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\(.*?videoclip.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\[.*?videoclip.*?\\]", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\(.*?online video.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\[.*?online video.*?\\]", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\(.*?music video.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\[.*?music video.*?\\]", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\(.*?lyric.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\[.*?lyric.*?\\]", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\(.*?audio.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\[.*?audio.*?\\]", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\(.*?hd.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\[.*?hd.*?\\]", RegexOption.IGNORE_CASE), "")
        // Strip pipe/hyphen separated junk: "| Official Video", "- Official Audio", "– Videoclip oficial", etc.
        t = t.replace(Regex("[|\\-\u2013\u2014]\\s*(?i:official|videoclip|online video|music video|lyrics?|audio|hd|mv|clip).*$"), "")
        // Strip emoji
        t = t.replace(Regex("[\\p{So}\\p{Cn}]"), "")
        // Collapse whitespace and trim
        t = t.replace(Regex("\\s+"), " ").trim()
        // Remove trailing/leading hyphens, pipes, commas
        t = t.trimEnd('-', '|', ' ', ',', '\u2013', '\u2014').trimStart('-', '|', ' ', ',', '\u2013', '\u2014')
        return t.ifEmpty { title }
    }

    fun getExoPlayer(): ExoPlayer? = exoPlayer

    private fun buildPlayer(): ExoPlayer {
        // One sink per player. During crossfade both decoders run at once;
        // sharing one sink makes them fight over the same AudioTrack/clock
        // and glitches the audio even with the visualizer disabled.
        val audioSink: AudioSink = DefaultAudioSink.Builder(this)
            .setAudioProcessors(arrayOf(TeeAudioProcessor(AudioProcessor())))
            .build()
        val renderersFactory = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean,
                enableOffload: Boolean
            ): AudioSink {
                Log.d("DLNA", "buildAudioSink called")
                return audioSink
            }
        }
        return ExoPlayer.Builder(this, renderersFactory)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                false
            )
            .build().apply {
                addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (this@apply !== exoPlayer) return
                        when (playbackState) {
                            Player.STATE_ENDED -> {
                                if (crossfadeActive) return
                                // Gapless: next track already queued, advance to it
                                if (nextUri.isNotEmpty()) {
                                    advanceToNext()
                                    return
                                }
                                DlnaRendererState.transportState = TransportState.STOPPED
                                DlnaRendererState.currentPosition = 0
                                DlnaRendererState.duration = duration.coerceAtLeast(0)
                                onPlaybackStateChanged?.invoke(false)
                                startIdleTimer()
                            }
                            Player.STATE_READY -> {
                                DlnaRendererState.duration = duration.coerceAtLeast(0)
                                DlnaRendererState.currentPosition = currentPosition.coerceAtLeast(0)
                                if (isPlaying) {
                                    DlnaRendererState.transportState = TransportState.PLAYING
                                }
                            }
                            Player.STATE_BUFFERING -> {
                                DlnaRendererState.transportState = TransportState.TRANSITIONING
                            }
                            Player.STATE_IDLE -> {
                                DlnaRendererState.transportState = TransportState.NO_MEDIA_PRESENT
                            }
                        }
                    }

                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        if (this@apply !== exoPlayer) return
                        if (!isPlaying && DlnaRendererState.transportState == TransportState.STOPPED) return
                        DlnaRendererState.transportState = if (isPlaying) TransportState.PLAYING else TransportState.PAUSED_PLAYBACK
                        DlnaRendererState.currentPosition = currentPosition.coerceAtLeast(0)
                        onPlaybackStateChanged?.invoke(isPlaying)
                        updateNotification()
                        if (isPlaying) cancelIdleTimer()
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        if (this@apply !== exoPlayer) {
                            Log.e("DLNA", "Next player error: ${error.message}", error)
                            return
                        }
                        Log.e("DLNA", "Playback error: ${error.message}", error)
                        DlnaRendererState.transportState = TransportState.STOPPED
                        DlnaRendererState.transportStatus = TransportStatus.ERROR_OCCURRED
                    }
                })
            }
    }

    // Crossfade settings
    fun isCrossfadeEnabled(): Boolean = settingsManager?.crossfadeEnabled ?: false
    fun getCrossfadeDuration(): Int = settingsManager?.crossfadeDuration ?: 6
    fun getCrossfadeAlgorithm(): CrossfadeAlgorithm = settingsManager?.crossfadeAlgorithm ?: CrossfadeAlgorithm.EQUAL_POWER

    fun setCrossfadeEnabled(enabled: Boolean) {
        settingsManager?.crossfadeEnabled = enabled
        if (enabled && nextUri.isNotEmpty()) {
            prepareNextPlayer(nextUri)
            startCrossfadeWatcher()
        } else {
            cancelCrossfade()
            stopAndClearNextPlayer()
            stopCrossfadeWatcher()
        }
    }

    fun setCrossfadeDuration(seconds: Int) {
        settingsManager?.crossfadeDuration = seconds
    }

    fun setCrossfadeAlgorithm(algorithm: CrossfadeAlgorithm) {
        settingsManager?.crossfadeAlgorithm = algorithm
    }

    // ---- App visualization (Winamp .milk presets on the TV/phone screen) ----
    // Preset universe: native projectM engine (same sorted list as its
    // playlist scan); falls back to the .milk asset list before first GL init.
    private var appVizCache: List<com.castboxtv.app.viz.AppVizPresets.Preset>? = null

    fun getAppVizPresets(): List<com.castboxtv.app.viz.AppVizPresets.Preset> {
        appVizCache?.let { return it }
        val loaded = com.castboxtv.app.viz.AppVizPresets.load(this)
        appVizCache = loaded
        return loaded
    }

    /** Names of the Visualiser Studio (built-in) presets. */
    private fun builtinPresetNames(): List<String> = com.castboxtv.app.viz.VizPresets.names(this)

    /**
     * Pack the screen should actually render. The Favorites pack mixes built-in
     * and Milkdrop presets, so the engine follows the current preset.
     */
    fun getEffectiveAppVizPack(): String {
        val pack = getAppVizPack()
        if (pack != com.castboxtv.app.viz.ProjectMEngine.PACK_FAVORITES) return pack
        return if (getAppVizPreset() in builtinPresetNames()) {
            com.castboxtv.app.viz.ProjectMEngine.PACK_BUILTIN
        } else pack
    }

    fun getAppVizPresetNames(): List<String> {
        if (getAppVizPack() == com.castboxtv.app.viz.ProjectMEngine.PACK_FAVORITES) {
            return getAppVizFavorites().distinct()
        }
        if (getAppVizPack() == com.castboxtv.app.viz.ProjectMEngine.PACK_BUILTIN) {
            return com.castboxtv.app.viz.VizPresets.names(this)
        }
        val engine = com.castboxtv.app.viz.ProjectMEngine.presetNames
        if (engine.isNotEmpty()) return engine
        return getAppVizPresets().map { it.name }
    }

    private val DEFAULT_APPVIZ_PRESET = "Winamp base"

    fun getAppVizPreset(): String {
        val saved = settingsManager?.appVizPreset ?: ""
        val names = getAppVizPresetNames()
        if (names.contains(saved)) return saved
        return names.firstOrNull { it.equals(DEFAULT_APPVIZ_PRESET, ignoreCase = true) } ?: names.firstOrNull() ?: ""
    }

    fun getAppVizPresetIndex(): Int {
        val names = getAppVizPresetNames()
        val idx = names.indexOf(getAppVizPreset())
        return if (idx >= 0) idx else 0
    }

    fun setAppVizPreset(name: String) {
        if (name.isNotBlank()) {
            settingsManager?.appVizPreset = name
        }
    }

    fun nextAppVizPreset() {
        val names = getAppVizPresetNames()
        if (names.isEmpty()) return
        setAppVizPreset(names[(getAppVizPresetIndex() + 1) % names.size])
    }

    fun randomAppVizPreset() {
        val names = getAppVizPresetNames()
        if (names.isEmpty()) return
        setAppVizPreset(names[kotlin.random.Random.nextInt(names.size)])
    }

    fun isAppVizEnabled(): Boolean = settingsManager?.appVizEnabled ?: true
    fun setAppVizEnabled(enabled: Boolean) { settingsManager?.appVizEnabled = enabled }
    fun isAppVizCycle(): Boolean = settingsManager?.appVizCycle ?: false
    fun setAppVizCycle(cycle: Boolean) { settingsManager?.appVizCycle = cycle }
    fun getAppVizCycleSecs(): Int = settingsManager?.appVizCycleSecs ?: 8
    fun setAppVizCycleSecs(secs: Int) { settingsManager?.appVizCycleSecs = secs }
    fun isAppVizUseCoverPalette(): Boolean = settingsManager?.appVizUseCoverPalette ?: true
    fun setAppVizUseCoverPalette(use: Boolean) { settingsManager?.appVizUseCoverPalette = use }
    fun isAppVizShowFps(): Boolean = settingsManager?.appVizShowFps ?: false
    fun setAppVizShowFps(show: Boolean) { settingsManager?.appVizShowFps = show }
    fun getAppVizPack(): String = settingsManager?.appVizPack ?: "builtin"
    fun setAppVizPack(pack: String) { settingsManager?.appVizPack = pack }
    fun isAppVizShowName(): Boolean = settingsManager?.appVizShowName ?: false
    fun setAppVizShowName(show: Boolean) { settingsManager?.appVizShowName = show }

    // ---- Built in visualiser (Visualiser Studio JSON presets, vze engine) ----
    fun getVizPresetNames(): List<String> = com.castboxtv.app.viz.VizPresets.names(this)

    fun getVizPresetJson(name: String): String? = com.castboxtv.app.viz.VizPresets.json(this, name)

    /** Raw JSONs aligned with getVizPresetNames(), for the Studio full dump. */
    fun getVizPresetFullJsons(): List<String> =
        com.castboxtv.app.viz.VizPresets.fullJsons(this)

    /** Preset names backed by device user files, for Studio Default/My grouping. */
    fun getVizPresetUserNames(): List<String> =
        com.castboxtv.app.viz.VizPresets.userNames(this)

    /** Stores a Studio-authored preset; returns the stored name or null. */
    fun saveVizPreset(presetJson: String): String? = com.castboxtv.app.viz.VizPresets.save(this, presetJson)

    fun deleteVizPreset(name: String): Boolean = com.castboxtv.app.viz.VizPresets.delete(this, name)

    /** Clears preset tombstones, bringing deleted defaults back. */
    fun restoreVizPresets(): Int = com.castboxtv.app.viz.VizPresets.restore(this)

    /**
     * Blur pipeline check: renders a high-contrast checkerboard through a
     * blurred cover backdrop twice (blur 0 vs 40) and compares pixel
     * sharpness. Proves the engine blur value reaches the Canvas backend and
     * actually softens the image, without needing eyes on the TV.
     */
    fun vizBlurTest(): String {
        return try {
            val eng = com.castboxtv.app.viz.VizEngine
            if (!eng.ensureLoaded()) return "{\"ok\":false,\"error\":\"engine missing\"}"
            // 8px checkerboard: maximum sharpness, any blur collapses it.
            val size = 256
            val checker = android.graphics.Bitmap.createBitmap(size, size,
                android.graphics.Bitmap.Config.ARGB_8888)
            val px = IntArray(size * size)
            for (y in 0 until size) {
                for (x in 0 until size) {
                    px[y * size + x] = if (((x / 8) + (y / 8)) % 2 == 0) -0x1000000 else -0x1
                }
            }
            checker.setPixels(px, 0, size, 0, 0, size, size)

            eng.setSurface(1280, 720)
            val renderer = com.castboxtv.app.viz.VizRenderer(this)
            renderer.setImage(1, checker)
            eng.coverSet(1)

            fun sharpness(blur: Int): Double {
                val json = "{\"version\":1,\"name\":\"blur probe\",\"components\":[" +
                    "{\"type\":\"background\",\"props\":{\"mode\":2,\"image\":\"{cover}\"," +
                    "\"blur\":" + blur + ",\"dim\":0}}]}"
                if (!eng.loadPreset(json, null)) return -1.0
                val bmp = android.graphics.Bitmap.createBitmap(
                    320, 180, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bmp)
                canvas.scale(320f / 1280f, 180f / 720f)
                repeat(4) {
                    eng.pushAudio(FloatArray(eng.audioWindow), 0)
                    eng.frame(16.7f)
                    renderer.render(canvas)
                }
                var sum = 0L
                var n = 0L
                val row = IntArray(320)
                for (y in 0 until 180) {
                    bmp.getPixels(row, 0, 320, 0, y, 320, 1)
                    for (x in 0 until 319) {
                        val a = row[x] and 0xFF
                        val b = row[x + 1] and 0xFF
                        sum += kotlin.math.abs(a - b)
                        n++
                    }
                }
                bmp.recycle()
                return sum.toDouble() / n
            }

            val sharp0 = sharpness(0)
            val sharp40 = sharpness(40)
            checker.recycle()
            renderer.setImage(1, null)
            val blurred = sharp0 > 0 && sharp40 >= 0 && sharp40 < sharp0 * 0.5
            Log.i("VizTest", "blur metric sharp0=$sharp0 sharp40=$sharp40 blurred=$blurred")
            "{\"ok\":true,\"sharp0\":$sharp0,\"sharp40\":$sharp40,\"blurred\":$blurred}"
        } catch (e: Exception) {
            Log.e("VizTest", "blur test failed", e)
            "{\"ok\":false,\"error\":\"${e.message}\"}"
        }
    }

    /**
     * Headless render check: loads [name], feeds a synthetic tone, runs 6
     * frames through the Kotlin Canvas backend on an offscreen bitmap and
     * reports the peak command count. Exercises the JNI engine + renderer
     * without needing the Play Now screen or live audio.
     */
    fun vizRenderTest(name: String): String {
        return try {
            val eng = com.castboxtv.app.viz.VizEngine
            if (!eng.ensureLoaded()) return "{\"ok\":false,\"error\":\"engine missing\"}"
            val json = com.castboxtv.app.viz.VizPresets.json(this, name)
                ?: return "{\"ok\":false,\"error\":\"unknown preset\"}"
            eng.setSurface(1280, 720)
            eng.setAudioRate(44100)
            val renderer = com.castboxtv.app.viz.VizRenderer(this)
            com.castboxtv.app.viz.VizBundledImages.ensure(this, renderer)
            val resolved = com.castboxtv.app.viz.VizEmbeddedImages.resolve(json, renderer::setImage)
            if (!eng.loadPreset(resolved, com.castboxtv.app.viz.CoverPalette.roles())) {
                return "{\"ok\":false,\"error\":\"preset load failed\"}"
            }
            val w = eng.audioWindow
            val tone = FloatArray(w) { i ->
                (0.6 * kotlin.math.sin(2 * Math.PI * 220 * i / 44100)).toFloat()
            }
            val bmp = android.graphics.Bitmap.createBitmap(
                320, 180, android.graphics.Bitmap.Config.ARGB_8888)
            val canvas = android.graphics.Canvas(bmp)
            canvas.scale(320f / 1280f, 180f / 720f)
            eng.setVar("title", "Smoke")
            eng.setVar("artist", "TV")
            var cmds = 0
            repeat(6) {
                eng.pushAudio(tone, w)
                eng.frame(16.7f)
                renderer.render(canvas)
                cmds = maxOf(cmds, eng.cmdCount())
            }
            bmp.recycle()
            Log.i("VizTest", "preset \"$name\" rendered $cmds cmds peak")
            "{\"ok\":true,\"cmds\":$cmds}"
        } catch (e: Exception) {
            Log.e("VizTest", "render test failed", e)
            "{\"ok\":false,\"error\":\"${e.message}\"}"
        }
    }

    // ---- Silent mock audio (synth PCM for benchmarks; never audible) ----
    fun isAppVizMockAudio(): Boolean = settingsManager?.appVizMockAudio ?: false
    fun setAppVizMockAudio(enabled: Boolean) {
        settingsManager?.appVizMockAudio = enabled
        com.castboxtv.app.viz.AppVizAudioFeed.mockEnabled = enabled
    }

    // ---- Favorite presets (a pack that cycles only the starred ones) ----
    fun getAppVizFavorites(): List<String> {
        val raw = settingsManager?.appVizFavorites ?: ""
        if (raw.isBlank()) return emptyList()
        return try {
            val arr = org.json.JSONArray(raw)
            (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
        } catch (_: Exception) { emptyList() }
    }

    fun isAppVizFavorite(name: String): Boolean = getAppVizFavorites().contains(name)

    fun getAppVizFavoritesVersion(): Int = getAppVizFavorites().size

    /** Toggles favorite for [name]; true = now a favorite, false = removed. */
    fun toggleAppVizFavorite(name: String): Boolean {
        val current = getAppVizFavorites().toMutableList()
        val added = if (current.contains(name)) {
            current.remove(name); false
        } else {
            if (name.isBlank()) return false
            current.add(name); true
        }
        val arr = org.json.JSONArray()
        current.forEach { arr.put(it) }
        settingsManager?.appVizFavorites = arr.toString()
        return added
    }

    fun restartApp() {
        Log.d("DLNA", "restarting app via web request")
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.set(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + 500,
            pi
        )
        serviceScope.launch(Dispatchers.IO) {
            delay(800)
            Process.killProcess(Process.myPid())
        }
    }

    private fun prepareNextPlayer(uri: String) {
        if (!settingsManager!!.crossfadeEnabled) return
        mainHandler.post {
            try {
                nextExoPlayer?.stop()
                nextExoPlayer?.clearMediaItems()
                nextExoPlayer?.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
                nextExoPlayer?.seekTo(0)
                nextExoPlayer?.volume = 0f
                nextExoPlayer?.playWhenReady = false
                nextExoPlayer?.prepare()
                Log.d("DLNA", "Next player prepared for crossfade: $uri")
            } catch (e: Exception) {
                Log.e("DLNA", "Failed to prepare next player", e)
            }
        }
    }

    private fun stopAndClearNextPlayer() {
        mainHandler.post {
            nextExoPlayer?.stop()
            nextExoPlayer?.clearMediaItems()
            nextExoPlayer?.volume = 0f
        }
        nextUri = ""
        nextMeta = ""
        nextTitle = ""
        nextArtist = ""
        nextAlbum = ""
        nextArtworkUrl = null
        pendingNextUri = ""
        pendingNextMeta = ""
    }

    private fun setNextTrack(uri: String, meta: String) {
        nextUri = uri
        nextMeta = meta
        val parsed = parseDidlLite(meta)
        nextArtist = parsed["artist"] ?: ""
        nextAlbum = parsed["album"] ?: ""
        nextTitle = cleanTitle(parsed["title"] ?: extractTitleFromUri(uri), nextArtist)
        nextArtworkUrl = parsed["artwork"]
        Log.d("DLNA", "Next song: $nextTitle - $nextArtist")
    }

    /** Promote a SetNextURI deferred during a crossfade to the queued next slot. */
    private fun promotePendingNext() {
        if (pendingNextUri.isEmpty()) return
        setNextTrack(pendingNextUri, pendingNextMeta)
        pendingNextUri = ""
        pendingNextMeta = ""
        if (settingsManager?.crossfadeEnabled == true) {
            prepareNextPlayer(nextUri)
            startCrossfadeWatcher()
        }
    }

    override fun onSetNextURI(uri: String, meta: String) {
        // A crossfade is fading into nextExoPlayer right now; preparing a new
        // URI on it would kill the fade and skip the track we're fading into.
        // Defer until the crossfade finishes.
        if (crossfadeActive) {
            pendingNextUri = uri
            pendingNextMeta = meta
            Log.d("DLNA", "SetNextURI deferred mid-crossfade")
            return
        }
        pendingNextUri = ""
        pendingNextMeta = ""
        setNextTrack(uri, meta)

        if (settingsManager?.crossfadeEnabled == true) {
            prepareNextPlayer(uri)
            startCrossfadeWatcher()
        }
    }

    private fun startCrossfadeWatcher() {
        stopCrossfadeWatcher()
        if (!settingsManager!!.crossfadeEnabled) return
        if (nextUri.isEmpty()) return
        crossfadeWatcher = object : Runnable {
            override fun run() {
                maybeStartCrossfade()
                if (crossfadeWatcher != null) {
                    mainHandler.postDelayed(this, 100)
                }
            }
        }
        mainHandler.post(crossfadeWatcher!!)
    }

    private fun stopCrossfadeWatcher() {
        crossfadeWatcher?.let { mainHandler.removeCallbacks(it) }
        crossfadeWatcher = null
    }

    private fun maybeStartCrossfade() {
        if (crossfadeActive) return
        if (!settingsManager!!.crossfadeEnabled) return
        if (nextUri.isEmpty()) return
        val player = exoPlayer ?: return
        val duration = player.duration
        val position = player.currentPosition
        if (duration <= 0) return
        val crossfadeMs = settingsManager!!.crossfadeDuration * 1000L
        if (position + crossfadeMs >= duration) {
            startCrossfade()
        }
    }

    private fun startCrossfade() {
        if (crossfadeActive) return
        val nextPlayer = nextExoPlayer ?: return
        if (nextPlayer.playbackState != Player.STATE_READY) {
            Log.w("DLNA", "Next player not ready, skipping crossfade")
            return
        }
        crossfadeActive = true
        crossfadeGeneration++
        val gen = crossfadeGeneration
        stopCrossfadeWatcher()

        exoPlayer?.volume = 1f
        nextPlayer.volume = 0f
        nextPlayer.seekTo(0)
        nextPlayer.play()
        Log.d("DLNA", "crossfade started gen=$gen (out='$currentTitle' in='$nextTitle'), next player ready=${nextPlayer.isPlaying}, pos=${nextPlayer.currentPosition}")

        val algorithm = settingsManager!!.crossfadeAlgorithm
        val durationMs = settingsManager!!.crossfadeDuration * 1000L
        val startTime = System.currentTimeMillis()

        crossfadeJob = serviceScope.launch {
            while (isActive) {
                val elapsed = System.currentTimeMillis() - startTime
                val progress = (elapsed.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
                val (outVol, inVol) = algorithm.computeVolumes(progress)
                exoPlayer?.volume = outVol
                nextPlayer.volume = inVol
                if (progress >= 1f) break
                delay(16)
            }
            finishCrossfade(gen)
        }
    }

    private fun cancelCrossfade() {
        crossfadeGeneration++
        crossfadeJob?.cancel()
        crossfadeJob = null
        crossfadeActive = false
        mainHandler.post {
            exoPlayer?.volume = 1f
            nextExoPlayer?.volume = 0f
            nextExoPlayer?.pause()
        }
    }

    private fun finishCrossfade(gen: Int) {
        mainHandler.post {
            if (gen != crossfadeGeneration) {
                Log.w("DLNA", "ignoring stale crossfade finish (gen=$gen, current=$crossfadeGeneration)")
                return@post
            }
            crossfadeJob = null
            crossfadeActive = false
            stopCrossfadeWatcher()

            // Stop the old current track and reset its volume.
            val oldCurrent = exoPlayer
            oldCurrent?.stop()
            oldCurrent?.clearMediaItems()
            oldCurrent?.volume = 1f

            // Swap players: next becomes current.
            exoPlayer = nextExoPlayer
            nextExoPlayer = oldCurrent

            // Move next-track metadata to current.
            currentTitle = nextTitle
            currentArtist = nextArtist
            currentAlbum = nextAlbum
            currentArtworkUrl = nextArtworkUrl
            DlnaRendererState.currentTitle = currentTitle
            DlnaRendererState.currentArtist = currentArtist
            DlnaRendererState.currentAlbum = currentAlbum
            DlnaRendererState.currentArtworkUrl = currentArtworkUrl
            serviceScope.launch { CoverPalette.updateFromUrl(currentArtworkUrl) }
            DlnaRendererState.currentURI = nextUri
            DlnaRendererState.currentMeta = nextMeta

            // Remember for duplicate SetURI guard (Symfonium gapless + crossfade race)
            lastCrossfadeEndTimeMs = System.currentTimeMillis()
            lastCrossfadeUri = DlnaRendererState.currentURI
            lastCrossfadeDurationMs = settingsManager?.crossfadeDuration?.times(1000L) ?: 0L
            currentUri = nextUri
            stoppedUri = ""
            stoppedPositionMs = 0L
            stoppedAtMs = 0L
            lastTransitionMs = System.currentTimeMillis()

            // Clear next-track state.
            nextUri = ""
            nextMeta = ""
            nextTitle = ""
            nextArtist = ""
            nextAlbum = ""
            nextArtworkUrl = null

            // Ensure the new current track is audible.
            exoPlayer?.volume = 1f

            // Recreate media session for the new current player.
            try {
                mediaSession?.release()
                mediaSession = MediaSession.Builder(this@DlnaMediaService, exoPlayer!!).build()
            } catch (e: Exception) {
                Log.e("DLNA", "Failed to recreate media session", e)
            }

            val newPos = exoPlayer?.currentPosition?.coerceAtLeast(0) ?: 0
            DlnaRendererState.transportState = TransportState.PLAYING
            DlnaRendererState.duration = exoPlayer?.duration?.coerceAtLeast(0) ?: 0
            DlnaRendererState.currentPosition = newPos
            Log.d("DLNA", "crossfade finished, new pos=${newPos}ms, duration=${DlnaRendererState.duration}ms")
            onTrackChanged?.invoke(currentTitle, currentArtist, currentAlbum, currentArtworkUrl)
            updateNotification()
            promotePendingNext()
        }
    }

    fun getDisplayName(): String = settingsManager?.displayName ?: "CastBox TV"

    fun getCurrentTitle(): String = currentTitle
    fun getCurrentArtist(): String = currentArtist
    fun getCurrentAlbum(): String = currentAlbum
    fun getCurrentArtworkUrl(): String? = currentArtworkUrl
    fun hasMedia(): Boolean = currentTitle.isNotEmpty() && currentTitle != "Waiting for media..."

    fun bringToForeground() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        }
        startActivity(intent)
    }

    fun sendToBackground() {
        sentToBackground = true
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(intent)
    }

    fun updateDisplayName(name: String) {
        settingsManager?.displayName = name
        reregisterDevice()
    }

    private fun startIdleTimer() {
        cancelIdleTimer()
        idleHandler = Runnable {
            Log.d("DLNA", "Idle timeout - sending to background")
            sendToBackground()
        }
        mainHandler.postDelayed(idleHandler!!, IDLE_TIMEOUT_MS)
    }

    private fun cancelIdleTimer() {
        idleHandler?.let { mainHandler.removeCallbacks(it) }
        idleHandler = null
    }

    private fun startDisconnectChecker() {
        stopDisconnectChecker()
        disconnectChecker = object : Runnable {
            override fun run() {
                val lastAction = DlnaRendererState.lastControllerActionTime
                val controllerName = DlnaRendererState.controllerName
                if (controllerName.isNotEmpty() && lastAction > 0) {
                    val elapsed = System.currentTimeMillis() - lastAction
                    if (elapsed > DISCONNECT_TIMEOUT_MS) {
                        Log.d("DLNA", "Controller disconnected (no activity for ${elapsed / 1000}s)")
                        DlnaRendererState.controllerName = ""
                        DlnaRendererState.currentURI = ""
                        DlnaRendererState.currentMeta = ""
                        DlnaRendererState.transportState = TransportState.NO_MEDIA_PRESENT
                        DlnaRendererState.currentPosition = 0
                        DlnaRendererState.duration = 0
                        wasDisconnected = true
                        mainHandler.post {
                            exoPlayer?.stop()
                            onDisconnected?.invoke()
                            sendToBackground()
                        }
                        stopDisconnectChecker()
                        return
                    }
                }
                mainHandler.postDelayed(this, 3000)
            }
        }
        mainHandler.postDelayed(disconnectChecker!!, 5000)
    }

    private fun stopDisconnectChecker() {
        disconnectChecker?.let { mainHandler.removeCallbacks(it) }
        disconnectChecker = null
    }

    override fun onDestroy() {
        super.onDestroy()
        cancelIdleTimer()
        stopDisconnectChecker()
        stopCrossfadeWatcher()
        positionSyncRunnable?.let { mainHandler.removeCallbacks(it) }
        webServer?.stop()
        mediaSession?.release()
        DlnaRendererState.callback = null
        onDisconnected = null
        unregisterDevice()
        exoPlayer?.release()
        nextExoPlayer?.release()
        serviceScope.cancel()
        upnpServiceConnection?.let { try { unbindService(it) } catch (_: Exception) {} }
        upnpService?.get()?.shutdown()
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d("DLNA", "WakeLock released")
            }
        }
        multicastLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d("DLNA", "MulticastLock released")
            }
        }
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        private const val NOTIFICATION_CHANNEL = "dlna_playback"
    }
}
