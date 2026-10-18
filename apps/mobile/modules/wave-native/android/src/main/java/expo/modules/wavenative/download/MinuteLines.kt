package expo.modules.wavenative.download

import java.util.concurrent.CopyOnWriteArrayList

/**
 * The lines the download service writes about once a minute while it runs: Wave's memory (#450),
 * and whatever else wants the same beat ([add]; #452's journal cost). One tick serves them all, so
 * each line comes at most once a minute whatever the size of the queue, and a burst of late ticks
 * (a process Android paused) writes once. The first lines come a minute after [start]: the start
 * line says as much already.
 *
 * [every] runs its tick every [tickMs] until the function it returns is called; [clock] is
 * elapsed realtime. Lines run on the tick's thread, one after another, in the order they were added,
 * and may take a moment (the memory line waits up to half a second for JS's heap).
 */
class MinuteLines(
  private val clock: () -> Long,
  private val every: (periodMs: Long, tick: () -> Unit) -> (() -> Unit),
  private val minuteMs: Long = 60_000L,
  private val tickMs: Long = 5_000L,
) {
  private val lines = CopyOnWriteArrayList<() -> Unit>()
  private var cancel: (() -> Unit)? = null
  /** When the lines were last written, or the service started. */
  @Volatile private var last = 0L

  /** Writes [line] with the others from now on, until the returned function is called. */
  fun add(line: () -> Unit): () -> Unit {
    lines.add(line)
    return { lines.remove(line) }
  }

  @Synchronized fun start() {
    if (cancel != null) return
    last = clock()
    cancel = every(tickMs) { tick() }
  }

  @Synchronized fun stop() {
    cancel?.invoke()
    cancel = null
  }

  private fun tick() {
    val now = clock()
    if (now - last < minuteMs) return
    last = now
    for (line in lines) runCatching(line)
  }
}
