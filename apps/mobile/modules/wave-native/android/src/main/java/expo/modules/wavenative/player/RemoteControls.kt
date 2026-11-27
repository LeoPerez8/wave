package expo.modules.wavenative.player

import androidx.media3.common.Player

/**
 * What a controller from outside Wave may do (a watch, a remote control, any app's
 * media controls), and the app log's line when one connects (docs/spec.md, story 31
 * and App log). Wave itself, the notification and Android Auto have their own
 * commands in [PlaybackService].
 *
 * Media3 grants a controller it can't verify read-only player commands, and a
 * watch's phone-side app is usually one: Android hides other packages from Wave,
 * so Media3 can't check it. Its play/pause, Next and Previous then showed disabled
 * or did nothing, and were dropped before Wave heard of them. An unverified
 * controller gets the transport commands on top of the read-only ones; replacing
 * the queue, shuffle and repeat stay with Wave.
 */
object RemoteControls {
  /** Play/pause, stop, Next, Previous and seeking, as the notification has them. */
  val TRANSPORT = intArrayOf(
    Player.COMMAND_PLAY_PAUSE,
    Player.COMMAND_PREPARE,
    Player.COMMAND_STOP,
    Player.COMMAND_SEEK_TO_NEXT,
    Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
    Player.COMMAND_SEEK_TO_PREVIOUS,
    Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
    Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
    Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
    Player.COMMAND_SEEK_BACK,
    Player.COMMAND_SEEK_FORWARD,
  )

  /** The player commands of a controller Media3 couldn't verify: the read-only ones and [TRANSPORT]. */
  val untrustedPlayerCommands: Player.Commands
    get() = Player.Commands.Builder().addAllReadOnlyCommands().addAll(*TRANSPORT).build()

  private val logged = mutableSetOf<String>()

  /** Whether [packageName] hasn't connected yet in this process, so its line is written once. */
  @Synchronized
  fun firstConnection(packageName: String): Boolean = logged.add(packageName)

  /**
   * `Media controller com.x connected (legacy, untrusted): play/pause, next, previous, seek`:
   * who connected, how, and which of the transport buttons it can use.
   */
  fun connectedLine(packageName: String, legacy: Boolean, trusted: Boolean, granted: (Int) -> Boolean): String {
    val kind = listOf(if (legacy) "legacy" else "Media3", if (trusted) "trusted" else "untrusted").joinToString(", ")
    val buttons = listOfNotNull(
      "play/pause".takeIf { granted(Player.COMMAND_PLAY_PAUSE) },
      "next".takeIf { granted(Player.COMMAND_SEEK_TO_NEXT) },
      "previous".takeIf { granted(Player.COMMAND_SEEK_TO_PREVIOUS) },
      "seek".takeIf { granted(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM) },
    )
    return "Media controller $packageName connected ($kind): ${buttons.ifEmpty { listOf("no transport") }.joinToString(", ")}"
  }

  const val LOG_TAG = "WaveSession"
}
