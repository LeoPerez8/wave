package expo.modules.wavenative.player

import expo.modules.wavenative.locale.NativeText
/** Core's `RepeatMode`. */
enum class RepeatSetting(val wire: String) {
  OFF("off"),
  ALL("all"),
  ONE("one"),
}

/**
 * The queue's shuffle and repeat, and whether the playing song is a favorite ([starred]), as
 * JS last reported them. The buttons show shuffle and the star; repeat is kept for a resume
 * ([ResumeStore]).
 */
data class PlaybackModes(
  val shuffle: Boolean = false,
  val repeat: RepeatSetting = RepeatSetting.OFF,
  val starred: Boolean = false,
)

/** Media3's command-button icons the mode buttons use. */
enum class ModeIcon { SHUFFLE_ON, SHUFFLE_OFF, STAR_FILLED, STAR_OUTLINE }

/** One button on Auto's player screen: the custom action it sends, its icon and label. */
data class ModeButton(val action: String, val icon: ModeIcon, val label: String)

/** A request for JS over [AutoBridge]: its type and JSON payload. */
data class AutoCommandRequest(val type: String, val payload: String)

/**
 * Shuffle and Favorite on the media notification and Auto's player screen
 * (which shares the notification's buttons). The buttons are custom session
 * commands (the player's own shuffle stays off): a tap is forwarded to JS,
 * whose queue engine toggles shuffle, or which toggles the playing song's star,
 * exactly as the app's buttons do, and JS reports the resulting
 * [PlaybackModes] back, which the buttons then show. Plain Kotlin, so it is
 * JVM-testable; [PlaybackService] turns it into Media3 commands and buttons.
 */
object AutoModes {
  const val SHUFFLE_ACTION = "expo.modules.wavenative.AUTO_SHUFFLE"
  const val FAVORITE_ACTION = "expo.modules.wavenative.AUTO_FAVORITE"

  const val ACTIONS_TYPE = "command"

  /** The bridge request a tap on [action] sends, or null when it isn't a mode button. */
  fun request(action: String): AutoCommandRequest? =
    when (action) {
      SHUFFLE_ACTION -> AutoCommandRequest(ACTIONS_TYPE, """{"command":"toggleShuffle"}""")
      FAVORITE_ACTION -> AutoCommandRequest(ACTIONS_TYPE, """{"command":"toggleFavorite"}""")
      else -> null
    }

  /** The buttons showing [modes]: shuffle, then the playing song's star. */
  fun buttons(modes: PlaybackModes): List<ModeButton> =
    listOf(
      if (modes.shuffle) {
        ModeButton(SHUFFLE_ACTION, ModeIcon.SHUFFLE_ON, NativeText.get("shuffleOn"))
      } else {
        ModeButton(SHUFFLE_ACTION, ModeIcon.SHUFFLE_OFF, NativeText.get("shuffleOff"))
      },
      if (modes.starred) {
        ModeButton(FAVORITE_ACTION, ModeIcon.STAR_FILLED, NativeText.get("unfavorite"))
      } else {
        ModeButton(FAVORITE_ACTION, ModeIcon.STAR_OUTLINE, NativeText.get("favorite"))
      },
    )

  /** JS's `setModes` arguments, or null for an unknown repeat mode. */
  fun fromJs(shuffle: Boolean, repeat: String, starred: Boolean): PlaybackModes? =
    RepeatSetting.entries.firstOrNull { it.wire == repeat }?.let { PlaybackModes(shuffle, it, starred) }

  /** The process-wide modes: [WavePlayerModule] publishes, [PlaybackService] listens. */
  val state = PlaybackModesState()
}

/**
 * The latest [PlaybackModes] JS published. It outlives the service and the JS
 * runtime, so a service created later starts from the current modes.
 * Publish and listen on the main thread.
 */
class PlaybackModesState {
  private val listeners = mutableListOf<(PlaybackModes) -> Unit>()

  var current = PlaybackModes()
    private set

  /** Records [modes] and tells the listeners when they changed. */
  fun publish(modes: PlaybackModes) {
    if (modes == current) return
    current = modes
    listeners.toList().forEach { it(modes) }
  }

  /** Calls [listener] on every change; the returned function stops it. */
  fun listen(listener: (PlaybackModes) -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }
}
