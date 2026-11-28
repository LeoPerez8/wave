package expo.modules.wavenative.player

import androidx.media3.common.C
import androidx.media3.common.Player

/**
 * Why the session's player paused, was held or ran out, and who played it again, as
 * the app log says it (tag `WavePlayback`, docs/spec.md › App log). A pause the owner
 * didn't ask for (another app taking the audio, a lost Bluetooth link, a watch) then
 * shows in the log with what was playing: a Library file or a streamed song, and
 * where in it. No song names.
 */
object PauseLog {
  const val LOG_TAG = "WavePlayback"

  /** Who asked for the next play or pause, noted before the player makes it. */
  val causes = PauseCauses()

  /** What was playing: a streamed YT Music song or a Library file, and where in it. */
  data class Song(val streamed: Boolean, val positionMs: Long, val durationMs: Long)

  /** `Paused by the notification; a Library file at 1:23 of 4:04`. [by] is who asked, when one did. */
  fun pausedLine(reason: Int, by: String?, song: Song?): String {
    val why = when (reason) {
      Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST -> "Paused by ${by ?: "an unnamed command"}"
      Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS -> "Paused: another app took the audio"
      Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY ->
        "Paused: the audio output went away (headphones unplugged or Bluetooth disconnected)"
      Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE -> "Paused by a remote device"
      Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM -> "Paused at the song's end, for the sleep timer"
      Player.PLAY_WHEN_READY_CHANGE_REASON_SUPPRESSED_TOO_LONG -> "Paused: another app held the audio too long"
      else -> "Paused for an unknown reason ($reason)"
    }
    return withSong(why, song)
  }

  /** `Playing again after 4 min 12 s, by com.x`. */
  fun playedLine(reason: Int, by: String?, pausedForMs: Long): String {
    val who = when (reason) {
      Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST -> by ?: "an unnamed command"
      Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE -> "a remote device"
      else -> "an unknown reason ($reason)"
    }
    return "Playing again after ${duration(pausedForMs)}, by $who"
  }

  /** `Held: another app has the audio for a moment; a streamed song at 0:40 of 3:10`. */
  fun heldLine(suppression: Int, song: Song?): String {
    val why = when (suppression) {
      Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS -> "Held: another app has the audio for a moment"
      Player.PLAYBACK_SUPPRESSION_REASON_UNSUITABLE_AUDIO_OUTPUT -> "Held: no suitable audio output"
      else -> "Held for an unknown reason ($suppression)"
    }
    return withSong(why, song)
  }

  /** Whether a hold is the app log's: scrubbing the song holds it too, but that's the owner's own. */
  fun logsHold(suppression: Int): Boolean =
    suppression != Player.PLAYBACK_SUPPRESSION_REASON_NONE && suppression != Player.PLAYBACK_SUPPRESSION_REASON_SCRUBBING

  /** `No longer held, after 8 s`. */
  fun releasedLine(heldForMs: Long): String = "No longer held, after ${duration(heldForMs)}"

  /** `Ended: the player's list ran out; a Library file at 4:04 of 4:04`. */
  fun endedLine(song: Song?): String = withSong("Ended: the player's list ran out", song)

  private fun withSong(text: String, song: Song?): String {
    if (song == null) return text
    val kind = if (song.streamed) "a streamed song" else "a Library file"
    val length = if (song.durationMs == C.TIME_UNSET || song.durationMs < 0) "" else " of ${clock(song.durationMs)}"
    return "$text; $kind at ${clock(song.positionMs)}$length"
  }

  private fun clock(ms: Long): String {
    val seconds = maxOf(0L, ms) / 1000
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
  }

  /** `45 s`, `4 min 12 s`, `1 h 3 min`. */
  fun duration(ms: Long): String {
    val seconds = maxOf(0L, ms) / 1000
    return when {
      seconds < 60 -> "$seconds s"
      seconds < 3600 -> "${seconds / 60} min ${seconds % 60} s"
      else -> "${seconds / 3600} h ${(seconds % 3600) / 60} min"
    }
  }
}

/**
 * Who asked for the player's next play or pause, until it makes it a moment later:
 * Wave (the JS module), a controller (the notification, a watch, Android Auto), a
 * media button (a headset) or the service itself (the sleep timer, a song that
 * can't stream). A note that never became a play or pause is forgotten after
 * [WAIT_MS]. Times are elapsed-realtime ms.
 */
class PauseCauses {
  private var noted: String? = null
  private var notedAtMs = 0L

  @Synchronized
  fun note(by: String, nowMs: Long) {
    noted = by
    notedAtMs = nowMs
  }

  /**
   * A controller's play/pause command: a note made just before (a media button
   * becoming this command, Wave's own call reaching the session) stays.
   */
  @Synchronized
  fun noteUnlessFresh(by: String, nowMs: Long) {
    if (noted != null && nowMs - notedAtMs <= FRESH_MS) return
    note(by, nowMs)
  }

  /** Who asked for the play or pause the player just made, if anyone did lately; spends the note. */
  @Synchronized
  fun take(nowMs: Long): String? {
    val by = noted ?: return null
    noted = null
    return if (nowMs - notedAtMs > WAIT_MS) null else by
  }

  private companion object {
    /** Far longer than a command takes to reach the service's player. */
    const val WAIT_MS = 2000L

    /** How long a note outranks the controller command that follows it. */
    const val FRESH_MS = 500L
  }
}
