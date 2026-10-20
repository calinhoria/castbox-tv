package com.castboxtv.app.viz

import org.json.JSONObject

/**
 * The 14 named palettes from visualizer/js/palettes.js plus the special
 * "From cover" palette. Roles are published to the engine as variables, so a
 * preset colour of `{primary}` re-themes the whole scene.
 */
object VizPalettes {

    const val FROM_COVER = "From cover"
    const val DEFAULT = "Neon"

    /** The always-on artwork tint role (see withDynamic). */
    const val DYNAMIC = "dynamic"

    /** The six storable roles, in the order the Studio shows them. */
    val ROLES = listOf("bg", "surface", "primary", "secondary", "accent", "text")

    data class Palette(val name: String, val roles: Map<String, String>)

    private fun p(name: String, bg: String, surface: String, primary: String,
                  secondary: String, accent: String, text: String) = Palette(
        name,
        linkedMapOf(
            "bg" to bg, "surface" to surface, "primary" to primary,
            "secondary" to secondary, "accent" to accent, "text" to text,
        ),
    )

    val ALL: List<Palette> = listOf(
        p("Neon", "#05060a", "#131a2a", "#22e1ff", "#ff2d95", "#7cffcb", "#ffffff"),
        p("Sunset", "#1a0b12", "#2c1322", "#ff8a3d", "#ff2d6f", "#ffd166", "#fff4e6"),
        p("Ocean", "#04121f", "#0c2436", "#35c6ff", "#1f6feb", "#7dffd4", "#eaf6ff"),
        p("Forest", "#06110b", "#12261a", "#4ade80", "#15803d", "#fde047", "#ecfdf5"),
        p("Mono", "#0a0a0a", "#1a1a1a", "#f5f5f5", "#9ca3af", "#ffffff", "#ffffff"),
        p("Candy", "#1a0f1e", "#2c1836", "#ff6ec7", "#8b5cf6", "#67e8f9", "#fff0fb"),
        p("Retro", "#1b1436", "#2a2050", "#ff5f6d", "#ffc371", "#38bdf8", "#fef3c7"),
        p("Miami", "#0b0327", "#1a0b3d", "#00f5d4", "#f15bb5", "#fee440", "#ffffff"),
        p("Gold", "#120d04", "#241a08", "#ffd166", "#f59e0b", "#fff3c4", "#fffaf0"),
        p("Ice", "#05121a", "#0e2230", "#a5f3fc", "#38bdf8", "#ffffff", "#f0fdff"),
        p("Ember", "#150704", "#2a0f08", "#ff6b35", "#d92027", "#ffd166", "#fff1e6"),
        p("Cyberpunk", "#0a0118", "#16022e", "#f9f002", "#ff003c", "#00e5ff", "#ffffff"),
        p("Pastel", "#1a1a2e", "#25254a", "#a78bfa", "#f0abfc", "#7dd3fc", "#fdf4ff"),
        p("Deep Space", "#02010a", "#0b0a1f", "#6d5dfc", "#00c2ff", "#ff4d9d", "#e8e6ff"),
    )

    fun names(): List<String> = ALL.map { it.name }

    /**
     * Reads a preset's optional embedded `roles` block. Returns null when the
     * preset has none or it carries nothing usable, so the caller falls back to
     * the named palette. `dynamic` is ignored on purpose: it always follows
     * the artwork and is never stored.
     */
    fun embeddedRoles(root: JSONObject?): Map<String, String>? {
        val obj = root?.optJSONObject("roles") ?: return null
        val out = LinkedHashMap<String, String>()
        for (role in ROLES) {
            val hex = obj.optString(role, "").trim()
            if (hex.matches(Regex("^#[0-9a-fA-F]{6}$"))) out[role] = hex
        }
        return if (out.isEmpty()) null else out
    }

    /**
     * The 7th role: the artwork-derived tint. Published for EVERY palette (not
     * just "From cover") so a preset can mix fixed brand colours with an
     * artwork-tinted backdrop, exactly like visualizer/js/palettes.js.
     */
    fun withDynamic(roles: Map<String, String>, cover: Map<String, String>?): Map<String, String> {
        val dyn = cover?.get(DYNAMIC) ?: CoverPalette.FALLBACK_DYNAMIC
        return LinkedHashMap(roles).apply { put(DYNAMIC, dyn) }
    }

    /** Marks a preset that carries its own roles (nothing to re-theme from). */
    const val EMBEDDED = "__embedded__"

    fun rolesFor(name: String, cover: Map<String, String>?): Map<String, String> {
        val base = if (name == FROM_COVER && !cover.isNullOrEmpty()) cover
                   else ALL.firstOrNull { it.name == name }?.roles ?: ALL[0].roles
        return withDynamic(base, cover)
    }
}
