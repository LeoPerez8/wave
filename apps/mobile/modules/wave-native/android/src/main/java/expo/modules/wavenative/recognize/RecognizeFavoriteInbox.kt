package expo.modules.wavenative.recognize

/**
 * Taps on the match notification's star button, kept in memory until JS takes them, and which
 * are still unanswered: RecognizeFavoriteService holds JS until none is. Each tap has its own
 * id, so a late answer can only close its own tap.
 */
class RecognizeFavoriteInbox {
  class Tap(val id: Int, val match: String, val on: Boolean)

  private val waiting = ArrayDeque<Tap>()
  /** Taps added and not answered yet, taken or not. */
  private val open = HashSet<Int>()
  private var next = 0
  @Volatile var onRequested: (() -> Unit)? = null

  fun add(match: String, on: Boolean) {
    synchronized(this) {
      val tap = Tap(++next, match, on)
      waiting.addLast(tap)
      open.add(tap.id)
    }
    onRequested?.invoke()
  }

  fun take(): Tap? = synchronized(this) { waiting.removeFirstOrNull() }

  /** Tap [id] is answered; returns whether none is left to answer. */
  fun done(id: Int): Boolean = synchronized(this) {
    open.remove(id)
    open.isEmpty()
  }

  /** Whether no tap is left to answer. */
  fun idle(): Boolean = synchronized(this) { open.isEmpty() }

  /** The service is gone, and JS with it, so no tap left will be answered. */
  fun clear() = synchronized(this) {
    waiting.clear()
    open.clear()
  }

  companion object {
    val shared = RecognizeFavoriteInbox()
  }
}
