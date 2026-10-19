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
   * so JS doesn't mistake its own seeks for the notification's; the move to
   * the next song as a crossfade's overlap starts is `crossfade`. That move is
   * the session's player changing at the handoff, which Media3 reports to
   * controllers as a repeat.
   */
  fun transitionReason(reason: Int, duringSync: Boolean = false, crossfade: Boolean = false): String =
    when {
      duringSync -> "sync"
      crossfade && (reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT || reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) ->
        "crossfade"
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "auto"
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "repeat"
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "seek"
      else -> "playlist"
    }

  /**
   * Whether a position discontinuity is a seek within the current item, reported
   * as `onSeek`. "Previous" after three seconds (Wave, the notification, a
   * headset) is one: it seeks to 0 without an item transition.
   */
  fun isSeekWithinItem(reason: Int, fromItemId: String?, toItemId: String?): Boolean =
    reason == Player.DISCONTINUITY_REASON_SEEK && fromItemId != null && fromItemId == toItemId

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
