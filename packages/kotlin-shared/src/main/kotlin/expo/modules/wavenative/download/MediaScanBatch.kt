package expo.modules.wavenative.download

/**
 * The paths waiting for Android's media scanner (#455), handed to it together ([scan]) at most
 * every [everyMs], so a big download run doesn't ask about each file on its own.
 *
 * A downloaded file is [hold]: its lyrics and genre are still to be written, so it waits for
 * [release] (the fill-in is done) and is scanned once, with its tags. A quality replacement's
 * old file, deleted by its import, goes along with it ([add]'s `with`), in the same batch. A file
 * whose fill-in never comes (JS went away) is scanned all the same [holdMs] after its hold.
 *
 * [later] runs its function after the delay it's given, on another thread; [clock] is elapsed
 * realtime.
 */
class MediaScanBatch(
  private val clock: () -> Long,
  private val later: (delayMs: Long, run: () -> Unit) -> Unit,
  private val scan: (List<String>) -> Unit,
  private val everyMs: Long = EVERY_MS,
  private val holdMs: Long = HOLD_MS,
) {
  /** The paths the next batch scans, in the order they came. */
  private val ready = LinkedHashSet<String>()
  /** The downloaded files whose tags are still to be written. */
  private val held = LinkedHashMap<String, Held>()
  /** When the last batch went to the scanner. */
  private var scannedAt = Long.MIN_VALUE / 2
  private var scheduled = false
  /** The files and batches that went to the scanner since [takeLine]. */
  private var files = 0
  private var batches = 0

  /** [path], a file just downloaded, waits for its tags ([release]). */
  @Synchronized fun hold(path: String) {
    val since = clock()
    held.getOrPut(path) { Held() }.since = since
    later(holdMs) { synchronized(this) { if (held[path]?.since == since) release(path) } }
  }

  /**
   * [paths] go with the next batch, or along with [with] while that file waits for its tags; a
   * held one waits for its own [release].
   */
  @Synchronized fun add(paths: List<String>, with: String? = null) {
    val along = with?.let { held[it]?.along }
    for (path in paths) if (path !in held) { if (along != null) along += path else ready += path }
    schedule()
  }

  /** [path]'s tags are written (or there was nothing to write): it, and what goes along, go with the next batch. */
  @Synchronized fun release(path: String) {
    val along = held.remove(path)?.along ?: return
    ready += path
    ready += along
    schedule()
  }

  private fun schedule() {
    if (scheduled || ready.isEmpty()) return
    scheduled = true
    later(maxOf(0L, scannedAt + everyMs - clock())) { flush() }
  }

  /** Hands what's ready to the scanner now. */
  fun flush() {
    val paths = synchronized(this) {
      scheduled = false
      if (ready.isEmpty()) return
      scannedAt = clock()
      files += ready.size; batches++
      ready.toList().also { ready.clear() }
    }
    scan(paths)
  }

  /** What went to the scanner since the last call: the download service's once-a-minute line. */
  @Synchronized fun takeLine(): String {
    val line = if (batches == 0) "Media scans: none"
      else "Media scans: $files file${if (files == 1) "" else "s"} in $batches batch${if (batches == 1) "" else "es"}"
    files = 0; batches = 0
    return line
  }

  /** A held file: since when, and the files that go along with it. */
  private class Held(var since: Long = 0L, val along: MutableList<String> = mutableListOf())

  companion object {
    /** How often, at most, a batch goes to the media scanner. */
    const val EVERY_MS = 5_000L
    /** How long a downloaded file waits for its tags before it's scanned all the same. */
    const val HOLD_MS = 60_000L
  }
}
