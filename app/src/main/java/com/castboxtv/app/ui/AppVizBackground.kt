package com.castboxtv.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.castboxtv.app.dlna.DlnaMediaService
import com.castboxtv.app.viz.ProjectMEngine
import com.castboxtv.app.viz.ProjectMView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Full-bleed native projectM (MilkDrop engine) background for the Play Now
 * screen. Real engine rendering, live ExoPlayer PCM via
 * [com.castboxtv.app.viz.AppVizAudioFeed]. Preset packs: classic / full /
 * favorites (its dir rebuilt from the starred set, cycles only those), plus
 * the "builtin" pack — Visualiser Studio JSON presets rendered by the shared
 * vze engine ([com.castboxtv.app.viz.VizView]).
 */
@Composable
fun AppVizBackground(
    service: DlnaMediaService?,
    presetName: String,
    presetPack: String,
    favoritesVersion: Int,
    @Suppress("UNUSED_PARAMETER") useCoverPalette: Boolean,
    @Suppress("UNUSED_PARAMETER") playing: Boolean,
    title: String = "",
    artist: String = "",
    album: String = ""
) {
    if (presetPack == ProjectMEngine.PACK_BUILTIN) {
        VizBuiltinBackground(service = service, presetName = presetName,
            title = title, artist = artist, album = album)
        return
    }
    var viewRef by remember { mutableStateOf<ProjectMView?>(null) }
    var appliedPack by remember { mutableStateOf<String?>(null) }

    // Copy/refresh preset files on disk (projectM scans a directory).
    LaunchedEffect(service, presetPack, favoritesVersion) {
        val dir = withContext(Dispatchers.IO) {
            service?.let { svc ->
                if (presetPack == ProjectMEngine.PACK_FAVORITES) {
                    ProjectMEngine.refreshFavoritesDir(svc, svc.getAppVizFavorites())
                } else {
                    ProjectMEngine.ensurePresetsOnDisk(svc, presetPack)
                }
            }
        }
        dir?.let {
            val view = viewRef
            if (view != null) {
                if (appliedPack == null) view.providePresets(it)
                else view.switchPack(it) // pack or favorites set changed
            }
            appliedPack = presetPack
        }
    }

    AndroidView(
        factory = { ctx ->
            ProjectMView(ctx).also { view ->
                viewRef = view
                val dir = java.io.File(ctx.filesDir, ProjectMEngine.storageDirFor(presetPack))
                if (dir.isDirectory) view.providePresets(dir)
            }
        },
        update = { view ->
            if (presetName.isNotBlank() && ProjectMEngine.ready) {
                // transition time is 0 by design: always hard-cut, never smooth-blend
                // (smooth doubles CPU/GPU per frame for the blend duration).
                view.selectPresetByName(presetName, hardCut = true)
            }
        },
        onRelease = { view ->
            viewRef = null
        },
        modifier = Modifier.fillMaxSize()
    )
}

/**
 * The "Built in visualiser" background: Studio-authored JSON presets rendered
 * by the shared vze engine. Track metadata flows in as engine variables;
 * cycling is driven by the same appVizCycle settings as the .milk packs.
 */
@Composable
private fun VizBuiltinBackground(
    service: DlnaMediaService?,
    presetName: String,
    title: String,
    artist: String,
    album: String
) {
    AndroidView(
        factory = { ctx -> com.castboxtv.app.viz.VizView(ctx) },
        update = { view ->
            view.trackTitle = title
            view.trackArtist = artist
            view.trackAlbum = album
            val want = presetName.ifBlank { service?.getAppVizPreset() ?: "" }
            if (want.isNotBlank() && want != view.currentPresetName()) {
                val json = service?.getVizPresetJson(want)
                if (json != null) view.loadPreset(json, want)
            }
        },
        modifier = Modifier.fillMaxSize()
    )
}
