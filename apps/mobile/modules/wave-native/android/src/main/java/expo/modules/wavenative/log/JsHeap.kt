package expo.modules.wavenative.log

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The Hermes heap, which only JS can read (`HermesInternal.getInstrumentedStats`), for native lines
 * that report Wave's memory (#450). Each JS runtime [listen]s with a way to ask it (an event of
 * `WaveAppLog`); [read] asks them all and waits up to [timeoutMs] for the first to answer
 * ([reported]). No runtime, or none answering in time (a frozen JS thread), reads as null: the
 * line is written without it. Never call [read] on the main thread or the JS thread.
 */
class JsHeap(private val timeoutMs: Long = 500L) {
  private val askers = CopyOnWriteArrayList<() -> Unit>()
  private var pending: Ask? = null

  private class Ask {
    val answered = CountDownLatch(1)
    @Volatile var bytes: Long? = null
  }

  /** [ask] makes a JS runtime report its heap, until the returned function is called. */
  fun listen(ask: () -> Unit): () -> Unit {
    askers.add(ask)
    return { askers.remove(ask) }
  }

  /** JS's answer; one that comes after its ask gave up is dropped. */
  fun reported(bytes: Long) {
    val ask = synchronized(this) { pending } ?: return
    ask.bytes = bytes
    ask.answered.countDown()
  }

  /** The Hermes heap in bytes, or null when no JS runtime answered in time. */
  fun read(): Long? {
    if (askers.isEmpty()) return null
    val ask = Ask()
    synchronized(this) { pending = ask }
    try {
      for (asker in askers) runCatching(asker)
      return if (ask.answered.await(timeoutMs, TimeUnit.MILLISECONDS)) ask.bytes else null
    } finally {
      synchronized(this) { if (pending === ask) pending = null }
    }
  }

  companion object {
    /** The process's: `WaveAppLog` modules listen, native lines read. */
    val app = JsHeap()
  }
}
