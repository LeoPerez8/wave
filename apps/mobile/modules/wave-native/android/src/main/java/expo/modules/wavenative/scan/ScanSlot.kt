package expo.modules.wavenative.scan

import java.util.concurrent.atomic.AtomicBoolean

/**
 * The one scan that may run. JS numbers its scans in order and starts them with an async call,
 * so starts can reach here out of order: a scan claims the slot only if it is newer than the
 * one holding it, and the scan it replaces is cancelled.
 */
class ScanSlot {
  private var current: Pair<Int, AtomicBoolean>? = null
  private var newest = Int.MIN_VALUE

  /** Scan [id]'s cancellation flag once it holds the slot; null when a newer scan already started. */
  @Synchronized
  fun claim(id: Int): AtomicBoolean? {
    if (id <= newest) return null
    newest = id
    current?.second?.set(true)
    return AtomicBoolean(false).also { current = id to it }
  }

  /** Cancels scan [id] if it is the one running. */
  @Synchronized
  fun cancel(id: Int) {
    current?.takeIf { it.first == id }?.second?.set(true)
  }

  /** Scan [id] ended: the slot is free (a newer scan may hold it already). */
  @Synchronized
  fun finished(id: Int) {
    if (current?.first == id) current = null
  }

  @Synchronized
  fun cancelAll() {
    current?.second?.set(true)
  }
}
