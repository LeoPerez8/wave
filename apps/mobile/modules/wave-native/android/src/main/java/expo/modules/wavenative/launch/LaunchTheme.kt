package expo.modules.wavenative.launch

/** One mode's launch colours as opaque ARGB ints. */
data class LaunchColors(val background: Int, val primary: Int, val secondary: Int)

/**
 * What Wave opens on, as Core's `launchTheme` decides it from the theme chosen
 * in Settings: the splash style for Android to draw (null for the manifest's,
 * which has the shipped grounds) and each mode's ground, primary and secondary.
 */
data class LaunchTheme(val splashTheme: String?, val light: LaunchColors, val dark: LaunchColors) {
  fun colors(night: Boolean): LaunchColors = if (night) dark else light

  /** As [LaunchThemeStore] saves it: flat entries for SharedPreferences. */
  fun toEntries(): Map<String, Any> = buildMap {
    splashTheme?.let { put(SPLASH_THEME, it) }
    for ((mode, colors) in listOf(LIGHT to light, DARK to dark)) {
      put("$mode.$BACKGROUND", colors.background)
      put("$mode.$PRIMARY", colors.primary)
      put("$mode.$SECONDARY", colors.secondary)
    }
  }

  companion object {
    private const val SPLASH_THEME = "splashTheme"
    private const val LIGHT = "light"
    private const val DARK = "dark"
    private const val BACKGROUND = "background"
    private const val PRIMARY = "primary"
    private const val SECONDARY = "secondary"

    /** From JS, colours as `#rrggbb`; null when anything is missing or malformed. */
    fun fromJs(theme: Map<String, Any?>): LaunchTheme? {
      fun colors(mode: String): LaunchColors? {
        val colors = theme[mode] as? Map<*, *> ?: return null
        fun color(key: String) = (colors[key] as? String)?.let(::parseColor)
        return LaunchColors(
          color(BACKGROUND) ?: return null,
          color(PRIMARY) ?: return null,
          color(SECONDARY) ?: return null,
        )
      }
      return LaunchTheme(
        theme[SPLASH_THEME] as? String,
        colors(LIGHT) ?: return null,
        colors(DARK) ?: return null,
      )
    }

    /** From what [toEntries] saved; null when nothing (or not all of it) was. */
    fun fromEntries(entries: Map<String, *>): LaunchTheme? {
      fun colors(mode: String): LaunchColors? {
        return LaunchColors(
          entries["$mode.$BACKGROUND"] as? Int ?: return null,
          entries["$mode.$PRIMARY"] as? Int ?: return null,
          entries["$mode.$SECONDARY"] as? Int ?: return null,
        )
      }
      return LaunchTheme(
        entries[SPLASH_THEME] as? String,
        colors(LIGHT) ?: return null,
        colors(DARK) ?: return null,
      )
    }

    private val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}$")

    /** `#rrggbb` as an opaque ARGB int (no `android.graphics.Color`, so it runs in JVM tests). */
    private fun parseColor(hex: String): Int? =
      if (HEX_COLOR.matches(hex)) (0xFF000000 or hex.substring(1).toLong(16)).toInt() else null
  }
}
