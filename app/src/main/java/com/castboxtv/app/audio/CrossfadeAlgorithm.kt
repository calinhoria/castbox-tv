package com.castboxtv.app.audio

import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin

enum class CrossfadeAlgorithm(val displayName: String) {
    LINEAR("Linear"),
    LOGARITHMIC("Log"),
    EXPONENTIAL("Exp"),
    S_CURVE("S-Curve"),
    EQUAL_POWER("Eq Power");

    companion object {
        fun fromName(name: String): CrossfadeAlgorithm {
            return entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: EQUAL_POWER
        }
    }

    /**
     * Returns (currentTrackVolume, nextTrackVolume) for a given progress 0..1.
     */
    fun computeVolumes(progress: Float): Pair<Float, Float> {
        val p = progress.coerceIn(0f, 1f)
        return when (this) {
            LINEAR -> Pair(1f - p, p)
            LOGARITHMIC -> {
                val fadeIn = log10(1f + 9f * p)
                val fadeOut = log10(1f + 9f * (1f - p))
                Pair(fadeOut, fadeIn)
            }
            EXPONENTIAL -> {
                val fadeIn = (10f.pow(p) - 1f) / 9f
                val fadeOut = (10f.pow(1f - p) - 1f) / 9f
                Pair(fadeOut, fadeIn)
            }
            S_CURVE -> {
                val fadeIn = 0.5f * (1f - cos(Math.PI * p).toFloat())
                val fadeOut = 1f - fadeIn
                Pair(fadeOut, fadeIn)
            }
            EQUAL_POWER -> {
                val fadeIn = sin((Math.PI / 2.0) * p).toFloat()
                val fadeOut = sin((Math.PI / 2.0) * (1f - p)).toFloat()
                Pair(fadeOut, fadeIn)
            }
        }
    }
}
