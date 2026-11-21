package expo.modules.wavenative.recognize

/**
 * Taps on the match notification's star button, kept in memory until JS takes them, and how
 * many are still unanswered: RecognizeFavoriteService holds JS until none is.
 */
class RecognizeFavoriteInbox {
  class Tap(val match: String, val on: Boolean)

  private val waiting = ArrayDeque<Tap>()
  /** Taps added and not answered yet, taken or not. */
  private var open = 0
  @Volatile var onRequested: (() -> Unit)? = null

  fun add(match: String, on: Boolean) {
    synchronized(this) {
      waiting.addLast(Tap(match, on))
      open++
    }
    onRequested?.invoke()
  }

  fun take(): Tap? = synchronized(this) { waiting.removeFirstOrNull() }

  /** A tap is answered; returns whether none is left to answer. */
  fun done(): Boolean = synchronized(this) {
    if (open > 0) open--
    open == 0
  }

  /** The service is gone, and JS with it, so no tap left will be answered. */
  fun clear() = synchronized(this) {
    waiting.clear()
    open = 0
  }

  companion object {
    val shared = RecognizeFavoriteInbox()
  }
}
