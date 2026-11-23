package expo.modules.wavenative.player

/** What [PlaybackRuntimeHold] does to the runtime and its one pending let-go. */
interface RuntimeHoldHost {
  /** Holds the JS runtime as [PlaybackRuntimeHold.OWNER] ([JsRuntime.ensureStarted]). */
  fun hold()

  /** Lets the runtime go as [PlaybackRuntimeHold.OWNER] ([JsRuntime.release]). */
  fun letGo()

  /** Calls [PlaybackRuntimeHold.pauseOver] in [delayMs], replacing a let-go already waiting. */
  fun scheduleLetGo(delayMs: Long)

  fun cancelLetGo()
}

/**
 * Keeps Wave's JS runtime running while the player plays, as its own owner
 * ([RuntimeOwners]), so JS timers, and the Magic Queue's batches with them, go on
 * with the screen off. A pause holds it [pauseMs] more, so a short one costs no
 * restart; after a longer pause, or a stop, playback lets it go, and playing again
 * takes it back. Other owners (Auto, downloads, Recognize) hold it on their own.
 *
 * Main thread only.
 */
class PlaybackRuntimeHold(
  private val host: RuntimeHoldHost,
  private val pauseMs: Long = LONG_PAUSE_MS,
) {
  /** Whether playback holds the runtime now. */
  var holding = false
    private set

  private var waiting = false

  /** The player now plays, or wants to (buffering), or doesn't. */
  fun update(playing: Boolean) {
    if (playing) {
      if (waiting) {
        waiting = false
        host.cancelLetGo()
      }
      if (!holding) {
        holding = true
        host.hold()
      }
    } else if (holding && !waiting) {
      waiting = true
      host.scheduleLetGo(pauseMs)
    }
  }

  /** The pause lasted [pauseMs]: playback lets the runtime go. */
  fun pauseOver() {
    if (!waiting) return
    waiting = false
    letGo()
  }

  /** The service stops: playback lets the runtime go at once. */
  fun stop() {
    if (waiting) {
      waiting = false
      host.cancelLetGo()
    }
    letGo()
  }

  private fun letGo() {
    if (!holding) return
    holding = false
    host.letGo()
  }

  companion object {
    /** The runtime owner playback holds it as. */
    const val OWNER = "playback"

    /** How long a pause keeps the runtime. */
    const val LONG_PAUSE_MS = 10 * 60_000L
  }
}
