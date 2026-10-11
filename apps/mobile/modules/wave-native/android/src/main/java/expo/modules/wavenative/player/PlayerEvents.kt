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

  /** Why the current item changed: played through, repeated, skipped/seeked, or the list changed. */
  fun transitionReason(reason: Int): String =
    when (reason) {
      Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "auto"
      Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "repeat"
      Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "seek"
      else -> "playlist"
    }

  /** A duration in ms, or null while it is unknown. */
  fun duration(ms: Long): Double? = if (ms == C.TIME_UNSET || ms < 0) null else ms.toDouble()
}
