package com.castboxtv.app.ui

import androidx.compose.runtime.Composable
import com.castboxtv.app.dlna.DlnaMediaService

@Composable
fun MainScreen(service: DlnaMediaService?) {
    NowPlayingScreen(service = service)
}
