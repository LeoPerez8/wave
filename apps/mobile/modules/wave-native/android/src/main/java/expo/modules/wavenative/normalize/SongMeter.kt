package expo.modules.wavenative.normalize

import java.util.concurrent.ExecutorService
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Normalize Volume's one meter thread ([thread], at background priority), shared by the queue's
 * measurements (the songs about to play, from JS, on battery too) and the charging job's (the
 * rest of the Library): one file is decoded at a time, and the queue's go first. A queue
 * measurement asked for while a Library file is being measured stops that file, which the job
 * measures again after it, so the song about to play never waits for the Library.
 */
class SongMeter(
  private val measure: (path: String, isCancelled: () -> Boolean) -> FileLoudness.Outcome,
  private val thread: ExecutorService,
) {
  // Queue measurements asked for and not answered yet.
  private val queueWaiting = AtomicInteger()

  // The flag of the queue measurement asked for last, for [cancelQueue].
  private val queueCancel = AtomicReference<AtomicBoolean?>(null)

  // The flag that stops the Library file being measured, for a queue measurement to take over.
  private val libraryYield = AtomicReference<AtomicBoolean?>(null)

  /** Measures [path] for the queue, before any Library file; [answer] hears how it went, on the meter thread. */
  fun forQueue(path: String, answer: (FileLoudness.Outcome) -> Unit) {
    val cancelled = AtomicBoolean(false)
    // Set before it starts, so a cancel while it waits for the thread stops it too.
    queueCancel.set(cancelled)
    queueWaiting.incrementAndGet()
    libraryYield.get()?.set(true)
    thread.execute {
      val outcome = try {
        measure(path) { cancelled.get() }
      } catch (_: Throwable) {
        FileLoudness.Outcome.Unreadable
      } finally {
        queueCancel.compareAndSet(cancelled, null)
        queueWaiting.decrementAndGet()
      }
      answer(outcome)
    }
  }

  /** Stops the queue's measurement (Normalize Volume turned off), which answers `Cancelled`. */
  fun cancelQueue() {
    queueCancel.get()?.set(true)
  }

  /**
   * Measures Library file [path] for the charging job, on the meter thread, and waits for it:
   * `Cancelled` once [stop] says so, or null when the queue's measurements came first and it's to
   * be measured again.
   */
  fun forLibrary(path: String, stop: () -> Boolean): FileLoudness.Outcome? =
    thread.submit<FileLoudness.Outcome?> {
      val yielded = AtomicBoolean(false)
      libraryYield.set(yielded)
      try {
        // Set first and checked after, so a queue measurement asked for meanwhile is never missed.
        if (queueWaiting.get() > 0) return@submit null
        val outcome = try {
          measure(path) { stop() || yielded.get() }
        } catch (_: Throwable) {
          FileLoudness.Outcome.Unreadable
        }
        if (outcome == FileLoudness.Outcome.Cancelled && !stop()) null else outcome
      } finally {
        libraryYield.compareAndSet(yielded, null)
      }
    }.get()
}
