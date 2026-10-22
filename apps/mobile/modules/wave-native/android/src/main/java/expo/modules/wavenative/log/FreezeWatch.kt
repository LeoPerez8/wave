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
 * [thresholdMs] after it was sent is a freeze. A recovered ping of 500 ms up to
 * the freeze boundary is a hitch. A one-second tick at least 500 ms overdue
 * means the whole process may have paused; invalidate its outstanding ping.
 * Recovery checks that clock too, even when it runs before the next tick.
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
  /** Optional off-thread snapshot at the hitch boundary, before main answers its ping. */
  private val later: ((Runnable, Long) -> (() -> Unit))? = null,
  private val hitch: (Long) -> Unit = {},
) {
  private var lastTick: Long? = null
  private var ping = 0L
  private var sentAt: Long? = null
  /** The screen when the current freeze was noticed; set while one is. */
  private var frozenOn: String? = null
  private var frozen = false
  private var sentOn: String? = null
  private var busyStack: String? = null
  private var cancelSnapshot: (() -> Unit)? = null

  /** Invalidate queued answers on foreground changes, unwatch and a paused process. */
  @Synchronized
  fun reset() {
    ping++
    sentAt = null
    frozen = false
    lastTick = null
    cancelSnapshot?.invoke()
    cancelSnapshot = null
    busyStack = null
  }

  @Synchronized
  fun tick() {
    val now = clock()
    val last = lastTick
    lastTick = now
    if (last != null && now - last >= PAUSED_TICK_MS) {
      reset()
      lastTick = now
    }
    val sent = sentAt
    if (sent == null) {
      val id = ++ping
      sentAt = now
      sentOn = screen()
      busyStack = null
      cancelSnapshot = later?.invoke(Runnable { snapshot(id) }, HITCH_MS)
      if (!post(Runnable { answered(id) })) reset()
      return
    }
    if (frozen || now - sent < thresholdMs) return
    frozen = true
    frozenOn = screen()
    val stuck = "The $thread thread has not responded for ${seconds(now - sent)}${on(frozenOn)}"
    WaveLog.w(TAG, stack()?.let { "$stuck\n$it" } ?: stuck)
  }

  @Synchronized
  private fun snapshot(id: Long) {
    if (id == ping && sentAt != null) busyStack = stack()?.lines()?.take(8)?.joinToString("\n")
  }

  @Synchronized
  private fun answered(id: Long) {
    val sent = sentAt
    if (id != ping || sent == null) return
    val now = clock()
    // Check here too: the watched thread may resume before the watchdog does.
    if (lastTick?.let { now - it >= PAUSED_TICK_MS } == true) {
      reset()
      return
    }
    sentAt = null
    cancelSnapshot?.invoke()
    cancelSnapshot = null
    if (frozen) {
      frozen = false
      WaveLog.w(TAG, "The $thread thread responded again after ${seconds(now - sent)}${on(frozenOn)}")
      return
    }
    val duration = now - sent
    val line = hitchLine(thread, duration, sentOn, busyStack) ?: return
    WaveLog.i("WaveTiming", line)
    hitch(duration)
  }

  private fun seconds(ms: Long) = String.format(Locale.ROOT, "%.1f s", ms / 1000.0)

  private fun on(screen: String?) = if (screen.isNullOrEmpty()) "" else " (screen: $screen)"

  companion object {
    const val TAG = "freeze"
    const val HITCH_MS = 500L
    // The one-second ticker itself is at least 500 ms late: don't blame a watched thread.
    const val PAUSED_TICK_MS = 1_500L

    /** Core's hitchLine: seconds always, and a freeze never gets a second hitch line. */
    fun hitchLine(thread: String, ms: Long, route: String?, stack: String? = null): String? {
      if (ms < HITCH_MS || ms >= 3_000L) return null
      val busy = "$thread thread busy ${String.format(Locale.ROOT, "%.1f s", ms / 1000.0)}" +
        (if (route.isNullOrEmpty()) "" else " on $route")
      return if (stack.isNullOrEmpty()) busy else "$busy\n$stack"
    }
  }
}
