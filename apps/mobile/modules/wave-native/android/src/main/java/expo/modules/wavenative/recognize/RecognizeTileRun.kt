package expo.modules.wavenative.recognize

import java.util.concurrent.CopyOnWriteArrayList

/**
 * What a tile tap does: listen, cancel the tile's session, leave the card's alone, or
 * open the card when a tile session couldn't give an answer.
 */
enum class RecognizeTileTap { LISTEN, CANCEL, IGNORE, OPEN_CARD }

/**
 * The tile's session as native knows it. JS runs the session and Core decides it; this
 * keeps what the tile and its service must know with JS still loading: whether it
 * listens, and the tap JS hasn't taken. Each tap has a number, so the late end of a
 * cancelled session can't end the one after it.
 */
class RecognizeTileRun {
  private var current = 0
  private var waiting = false
  private var last = 0
  private val listeners = CopyOnWriteArrayList<() -> Unit>()

  /** Whether a card session runs, from its start until its lookup ends. */
  @Volatile var cardRunning = false
  @Volatile var onRequested: (() -> Unit)? = null
  @Volatile var onCancelled: ((Int) -> Unit)? = null

  val listening: Boolean @Synchronized get() = current != 0

  fun tap(microphone: Boolean = true, notifications: Boolean = true): RecognizeTileTap = when {
    listening -> RecognizeTileTap.CANCEL
    cardRunning -> RecognizeTileTap.IGNORE
    !microphone || !notifications -> RecognizeTileTap.OPEN_CARD
    else -> RecognizeTileTap.LISTEN
  }

  /** A session starts listening; JS takes its tap, at once or once it's running. */
  fun request(): Int {
    val tap = synchronized(this) {
      waiting = true
      current = ++last
      current
    }
    changed()
    onRequested?.invoke()
    return tap
  }

  /** The tap waiting for JS, once; 0 when none is. */
  @Synchronized
  fun take(): Int {
    if (!waiting) return 0
    waiting = false
    return current
  }

  fun cancel() {
    val tap = synchronized(this) {
      waiting = false
      current.also { current = 0 }
    }
    if (tap == 0) return
    changed()
    onCancelled?.invoke(tap)
  }

  /** Tap [tap]'s session stopped listening. */
  fun ended(tap: Int) {
    val ending = synchronized(this) {
      (current == tap).also { if (it) current = 0 }
    }
    if (ending) changed()
  }

  /** Calls [listener] after each change; returns its removal. */
  fun listen(listener: () -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }

  private fun changed() = listeners.forEach { it() }

  companion object {
    val shared = RecognizeTileRun()
  }
}
