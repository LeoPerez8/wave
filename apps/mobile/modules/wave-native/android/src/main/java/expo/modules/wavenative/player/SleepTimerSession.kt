package expo.modules.wavenative.player

import android.os.Bundle
import androidx.media3.session.SessionCommand

/**
 * How [WavePlayerModule] and [PlaybackService] talk about the sleep timer: two
 * custom session commands to start and cancel it, and the session extras,
 * which carry the running timer back to every connected controller.
 */
object SleepTimerSession {
  val START = SessionCommand("expo.modules.wavenative.SLEEP_TIMER_START", Bundle.EMPTY)
  val CANCEL = SessionCommand("expo.modules.wavenative.SLEEP_TIMER_CANCEL", Bundle.EMPTY)

  private const val TYPE = "sleepTimer.type"
  private const val ENDS_AT = "sleepTimer.endsAt"

  /** [mode] as command arguments or session extras; an empty bundle when no timer runs. */
  fun toBundle(mode: SleepTimerMode?): Bundle =
    Bundle().apply {
      when (mode) {
        is SleepTimerMode.Deadline -> {
          putString(TYPE, SleepTimerWire.DEADLINE)
          putLong(ENDS_AT, mode.endsAtMs)
        }
        SleepTimerMode.EndOfTrack -> putString(TYPE, SleepTimerWire.END_OF_TRACK)
        null -> {}
      }
    }

  fun fromBundle(bundle: Bundle): SleepTimerMode? {
    val type = bundle.getString(TYPE) ?: return null
    val endsAt = if (bundle.containsKey(ENDS_AT)) bundle.getLong(ENDS_AT).toDouble() else null
    return SleepTimerWire.fromJs(type, endsAt)
  }
}
