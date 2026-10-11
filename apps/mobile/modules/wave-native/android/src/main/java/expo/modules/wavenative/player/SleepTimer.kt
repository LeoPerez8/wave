package expo.modules.wavenative.player

/** What a running sleep timer waits for (Core's `SleepTimer`). */
sealed interface SleepTimerMode {
  /** A wall-clock time; it keeps counting while playback is paused. */
  data class Deadline(val endsAtMs: Long) : SleepTimerMode

  /** The end of the playing track, whichever track that is by then. */
  data object EndOfTrack : SleepTimerMode
}

/** A timer as JS and Core spell it: `{ type: "deadline", endsAt }` or `{ type: "endOfTrack" }`. */
object SleepTimerWire {
  const val DEADLINE = "deadline"
  const val END_OF_TRACK = "endOfTrack"

  fun fromJs(type: String, endsAt: Double?): SleepTimerMode? =
    when (type) {
      DEADLINE -> endsAt?.let { SleepTimerMode.Deadline(it.toLong()) }
      END_OF_TRACK -> SleepTimerMode.EndOfTrack
      else -> null
    }

  fun toJs(mode: SleepTimerMode?): Map<String, Any>? =
    when (mode) {
      is SleepTimerMode.Deadline -> mapOf("type" to DEADLINE, "endsAt" to mode.endsAtMs.toDouble())
      SleepTimerMode.EndOfTrack -> mapOf("type" to END_OF_TRACK)
      null -> null
    }
}

/** What the sleep timer needs from [PlaybackService]. */
interface SleepTimerHost {
  /** Wall-clock milliseconds, the clock JS sets deadlines on. */
  fun nowMs(): Long

  fun pause()

  /** Has the player pause itself at the end of each track (gapless, so nothing of the next one plays). */
  fun setPauseAtEndOfItems(enabled: Boolean)

  /** Calls [SleepTimer.onCheck] after [delayMs], replacing any pending check. */
  fun scheduleCheck(delayMs: Long)

  fun cancelCheck()

  /** The timer started, ended or was cancelled ([mode] is null when none runs). */
  fun onChanged(mode: SleepTimerMode?)
}

/**
 * Enforces the sleep timer inside the playback service, so it pauses playback
 * even while Wave's JS side is suspended in the background.
 */
class SleepTimer(private val host: SleepTimerHost) {
  var mode: SleepTimerMode? = null
    private set

  /** Starts [mode], replacing any running timer. */
  fun start(mode: SleepTimerMode) {
    disarm()
    this.mode = mode
    when (mode) {
      is SleepTimerMode.Deadline -> host.scheduleCheck(mode.endsAtMs - host.nowMs())
      SleepTimerMode.EndOfTrack -> host.setPauseAtEndOfItems(true)
    }
    host.onChanged(mode)
  }

  /** Stops the timer without pausing. */
  fun cancel() = clear()

  /** Ends the running timer, if any, and reports it. */
  private fun clear() {
    if (mode == null) return
    disarm()
    mode = null
    host.onChanged(null)
  }

  private fun disarm() {
    when (mode) {
      is SleepTimerMode.Deadline -> host.cancelCheck()
      SleepTimerMode.EndOfTrack -> host.setPauseAtEndOfItems(false)
      null -> {}
    }
  }

  /**
   * Playback started. While paused the device may sleep and hold the check back
   * past the deadline; the timer has then run out, and the owner's new playback
   * isn't stopped by it.
   */
  fun onResumed() {
    val deadline = mode as? SleepTimerMode.Deadline ?: return
    if (host.nowMs() >= deadline.endsAtMs) clear()
  }

  /** The player paused itself at the end of a track. */
  fun onPausedAtEndOfItem() = trackFinished()

  /** Playback reached the end of the list. */
  fun onEnded() = trackFinished()

  private fun trackFinished() {
    if (mode == SleepTimerMode.EndOfTrack) clear()
  }

  /** The scheduled check ran: pause at the deadline, or wait for the rest if it ran early. */
  fun onCheck() {
    val deadline = mode as? SleepTimerMode.Deadline ?: return
    val left = deadline.endsAtMs - host.nowMs()
    if (left > 0) return host.scheduleCheck(left)
    host.pause()
    clear()
  }
}
