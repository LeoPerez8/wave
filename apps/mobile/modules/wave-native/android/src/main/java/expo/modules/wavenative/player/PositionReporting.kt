package expo.modules.wavenative.player

/** Main-thread reporting demand. MediaSession's clock and resume saves are independent. */
class PositionReporting(
  private val schedule: (Runnable, Long) -> Unit,
  private val cancel: (Runnable) -> Unit,
  private val report: () -> Unit,
) {
  private var requested = false
  private var playing = false
  private val tick = object : Runnable {
    override fun run() {
      if (!requested || !playing) return
      report()
      if (requested && playing) schedule(this, 500L)
    }
  }

  fun setRequested(value: Boolean) {
    if (requested == value) return
    requested = value
    cancel(tick)
    // A consumer returning from the background needs a fresh anchor, even paused.
    if (requested) report()
    if (requested && playing) schedule(tick, 500L)
  }

  fun setPlaying(value: Boolean) {
    if (playing == value) return
    playing = value
    cancel(tick)
    if (requested && playing) schedule(tick, 500L)
  }

  fun stop() {
    requested = false
    playing = false
    cancel(tick)
  }
}
