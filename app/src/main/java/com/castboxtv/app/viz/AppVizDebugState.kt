package com.castboxtv.app.viz

import androidx.compose.runtime.mutableStateOf

/**
 * Debug stats for the projectM app-visualization (Play Now background).
 * Updated by ProjectMView's renderer once per second; shown as overlay in
 * NowPlayingScreen and served on the web status when enabled.
 */
object AppVizDebugState {
    /** human-readable stats line, e.g. "58.3 fps · 12.4ms · preset #12" */
    @Volatile var stats: androidx.compose.runtime.MutableState<String> =
        androidx.compose.runtime.mutableStateOf("")
}
