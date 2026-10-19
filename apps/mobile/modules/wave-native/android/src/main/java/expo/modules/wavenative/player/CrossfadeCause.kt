package expo.modules.wavenative.player

import androidx.media3.common.Player

/**
 * What changed the song, or where a seek came from, as a crossfade line in
 * the app log names it ("song changed by Next"), so a skip or a seek by the
 * owner can't be taken for a crossfade failure.
 */
data class CrossfadeCause(val phrase: String) {
  companion object {
    val SongEnded = CrossfadeCause("the song ending")
    val Repeat = CrossfadeCause("repeat one")
    val ListChanged = CrossfadeCause("a change to the player's list")
    val UnnamedMove = CrossfadeCause("an unnamed move")
    val UnnamedSeek = CrossfadeCause("an unnamed seek")

    /** The phrase for each id of Core's `SongChangeCause` and `SeekSource`, which JS sends with each move and seek. */
    internal val APP_PHRASES = mapOf(
      "next" to "Next",
      "previous" to "Previous",
      "queueTap" to "a tap in the queue",
      "play" to "playing a new queue",
      "player" to "the queue following the player",
      "trackEnded" to "the queue running out",
      "search" to "a search answer",
      "undo" to "Undo",
      "restore" to "the queue restored",
      "queue" to "a queue change",
      "scrubber" to "the scrubber",
      "lyric" to "a lyric tap",
      "previousRestart" to "Previous restarting the song",
      "queueEnd" to "the queue ending",
    )

    fun fromApp(id: String) = CrossfadeCause(APP_PHRASES[id] ?: "the app ($id)")
  }
}

/**
 * Who asked for the player's next move or seek, until the service's player
 * makes it, a little later: the app (JS names it with its sync or seek), a
 * media session controller (the notification, Android Auto, the system's
 * media controls), or a media button (a headset). Each note names one change;
 * one that never came is forgotten after [WAIT_MS]. A song ending on its own
 * (or repeat one starting it again) is that whatever was noted, and spends
 * the note. Times are elapsed-realtime ms. Main thread only.
 */
class CrossfadeCauses {
  private var noted: CrossfadeCause? = null
  private var notedAtMs = 0L
  private var mediaButtonAtMs: Long? = null

  /** The app's move or seek: an id of Core's `SongChangeCause` or `SeekSource`. */
  fun noteApp(id: String, nowMs: Long) = note(CrossfadeCause.fromApp(id), nowMs)

  /**
   * The app's sync, which [apply] makes on the player: [id] (Core's
   * `SongChangeCause`, or null) names the song change it makes. A sync that
   * leaves the player on its song ([currentKey] the same before and after)
   * names nothing, so its note can't be pinned on a later move or seek. The
   * player may move before [apply] returns; that move takes the note.
   */
  fun <T> sync(id: String?, nowMs: Long, currentKey: () -> String?, apply: () -> T): T {
    if (id == null) return apply()
    val before = currentKey()
    val cause = CrossfadeCause.fromApp(id)
    note(cause, nowMs)
    try {
      return apply()
    } finally {
      if (currentKey() == before && noted === cause) noted = null
    }
  }

  /** A player command from the session controller described as [from]. */
  fun noteSession(from: String, nowMs: Long) {
    // A media button just pressed becomes this command: it stays the button.
    val pressedAt = mediaButtonAtMs
    if (pressedAt != null && nowMs - pressedAt <= MEDIA_BUTTON_MS) return
    note(CrossfadeCause("a session command from $from"), nowMs)
  }

  /** A media button (a headset, the notification's buttons) from the controller described as [from]. */
  fun noteMediaButton(from: String, nowMs: Long) {
    note(CrossfadeCause("a media button from $from"), nowMs)
    mediaButtonAtMs = nowMs
  }

  /** What moved the player to another song, for a media item transition's [reason]. */
  fun move(reason: Int, nowMs: Long): CrossfadeCause =
    when (reason) {
      Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> CrossfadeCause.SongEnded.also { take(nowMs) }
      Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> CrossfadeCause.Repeat.also { take(nowMs) }
      Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED -> take(nowMs) ?: CrossfadeCause.ListChanged
      else -> take(nowMs) ?: CrossfadeCause.UnnamedMove
    }

  /** Where a seek within the playing song came from. */
  fun seek(nowMs: Long): CrossfadeCause = take(nowMs) ?: CrossfadeCause.UnnamedSeek

  /**
   * The note still waiting for its move, left in place: a request the service
   * answers later (Android Auto playing a song that is searched first) gives
   * it to [noteAgain] with the answer, however long that took.
   */
  fun held(nowMs: Long): CrossfadeCause? = noted?.takeIf { nowMs - notedAtMs <= WAIT_MS }

  /** Notes [cause] (from [held]) again, for the move a late answer makes; null notes nothing. */
  fun noteAgain(cause: CrossfadeCause?, nowMs: Long) {
    if (cause != null) note(cause, nowMs)
  }

  private fun note(cause: CrossfadeCause, nowMs: Long) {
    noted = cause
    notedAtMs = nowMs
    mediaButtonAtMs = null
  }

  private fun take(nowMs: Long): CrossfadeCause? {
    val cause = noted ?: return null
    noted = null
    mediaButtonAtMs = null
    return if (nowMs - notedAtMs > WAIT_MS) null else cause
  }

  private companion object {
    /** Far longer than a command takes to reach the service's player. */
    const val WAIT_MS = 2000L

    /** How long after a media button its player command counts as the button's. */
    const val MEDIA_BUTTON_MS = 500L
  }
}
