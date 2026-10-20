package com.castboxtv.app.viz

import java.util.concurrent.atomic.AtomicReference

data class AudioLevels(
    val rms: Float = 0f,
    val peak: Float = 0f,
    val bass: Float = 0f
)

object AudioLevelStore {

    private val ref = AtomicReference(AudioLevels())

    fun update(levels: AudioLevels) {
        ref.set(levels)
    }

    fun get(): AudioLevels = ref.get() ?: AudioLevels()
}
