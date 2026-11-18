package expo.modules.wavenative.log

import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicInteger

/**
 * Native code's entries on their way to the app log: [write] queues an entry
 * and returns at once, and one thread of the writer's own formats and
 * [append]s them in order. Whoever logs (the main thread, playback) never
 * waits for the file, which JS may be reading or trimming.
 *
 * [flush] writes what's queued on the calling thread, for an entry that must
 * be in the file before the process dies. Past [capacity] queued entries, new
 * ones are dropped, and once the queue is written [dropped] gives the line
 * that says how many.
 */
class AppLogWriter(
  private val append: (String) -> Unit,
  capacity: Int = CAPACITY,
  private val dropped: (Int) -> String,
) : Closeable {
  private val queue = ArrayBlockingQueue<() -> String>(capacity)
  private val droppedCount = AtomicInteger()
  private val wake = Semaphore(0)

  /** Held while writing, so the writer thread and [flush] take entries in turn, in order. */
  private val writing = Any()

  @Volatile private var open = true

  init {
    Thread(::run, "WaveLogWriter").apply { isDaemon = true }.start()
  }

  /** Queues the entry [entry] formats, formatted and written on the writer's thread. */
  fun write(entry: () -> String) {
    if (!queue.offer(entry)) droppedCount.incrementAndGet()
    wake.release()
  }

  /** Writes everything queued so far before returning, on the calling thread. */
  fun flush() = synchronized(writing) {
    while (true) {
      val entry = queue.poll() ?: break
      runCatching { append(entry()) }
    }
    val lost = droppedCount.getAndSet(0)
    if (lost > 0) runCatching { append(dropped(lost)) }
  }

  /** Writes what's queued and stops the writer's thread. */
  override fun close() {
    open = false
    wake.release()
    flush()
  }

  private fun run() {
    while (open) {
      try {
        wake.acquire()
        wake.drainPermits()
        flush()
      } catch (_: InterruptedException) {
        return
      }
    }
  }

  companion object {
    const val CAPACITY = 1_000
  }
}
