package expo.modules.wavenative.player

import androidx.media3.common.C
import androidx.media3.common.Player

/** How player state and events are named for JS. */
object PlayerEvents {
  fun status(playbackState: Int): String =
    when (playbackState) {
      Player.STATE_BUFFERING -> "buffering"
      Player.STATE_READY -> "ready"
      Player.STATE_ENDED -> "ended"
      else -> "idle"
    }

  /**
   * Why the current item changed: played through, repeated, skipped/seeked, or
   * the list changed. Transitions caused by Wave syncing the queue are `sync`,
   * so JS doesn't mistake its own seeks for the notification's.
   */
  fun transitionReason(reason: Int, duringSync: Boolean = false): String =
    when {
      duringSync -> "sync"
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "auto"
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "repeat"
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "seek"
      else -> "playlist"
    }

  /** Core's repeat mode as the player's; anything unknown is off. */
  fun repeatMode(mode: String): Int =
    when (mode) {
      "all" -> Player.REPEAT_MODE_ALL
      "one" -> Player.REPEAT_MODE_ONE
      else -> Player.REPEAT_MODE_OFF
    }

  /** A duration in ms, or null while it is unknown. */
  fun duration(ms: Long): Double? = if (ms == C.TIME_UNSET || ms < 0) null else ms.toDouble()
}
