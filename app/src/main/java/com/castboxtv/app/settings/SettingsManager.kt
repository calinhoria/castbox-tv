package com.castboxtv.app.settings

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import com.castboxtv.app.audio.CrossfadeAlgorithm
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

class SettingsManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("castbox_settings", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_DISPLAY_NAME = "display_name"
        private const val KEY_DEVICE_UDN = "device_udn"
        private const val KEY_CROSSFADE_ENABLED = "crossfade_enabled"
        private const val KEY_CROSSFADE_DURATION = "crossfade_duration"
        private const val KEY_CROSSFADE_ALGORITHM = "crossfade_algorithm"
        private const val KEY_APPVIZ_ENABLED = "appviz_enabled"
        private const val KEY_APPVIZ_PRESET = "appviz_preset"
        private const val KEY_APPVIZ_CYCLE = "appviz_cycle"
        private const val KEY_APPVIZ_CYCLE_SECS = "appviz_cycle_secs"
        private const val KEY_APPVIZ_USE_COVER_PALETTE = "appviz_use_cover_palette"
        private const val KEY_APPVIZ_SHOW_FPS = "appviz_show_fps"
        private const val KEY_APPVIZ_PACK = "appviz_pack"
        private const val KEY_APPVIZ_SHOW_NAME = "appviz_show_name"
        private const val KEY_APPVIZ_MOCK_AUDIO = "appviz_mock_audio"
        private const val KEY_APPVIZ_FAVORITES = "appviz_favorites"
        private const val FALLBACK_NAME = "CastBox TV"
        private const val DEFAULT_CROSSFADE_DURATION = 6
    }

    private val defaultName: String = Settings.Global.getString(
        context.contentResolver, Settings.Global.DEVICE_NAME
    )?.takeIf { it.isNotBlank() } ?: FALLBACK_NAME

    var displayName: String
        get() = prefs.getString(KEY_DISPLAY_NAME, defaultName) ?: defaultName
        set(value) = prefs.edit().putString(KEY_DISPLAY_NAME, value).apply()

    val deviceUdn: UUID
        get() {
            val saved = prefs.getString(KEY_DEVICE_UDN, null)
            if (saved != null) return UUID.fromString(saved)
            val newId = UUID.randomUUID()
            prefs.edit().putString(KEY_DEVICE_UDN, newId.toString()).apply()
            return newId
        }

    var crossfadeEnabled: Boolean
        get() = prefs.getBoolean(KEY_CROSSFADE_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_CROSSFADE_ENABLED, value).apply()

    var crossfadeDuration: Int
        get() = prefs.getInt(KEY_CROSSFADE_DURATION, DEFAULT_CROSSFADE_DURATION)
        set(value) = prefs.edit().putInt(KEY_CROSSFADE_DURATION, value.coerceIn(3, 12)).apply()

    var crossfadeAlgorithm: CrossfadeAlgorithm
        get() {
            val name = prefs.getString(KEY_CROSSFADE_ALGORITHM, null)
            return CrossfadeAlgorithm.fromName(name ?: CrossfadeAlgorithm.EQUAL_POWER.name)
        }
        set(value) = prefs.edit().putString(KEY_CROSSFADE_ALGORITHM, value.name).apply()

    var appVizEnabled: Boolean
        get() = prefs.getBoolean(KEY_APPVIZ_ENABLED, true)
        set(value) = prefs.edit().putBoolean(KEY_APPVIZ_ENABLED, value).apply()

    var appVizPreset: String
        get() = prefs.getString(KEY_APPVIZ_PRESET, "") ?: ""
        set(value) = prefs.edit().putString(KEY_APPVIZ_PRESET, value).apply()

    var appVizCycle: Boolean
        get() = prefs.getBoolean(KEY_APPVIZ_CYCLE, false)
        set(value) = prefs.edit().putBoolean(KEY_APPVIZ_CYCLE, value).apply()

    var appVizCycleSecs: Int
        get() = prefs.getInt(KEY_APPVIZ_CYCLE_SECS, 8)
        set(value) = prefs.edit().putInt(KEY_APPVIZ_CYCLE_SECS, value.coerceIn(5, 120)).apply()

    var appVizUseCoverPalette: Boolean
        get() = prefs.getBoolean(KEY_APPVIZ_USE_COVER_PALETTE, true)
        set(value) = prefs.edit().putBoolean(KEY_APPVIZ_USE_COVER_PALETTE, value).apply()

    var appVizShowFps: Boolean
        get() = prefs.getBoolean(KEY_APPVIZ_SHOW_FPS, false)
        set(value) = prefs.edit().putBoolean(KEY_APPVIZ_SHOW_FPS, value).apply()

    var appVizPack: String
        get() = prefs.getString(KEY_APPVIZ_PACK, "builtin") ?: "builtin"
        set(value) = prefs.edit().putString(
            KEY_APPVIZ_PACK,
            if (value in setOf("classic", "full", "favorites", "butterchurn", "builtin")) value else "builtin"
        ).apply()

    var appVizShowName: Boolean
        get() = prefs.getBoolean(KEY_APPVIZ_SHOW_NAME, false)
        set(value) = prefs.edit().putBoolean(KEY_APPVIZ_SHOW_NAME, value).apply()

    var appVizMockAudio: Boolean
        get() = prefs.getBoolean(KEY_APPVIZ_MOCK_AUDIO, false)
        set(value) = prefs.edit().putBoolean(KEY_APPVIZ_MOCK_AUDIO, value).apply()

    var appVizFavorites: String
        get() = prefs.getString(KEY_APPVIZ_FAVORITES, "") ?: ""
        set(value) = prefs.edit().putString(KEY_APPVIZ_FAVORITES, value).apply()

}
