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
 * [PlaybackModes] back, which the buttons then show. The star doesn't wait
 * for that: a tap flips it at once ([PlaybackModesState.pressStar]). Plain
 * Kotlin, so it is JVM-testable; [PlaybackService] turns it into Media3
 * commands and buttons.
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

  /** The star the last press on Favorite asked for, while JS hasn't answered every press. */
  private var pressed: Boolean? = null

  /** Presses on Favorite JS hasn't answered yet, all on the playing song. */
  private var unanswered = 0

  /** The playing song's media id, and how many times the song has changed. */
  private var song: String? = null
  private var songChanges = 0

  /** What the buttons show: [current], with a pressed star ahead of JS's answer. */
  val shown: PlaybackModes
    get() = pressed?.let { current.copy(starred = it) } ?: current

  /** Records [modes] and tells the listeners when what the buttons show changed. */
  fun publish(modes: PlaybackModes) = change { current = modes }

  /**
   * The player is on the song [mediaId], or on none. A pressed star belongs to the song it
   * was pressed on, so once another song plays the buttons show what JS reports, and the
   * answers still due for the last song count for nothing ([starAnswered]).
   */
  fun playing(mediaId: String?) = change {
    if (mediaId != song) {
      song = mediaId
      songChanges++
      pressed = null
      unanswered = 0
    }
  }

  /**
   * A press on Favorite: the star flips at once, before JS toggles and saves it. Returns the
   * press, to hand to [starAnswered] with JS's answer.
   */
  fun pressStar(): Int {
    change {
      pressed = !shown.starred
      unanswered++
    }
    return songChanges
  }

  /**
   * JS answered [press], or never did. Once it has answered every press on the playing song
   * the buttons show what JS reports again. It reports a toggled star before it answers, so
   * a press that worked changes nothing here; one that failed, and a star whose write fails
   * later, go back to the star JS holds. An answer to a press on a song that has since
   * changed is ignored.
   */
  fun starAnswered(press: Int) = change {
    if (press == songChanges) {
      if (unanswered > 0) unanswered--
      if (unanswered == 0) pressed = null
    }
  }

  private inline fun change(block: () -> Unit) {
    val before = shown
    block()
    val after = shown
    if (after != before) listeners.toList().forEach { it(after) }
  }

  /** Calls [listener] whenever what the buttons show changes; the returned function stops it. */
  fun listen(listener: (PlaybackModes) -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }
}
