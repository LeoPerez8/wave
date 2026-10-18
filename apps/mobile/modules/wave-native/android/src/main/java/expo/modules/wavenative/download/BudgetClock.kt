package expo.modules.wavenative.download

/**
 * The clock download budgets are charged on: it moves with [clock] while the download work runs
 * and stands still while it's stopped, or while Wave isn't running at all. The journal keeps what
 * it showed when it was last written, so a job opened again in a new process goes on with the time
 * it had left, not with whatever the wall clock says. A new (or older) journal starts it at
 * [clock], so deadlines kept as wall-clock times read the same on it.
 */
internal class BudgetClock(private val clock: () -> Long, restored: Long?) {
  private var shown = restored ?: clock()
  /** When ([clock]) [shown] was taken; null while the clock stands still. */
  private var since: Long? = clock()

  @Synchronized fun now(): Long = since?.let { shown + maxOf(0L, clock() - it) } ?: shown

  /** The download work stopped: nothing is charged until it [resume]s. */
  @Synchronized fun pause() { shown = now(); since = null }

  @Synchronized fun resume() { if (since == null) since = clock() }
}
