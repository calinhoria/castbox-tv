package com.castboxtv.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.material3.LocalTextStyle
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import com.castboxtv.app.viz.ProjectMEngine
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.rememberAsyncImagePainter
import coil.request.ImageRequest
import com.castboxtv.app.dlna.DlnaMediaService
import com.castboxtv.app.dlna.DlnaRendererState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.random.Random

private object FAIcons {
    const val PLAY = "\uF04B"
    const val PAUSE = "\uF04C"
    const val SKIP_BACK = "\uF04A"
    const val SKIP_FORWARD = "\uF04E"
    const val VOLUME = "\uF028"
    const val VOLUME_LOW = "\uF027"
    const val VOLUME_MUTE = "\uF026"
    const val SETTINGS = "\uF013"
}

@Composable
fun NowPlayingScreen(
    service: DlnaMediaService?
) {
    var title by remember { mutableStateOf("Waiting for media...") }
    var artist by remember { mutableStateOf("") }
    var album by remember { mutableStateOf("") }
    var artworkUrl by remember { mutableStateOf<String?>(null) }
    var isPlaying by remember { mutableStateOf(false) }
    var currentPosition by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var clockText by remember { mutableStateOf("") }
    var dateText by remember { mutableStateOf("") }
    var volumePercent by remember { mutableStateOf(0) }
    var showVolumeOverlay by remember { mutableStateOf(false) }
    var controllerName by remember { mutableStateOf("") }
    var appVizEnabled by remember { mutableStateOf(false) }
    var appVizPreset by remember { mutableStateOf("") }
    var appVizUseCoverPalette by remember { mutableStateOf(true) }
    var appVizCycle by remember { mutableStateOf(false) }
    var appVizCycleSecs by remember { mutableStateOf(8) }
    var appVizShowFps by remember { mutableStateOf(false) }
    var appVizPack by remember { mutableStateOf("builtin") }
    var appVizShowName by remember { mutableStateOf(false) }
    var appVizFavoritesVersion by remember { mutableIntStateOf(0) }
    var prevArtworkUrl by remember { mutableStateOf<String?>(null) }
    val crossfadeProgress = remember { Animatable(1f) }
    val scope = rememberCoroutineScope()
    val unsplashUrl = remember { mutableStateOf("https://picsum.photos/seed/${Random.nextInt()}/1920/1080") }

    val focusRequester = remember { FocusRequester() }
    val hasMedia = title != "Waiting for media..."

    val faFamily = FontFamily(Font(path = "fonts/fa-solid-900.otf", assetManager = LocalContext.current.assets))

    LaunchedEffect(service) {
        if (service != null) {
            if (service.hasMedia()) {
                title = service.getCurrentTitle()
                artist = service.getCurrentArtist()
                album = service.getCurrentAlbum()
                artworkUrl = service.getCurrentArtworkUrl()
            }
            service.onTrackChanged = { t, a, al, art ->
                if (art != artworkUrl && artworkUrl != null) {
                    prevArtworkUrl = artworkUrl
                    scope.launch {
                        crossfadeProgress.snapTo(0f)
                        crossfadeProgress.animateTo(1f, tween(600))
                        prevArtworkUrl = null
                    }
                }
                title = t
                artist = a
                album = al
                artworkUrl = art
            }
            service.onPlaybackStateChanged = { playing ->
                isPlaying = playing
            }
            service.onDisconnected = {
                title = "Waiting for media..."
                artist = ""
                album = ""
                artworkUrl = null
                controllerName = ""
            }
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            val state = DlnaRendererState
            currentPosition = state.currentPosition
            duration = state.duration
            isPlaying = state.transportState.name == "PLAYING"
            controllerName = state.controllerName
            delay(500)
        }
    }

    LaunchedEffect(service) {
        while (true) {
            appVizEnabled = service?.isAppVizEnabled() == true
            appVizPreset = service?.getAppVizPreset() ?: ""
            appVizUseCoverPalette = service?.isAppVizUseCoverPalette() != false
            appVizCycle = service?.isAppVizCycle() == true
            appVizCycleSecs = service?.getAppVizCycleSecs() ?: 8
            appVizShowFps = service?.isAppVizShowFps() == true
            appVizPack = service?.getEffectiveAppVizPack() ?: "builtin"
            appVizShowName = service?.isAppVizShowName() == true
            appVizFavoritesVersion = service?.getAppVizFavoritesVersion() ?: 0
            delay(1000)
        }
    }

    LaunchedEffect(service, appVizCycle, appVizCycleSecs, appVizEnabled) {
        while (appVizCycle && appVizEnabled) {
            delay(appVizCycleSecs.coerceIn(5, 120) * 1000L)
            service?.nextAppVizPreset()
            appVizPreset = service?.getAppVizPreset() ?: appVizPreset
        }
    }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    LaunchedEffect(Unit) {
        val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
        val dateFmt = SimpleDateFormat("EEE, d MMM", Locale.getDefault())
        while (true) {
            val now = Date()
            clockText = clockFmt.format(now)
            dateText = dateFmt.format(now)
            delay(1000)
        }
    }

    LaunchedEffect(service) {
        var lastSeenTimestamp = DlnaRendererState.overlayVolumeTimestamp
        while (true) {
            val newVol = service?.getCurrentVolume() ?: 0
            val dlnaTimestamp = DlnaRendererState.overlayVolumeTimestamp
            if (newVol != volumePercent || dlnaTimestamp != lastSeenTimestamp) {
                volumePercent = newVol
                if (dlnaTimestamp != lastSeenTimestamp) {
                    volumePercent = DlnaRendererState.overlayVolume
                }
                lastSeenTimestamp = dlnaTimestamp
                showVolumeOverlay = true
            }
            delay(250)
        }
    }

    LaunchedEffect(showVolumeOverlay) {
        if (showVolumeOverlay) {
            delay(2000)
            showVolumeOverlay = false
        }
    }

    val progress = if (duration > 0) currentPosition.toFloat() / duration.toFloat() else 0f

    // Built in visualiser mode is fully immersive: the Studio preset is the
    // whole screen, no app chrome (clock, title/artist, controls, overlays).
    val immersive = appVizEnabled && appVizPack == ProjectMEngine.PACK_BUILTIN

    val bgAlpha by animateFloatAsState(
        targetValue = if (hasMedia) 1f else 0f,
        animationSpec = tween(800),
        label = "bg"
    )

    val blurTransformation = remember { BlurTransformation(radius = 20, sampling = 6) }

    Box(modifier = Modifier.fillMaxSize().focusRequester(focusRequester).focusable()) {
        if (appVizEnabled) {
            // Winamp .milk visualization fills the background (no blurred artwork)
            AppVizBackground(service = service, presetName = appVizPreset, presetPack = appVizPack, favoritesVersion = appVizFavoritesVersion, useCoverPalette = appVizUseCoverPalette, playing = isPlaying, title = title, artist = artist, album = album)
            if (!immersive && appVizShowFps) {
                val stats = com.castboxtv.app.viz.AppVizDebugState.stats.value
                Text(
                    text = stats.ifBlank { "starting..." },
                    color = Color(0xFF7CFF7C),
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    style = LocalTextStyle.current.copy(
                        shadow = Shadow(
                            color = Color.Black,
                            offset = Offset(3f, 3f),
                            blurRadius = 6f
                        )
                    ),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(start = 24.dp, top = 90.dp)
                )
            }
            if (!immersive && appVizShowName) {
                Text(
                    text = appVizPreset,
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Light,
                    maxLines = 1,
                    style = LocalTextStyle.current.copy(
                        shadow = Shadow(
                            color = Color.Black.copy(alpha = 0.6f),
                            offset = Offset(2f, 2f),
                            blurRadius = 4f
                        )
                    ),
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 28.dp) // same top bar row as "Playing from"
                )
            }
        } else {
            // Solid dark background
            Box(modifier = Modifier.fillMaxSize().background(Color(0xFF222222)))
        }

        // Unsplash random image (idle mode, no blur)
        if (!hasMedia && !appVizEnabled) {
            Image(
                painter = rememberAsyncImagePainter(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(unsplashUrl.value)
                        .crossfade(true)
                        .build()
                ),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Brush.verticalGradient(0.0f to Color.Transparent, 1.0f to Color.Black.copy(alpha = 0.6f)))
            )
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 60.dp, vertical = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = service?.getDisplayName() ?: "CastBox TV",
                    color = Color.White,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Open your DLNA app and connect to this device",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Light
                )
            }
        }

        // Old artwork fading out (blurred) — skipped in viz mode (viz is the bg)
        if (!appVizEnabled) {
        prevArtworkUrl?.let { url ->
            Image(
                painter = rememberAsyncImagePainter(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(url)
                        .transformations(blurTransformation)
                        .crossfade(true)
                        .build()
                ),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        alpha = bgAlpha * (1f - crossfadeProgress.value)
                        scaleX = 1.4f; scaleY = 1.4f
                    }
            )
        }

        // New artwork fading in (blurred)
        artworkUrl?.let { url ->
            Image(
                painter = rememberAsyncImagePainter(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(url)
                        .transformations(blurTransformation)
                        .crossfade(true)
                        .build()
                ),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        alpha = bgAlpha * crossfadeProgress.value
                        scaleX = 1.4f; scaleY = 1.4f
                    }
            )
        }
        } // end if (!appVizEnabled) blurred backgrounds

        // Gradient overlay + vignette (app chrome — hidden in immersive mode)
        if (!immersive) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.0f to Color.Black.copy(alpha = 0.45f),
                        0.35f to Color.Black.copy(alpha = 0.1f),
                        0.65f to Color.Black.copy(alpha = 0.1f),
                        1.0f to Color.Black.copy(alpha = 0.7f)
                    )
                )
        )
        // Vignette
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.4f)),
                        radius = 1100f
                    )
                )
        )
        }

        // --- TOP BAR (hidden in immersive mode) ---
        if (!immersive) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 48.dp, vertical = 28.dp)
                .align(Alignment.TopCenter),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            if (hasMedia) {
                Column {
                    Text(
                        text = "Playing from ${controllerName.ifEmpty { "DLNA Audio" }}",
                        color = Color.White.copy(alpha = 0.45f),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Normal
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val volIcon = when {
                            volumePercent == 0 -> FAIcons.VOLUME_MUTE
                            volumePercent < 40 -> FAIcons.VOLUME_LOW
                            else -> FAIcons.VOLUME
                        }
                        Text(
                            text = volIcon,
                            fontFamily = faFamily,
                            fontSize = 11.sp,
                            color = Color.White.copy(alpha = 0.3f)
                        )
                        Spacer(modifier = Modifier.width(5.dp))
                        Text(
                            text = "$volumePercent%",
                            color = Color.White.copy(alpha = 0.3f),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Light
                        )
                    }
                }
            } else {
                Spacer(modifier = Modifier.height(1.dp))
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = clockText,
                    color = Color.White.copy(alpha = 0.7f),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Light
                )
                Text(
                    text = dateText,
                    color = Color.White.copy(alpha = 0.4f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Normal
                )
            }
        }
        } // end top bar (!immersive)

        // --- BOTTOM: Cover + Title + Artist + Controls + Progress (hidden in immersive mode) ---
        if (!immersive && hasMedia) {
        if (appVizEnabled) {
            // Spotify-TV style: small cover bottom-left, same row as progress
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 60.dp, vertical = 40.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                artworkUrl?.let { url ->
                    Image(
                        painter = rememberAsyncImagePainter(
                            model = ImageRequest.Builder(LocalContext.current)
                                .data(url)
                                .crossfade(true)
                                .build()
                        ),
                        contentDescription = "Album Art",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(120.dp)
                            .clip(RoundedCornerShape(12.dp))
                    )
                } ?: Box(
                    modifier = Modifier
                        .size(120.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.DarkGray.copy(alpha = 0.5f))
                )

                Spacer(modifier = Modifier.width(20.dp))

                Column(modifier = Modifier.weight(1f)) {
                    MarqueeText(
                        text = title,
                        color = Color.White,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Bold,
                        alignLeft = true
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    if (artist.isNotEmpty()) {
                        MarqueeText(
                            text = artist,
                            color = Color.White.copy(alpha = 0.6f),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Normal,
                            alignLeft = true
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                    } else {
                        Spacer(modifier = Modifier.height(12.dp))
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RoundFAButton(
                            icon = if (isPlaying) FAIcons.PAUSE else FAIcons.PLAY,
                            iconSize = 16.sp,
                            size = 32.dp,
                            bgAlpha = 0.18f,
                            fa = faFamily
                        ) { service?.togglePlayPause() }

                        Spacer(modifier = Modifier.width(10.dp))

                        Text(
                            text = formatTime(currentPosition),
                            color = Color.White.copy(alpha = 0.5f),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Light
                        )

                        Spacer(modifier = Modifier.width(10.dp))

                        LinearProgressIndicator(
                            progress = progress.coerceIn(0f, 1f),
                            modifier = Modifier
                                .weight(1f)
                                .height(3.dp)
                                .clip(RoundedCornerShape(2.dp)),
                            color = Color.White,
                            trackColor = Color.White.copy(alpha = 0.2f),
                        )

                        Spacer(modifier = Modifier.width(10.dp))

                        Text(
                            text = formatTime(duration),
                            color = Color.White.copy(alpha = 0.5f),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Light
                        )
                    }
                }
            }
        } else {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(horizontal = 60.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Cover art
            artworkUrl?.let { url ->
                Image(
                    painter = rememberAsyncImagePainter(
                        model = ImageRequest.Builder(LocalContext.current)
                            .data(url)
                            .crossfade(true)
                            .build()
                    ),
                    contentDescription = "Album Art",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(220.dp)
                        .clip(RoundedCornerShape(16.dp))
                )
            } ?: Box(
                modifier = Modifier
                    .size(220.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.DarkGray.copy(alpha = 0.5f))
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Title
            MarqueeText(
                text = title,
                color = Color.White,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(6.dp))

            // Artist
            if (artist.isNotEmpty()) {
                MarqueeText(
                    text = artist,
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Normal
                )
                Spacer(modifier = Modifier.height(12.dp))
            } else {
                Spacer(modifier = Modifier.height(12.dp))
            }

            // Controls + Progress
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RoundFAButton(
                    icon = if (isPlaying) FAIcons.PAUSE else FAIcons.PLAY,
                    iconSize = 16.sp,
                    size = 32.dp,
                    bgAlpha = 0.18f,
                    fa = faFamily
                ) { service?.togglePlayPause() }

                Spacer(modifier = Modifier.width(10.dp))

                Text(
                    text = formatTime(currentPosition),
                    color = Color.White.copy(alpha = 0.5f),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Light
                )

                Spacer(modifier = Modifier.width(10.dp))

                LinearProgressIndicator(
                    progress = progress.coerceIn(0f, 1f),
                    modifier = Modifier
                        .weight(1f)
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = Color.White,
                    trackColor = Color.White.copy(alpha = 0.2f),
                )

                Spacer(modifier = Modifier.width(10.dp))

                Text(
                    text = formatTime(duration),
                    color = Color.White.copy(alpha = 0.5f),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Light
                )
            }
        }
        } // end classic bottom layout
        }

        // Volume overlay (hidden in immersive mode)
        if (!immersive && showVolumeOverlay) {
            Box(
                modifier = Modifier
                    .fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .size(120.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color.White.copy(alpha = 0.12f))
                        .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(14.dp))
                        .padding(14.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        val volIcon = when {
                            volumePercent == 0 -> FAIcons.VOLUME_MUTE
                            volumePercent < 40 -> FAIcons.VOLUME_LOW
                            else -> FAIcons.VOLUME
                        }
                        Text(
                            text = volIcon,
                            fontFamily = faFamily,
                            fontSize = 24.sp,
                            color = Color.White
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        LinearProgressIndicator(
                            progress = (volumePercent / 100f).coerceIn(0f, 1f),
                            modifier = Modifier
                                .width(80.dp)
                                .height(3.dp)
                                .clip(RoundedCornerShape(2.dp)),
                            color = Color.White,
                            trackColor = Color.White.copy(alpha = 0.2f),
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "$volumePercent%",
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Light
                        )
                    }
                }
            }
        }

    }
}

@Composable
private fun RoundFAButton(
    icon: String,
    iconSize: TextUnit = 20.sp,
    size: Dp = 42.dp,
    bgAlpha: Float = 0.1f,
    fa: FontFamily,
    onClick: () -> Unit
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = bgAlpha))
            .clickable { onClick() }
            .focusable()
    ) {
        val isPlay = icon == FAIcons.PLAY
        Text(
            text = icon,
            fontFamily = fa,
            fontSize = iconSize,
            color = Color.White.copy(alpha = 0.8f),
            modifier = if (isPlay) Modifier.graphicsLayer { translationX = 2.dp.toPx() } else Modifier
        )
    }
}

@Composable
private fun MarqueeText(
    text: String,
    color: Color,
    fontSize: TextUnit,
    fontWeight: FontWeight = FontWeight.Normal,
    alignLeft: Boolean = false
) {
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current

    val textStyle = TextStyle(
        fontSize = fontSize,
        fontWeight = fontWeight,
        lineHeight = (fontSize.value * 1.4f).sp
    )
    val textLayoutResult = remember(text, fontSize) {
        textMeasurer.measure(text, textStyle)
    }
    val textWidth = textLayoutResult.size.width
    val boxHeight = with(density) { (fontSize.value * fontScale * 2.2f).dp }
    val gap = with(density) { 160 }

    var containerWidth by remember { mutableIntStateOf(0) }
    val overflows = containerWidth > 0 && textWidth > containerWidth

    val scrollDistance = containerWidth + gap
    val scrollDuration = (scrollDistance / 0.16f).toInt().coerceIn(3000, 20000)
    val offset = remember { Animatable(0f) }
    LaunchedEffect(text, containerWidth, overflows) {
        if (overflows && containerWidth > 0) {
            while (true) {
                offset.snapTo(0f)
                delay(2000)
                offset.animateTo(
                    targetValue = -scrollDistance.toFloat(),
                    animationSpec = tween(durationMillis = scrollDuration, easing = LinearEasing)
                )
                delay(5000)
            }
        } else {
            offset.snapTo(0f)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(boxHeight)
            .onGloballyPositioned { containerWidth = it.size.width }
            .clipToBounds(),
        contentAlignment = if (overflows || alignLeft) Alignment.CenterStart else Alignment.Center
    ) {
        if (overflows) {
            // Original plus a clone at the right edge with a 160px gap ahead of it.
            // The clone becomes visible after the gap scrolls into view.
            Text(
                text = text,
                color = color,
                style = textStyle,
                maxLines = 1,
                modifier = Modifier.graphicsLayer { translationX = offset.value }
            )
            Text(
                text = text,
                color = color,
                style = textStyle,
                maxLines = 1,
                modifier = Modifier.graphicsLayer { translationX = offset.value + containerWidth + gap }
            )
        } else {
            Text(
                text = text,
                color = color,
                style = textStyle,
                textAlign = if (alignLeft) TextAlign.Start else TextAlign.Center,
                maxLines = 1,
                modifier = if (alignLeft) Modifier.fillMaxWidth() else Modifier
            )
        }
    }
}

private fun formatTime(ms: Long): String {
    if (ms < 0) return "0:00"
    val totalSec = ms / 1000
    val min = totalSec / 60
    val sec = totalSec % 60
    return String.format("%d:%02d", min, sec)
}
