package expo.modules.wavenative.download

/**
 * The clock download budgets are charged on: it moves with [clock] while Wave runs and stands
 * still while it isn't running at all. The journal keeps what it showed when it was last written,
 * so a job opened again in a new process goes on with the time it had left, not with whatever the
 * wall clock says. A new (or older) journal starts it at [clock], so deadlines kept as wall-clock
 * times read the same on it.
 */
internal class BudgetClock(private val clock: () -> Long, restored: Long?) {
  private val shown = restored ?: clock()
  /** When ([clock]) [shown] was taken. */
  private val since = clock()

  fun now(): Long = shown + maxOf(0L, clock() - since)
}
