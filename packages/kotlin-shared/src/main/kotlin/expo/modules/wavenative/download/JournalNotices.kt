package expo.modules.wavenative.download

/**
 * Tells listeners (JS's rows) that the download journal changed: only when its [revision] moved
 * since they were last told, and at most once per [intervalMs]. A change held back by the
 * interval isn't lost: [later] tells it once the interval is over.
 */
class JournalNotices(
  private val revision: () -> Long,
  private val clock: () -> Long,
  private val intervalMs: Long,
  private val later: (delayMs: Long, run: () -> Unit) -> Unit,
  private val notify: () -> Unit,
) {
  private var toldRevision: Long? = null
  private var toldAt = 0L
  private var waiting = false

  fun changed() {
    synchronized(this) {
      val current = revision()
      if (current == toldRevision) return
      val wait = if (toldRevision == null) 0L else toldAt + intervalMs - clock()
      if (wait > 0) {
        if (!waiting) { waiting = true; later(wait) { synchronized(this) { waiting = false }; changed() } }
        return
      }
      toldRevision = current; toldAt = clock()
    }
    notify()
  }
}
