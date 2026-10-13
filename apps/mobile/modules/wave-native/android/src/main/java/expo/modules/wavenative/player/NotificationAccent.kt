package expo.modules.wavenative.player

import android.content.Context

/** The chosen primary's tone in each scheme, as opaque ARGB colours. */
data class AccentColours(val light: Int, val dark: Int) {
  /** The tone for the system's current scheme. */
  fun forScheme(night: Boolean): Int = if (night) dark else light
}

/**
 * The colour of the media notification, where Android or One UI takes one
 * from the app: the primary chosen in Settings › Theme. JS sends it whenever
 * the theme applies; it is kept on disk so a service started without JS (Auto,
 * playback resumption) colours the notification too. [PlaybackService] lays
 * it on the notification ([WaveNotificationProvider]) and redraws it on a
 * change.
 */
object NotificationAccent {
  private const val PREFS = "wave.notification"
  private const val LIGHT = "accentLight"
  private const val DARK = "accentDark"

  private val TONE = Regex("^#[0-9a-fA-F]{6}$")

  /** JS's `#rrggbb` tones, or null when either isn't one. */
  fun fromJs(light: String, dark: String): AccentColours? {
    val lightColour = parse(light) ?: return null
    val darkColour = parse(dark) ?: return null
    return AccentColours(lightColour, darkColour)
  }

  private fun parse(tone: String): Int? =
    if (TONE.matches(tone)) (0xFF000000 or tone.substring(1).toLong(16)).toInt() else null

  /** The process-wide accent: [WavePlayerModule] publishes, [PlaybackService] listens. */
  val state = AccentState()

  /** Picks up the accent kept on disk, unless JS already published one. */
  fun init(context: Context) {
    if (state.current != null) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.contains(LIGHT) || !prefs.contains(DARK)) return
    state.publish(AccentColours(prefs.getInt(LIGHT, 0), prefs.getInt(DARK, 0)))
  }

  /** Records [colours] on disk and for the listeners. Call it on the main thread. */
  fun publish(context: Context, colours: AccentColours) {
    if (!state.publish(colours)) return
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putInt(LIGHT, colours.light)
      .putInt(DARK, colours.dark)
      .apply()
  }
}

/** The latest [AccentColours]; publish and listen on the main thread. */
class AccentState {
  private val listeners = mutableListOf<(AccentColours) -> Unit>()

  var current: AccentColours? = null
    private set

  /** Records [colours] and tells the listeners; false when they were already current. */
  fun publish(colours: AccentColours): Boolean {
    if (colours == current) return false
    current = colours
    listeners.toList().forEach { it(colours) }
    return true
  }

  /** Calls [listener] on every change; the returned function stops it. */
  fun listen(listener: (AccentColours) -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }
}
