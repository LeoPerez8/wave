package expo.modules.wavenative.player

import androidx.media3.common.Player
import java.util.Locale

/**
 * The app-log line for a song change's crossfade outcome. Skipped and cut lines
 * name what changed the song, or where a seek came from ([CrossfadeCause]), so a
 * skip or a seek by the owner can't be taken for a crossfade failure; a cut line
 * gives each player's state as well.
 */
object CrossfadeLog {
  /** A player's state at a cut, as the line gives it. */
  data class DeckState(
    val positionMs: Long,
    val playbackState: Int,
    val playWhenReady: Boolean,
    val isPlaying: Boolean,
    val suppression: Int,
  )

  /** [main] is the session's player, [outgoing] the second player; null when there is none. */
  fun line(outcome: CrossfadeOutcome, main: DeckState?, outgoing: DeckState?): String =
    when (outcome) {
      is CrossfadeOutcome.Skipped -> {
        val late = if (outcome.lateMs > 0) " (${seconds(outcome.lateMs)} late)" else ""
        val changedBy = outcome.cause?.let { "; song changed by ${it.says}" } ?: ""
        "Crossfade skipped: ${reason(outcome.why, outcome.seekFrom)}$late$changedBy"
      }
      is CrossfadeOutcome.Done ->
        "Crossfade done: ${seconds(outcome.overlapMs)} overlap" +
          if (outcome.lateMs > LATE_REPORT_MS) " (${seconds(outcome.lateMs)} short, the next song was late)" else ""
      is CrossfadeOutcome.Cut -> {
        val of = outcome.overlapMs?.let { "of ${seconds(it)}" } ?: "before the next song sounded"
        "Crossfade cut ${seconds(outcome.elapsedMs)} in $of: ${reason(outcome.why, outcome.cause)}; " +
          "main ${state(main)}; outgoing ${state(outgoing)}"
      }
    }

  private fun reason(why: CrossfadeReason, by: CrossfadeCause?): String =
    if (by == null) why.reason else "${why.reason} (${by.says})"

  private fun state(deck: DeckState?): String {
    if (deck == null) return "none"
    val state = when (deck.playbackState) {
      Player.STATE_IDLE -> "idle"
      Player.STATE_BUFFERING -> "buffering"
      Player.STATE_READY -> "ready"
      Player.STATE_ENDED -> "ended"
      else -> "state ${deck.playbackState}"
    }
    return "at ${deck.positionMs} ms, $state, playWhenReady=${deck.playWhenReady}, " +
      "isPlaying=${deck.isPlaying}, suppression=${deck.suppression}"
  }

  /** A done overlap shorter than the song's whole one by more than this says it was late. */
  private const val LATE_REPORT_MS = 500L

  private fun seconds(ms: Long) = String.format(Locale.ROOT, "%.1f s", ms / 1000.0)
}
