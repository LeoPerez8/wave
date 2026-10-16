package expo.modules.wavenative.log

import java.util.Locale

/**
 * Notices when [thread] (the main thread, the JS thread) stops responding for
 * [thresholdMs] or more, and writes it to the app log as a freeze: which thread,
 * what was on screen if known ([screen]) and, for a thread whose stack says
 * something, what it was doing ([stack]); then, once it answers again, for how
 * long it was stuck.
 *
 * A watchdog calls [tick] about once a second, off the watched thread. Each tick
 * with no ping waiting [post]s one to the watched thread; a ping still waiting
 * [thresholdMs] after it was sent is a freeze. A tick that comes [thresholdMs]
 * late means the whole process was paused (Android froze Wave in the
 * background), so it starts over instead.
 */
class FreezeWatch(
  private val thread: String,
  private val thresholdMs: Long,
  /** A monotonic clock in ms that stops while the phone sleeps (`SystemClock.uptimeMillis`). */
  private val clock: () -> Long,
  /** Runs the runnable on the watched thread; false when it couldn't be posted. */
  private val post: (Runnable) -> Boolean,
  private val screen: () -> String? = { null },
  private val stack: () -> String? = { null },
) {
  private var lastTick: Long? = null
  private var ping = 0L
  private var sentAt: Long? = null
  /** The screen when the current freeze was noticed; set while one is. */
  private var frozenOn: String? = null
  private var frozen = false

  @Synchronized
  fun tick() {
    val now = clock()
    val last = lastTick
    lastTick = now
    if (last != null && now - last >= thresholdMs) {
      sentAt = null
      frozen = false
    }
    val sent = sentAt
    if (sent == null) {
      val id = ++ping
      sentAt = now
      if (!post(Runnable { answered(id) })) sentAt = null
      return
    }
    if (frozen || now - sent < thresholdMs) return
    frozen = true
    frozenOn = screen()
    val stuck = "The $thread thread has not responded for ${seconds(now - sent)}${on(frozenOn)}"
    WaveLog.w(TAG, stack()?.let { "$stuck\n$it" } ?: stuck)
  }

  @Synchronized
  private fun answered(id: Long) {
    val sent = sentAt
    if (id != ping || sent == null) return
    sentAt = null
    if (!frozen) return
    frozen = false
    WaveLog.w(TAG, "The $thread thread responded again after ${seconds(clock() - sent)}${on(frozenOn)}")
  }

  private fun seconds(ms: Long) = String.format(Locale.ROOT, "%.1f s", ms / 1000.0)

  private fun on(screen: String?) = if (screen.isNullOrEmpty()) "" else " (screen: $screen)"

  companion object {
    const val TAG = "freeze"
  }
}
