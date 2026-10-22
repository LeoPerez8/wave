package expo.modules.wavenative.log

import java.util.concurrent.CopyOnWriteArrayList

/**
 * Ticks Wave's [FreezeWatch]es about once a second while Wave is on screen (one
 * of its activities is started), and not otherwise: in the background, with
 * music playing and the screen off, nothing wakes up for them.
 *
 * [repeat] runs the tick about once a second, off the watched threads, until the
 * function it returns is called.
 */
class FreezeWatchdog(private val repeat: (Runnable) -> () -> Unit) {
  private val watches = CopyOnWriteArrayList<FreezeWatch>()
  private var startedActivities = 0
  private var stop: (() -> Unit)? = null

  /** Watches [watch] until the returned function is called. */
  fun watch(watch: FreezeWatch): () -> Unit {
    watches.add(watch)
    return { synchronized(this) { watches.remove(watch); watch.reset() } }
  }

  /** One of Wave's activities started: Wave is on screen. */
  @Synchronized
  fun activityStarted() {
    startedActivities++
    if (stop == null) stop = repeat(Runnable(::tick))
  }

  /** One of Wave's activities stopped: once none is started, Wave is in the background. */
  @Synchronized
  fun activityStopped() {
    if (startedActivities > 0) startedActivities--
    if (startedActivities == 0) halt()
  }

  @Synchronized
  private fun halt() {
    stop?.invoke()
    stop = null
    for (watch in watches) watch.reset()
  }

  @Synchronized
  private fun tick() {
    if (startedActivities == 0) return
    try {
      for (watch in watches) watch.tick()
    } catch (error: Exception) {
      WaveLog.w(FreezeWatch.TAG, "The freeze watch failed", error)
      halt()
    }
  }
}
