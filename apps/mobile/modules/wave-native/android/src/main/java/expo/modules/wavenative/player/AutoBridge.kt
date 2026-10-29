package expo.modules.wavenative.player

import expo.modules.wavenative.locale.NativeText
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.google.common.util.concurrent.SettableFuture

/** JS's answer to an Auto request: its JSON, or why it couldn't answer. */
sealed interface AutoReply {
  data class Ok(val json: String) : AutoReply

  data class Failed(val message: String) : AutoReply
}

/** Hands a request to JS (the `onAutoRequest` event). */
fun interface AutoEmitter {
  fun emit(id: Int, type: String, payload: String)
}

/** What the bridge needs from Android: a timer. */
interface AutoBridgeHost {
  /** Runs [action] after [delayMs], on any thread; the returned function cancels it. */
  fun schedule(delayMs: Long, action: () -> Unit): () -> Unit
}

/**
 * Asks JS on behalf of Android Auto. The media library service calls
 * [request] from a Media3 callback and returns the future to Media3; JS
 * answers through [respond] or [fail]. A request JS doesn't answer within its
 * timeout fails with [STILL_LOADING], so Auto never waits forever.
 *
 * Requests made before JS has attached (a cold start: the runtime is still
 * loading) wait for [attach], within the same timeout. Such a request may
 * pass `onLateAnswer`: if it times out, it is still sent to JS, and once JS
 * answers it `onLateAnswer` runs, so Auto can be told to ask again instead of
 * showing the loading message until the user retries.
 */
class AutoBridge(private val host: AutoBridgeHost) {
  private class Pending(
    val type: String,
    val payload: String,
    val future: SettableFuture<AutoReply>,
    /** Only for a request made before JS attached: it then outlives its timeout. */
    val onLateAnswer: (() -> Unit)?,
  ) {
    var cancelTimeout: () -> Unit = {}
    var sent = false
    var timedOut = false
  }

  private val lock = Any()
  private var nextId = 1
  private val pending = LinkedHashMap<Int, Pending>()
  private var emitter: AutoEmitter? = null

  /** True once JS listens for requests. */
  val attached: Boolean
    get() = synchronized(lock) { emitter != null }

  fun request(
    type: String,
    payload: String,
    timeoutMs: Long,
    onLateAnswer: (() -> Unit)? = null,
  ): ListenableFuture<AutoReply> {
    val future = SettableFuture.create<AutoReply>()
    val id: Int
    val target: AutoEmitter?
    val entry: Pending
    synchronized(lock) {
      entry = Pending(type, payload, future, onLateAnswer.takeIf { emitter == null })
      id = nextId++
      pending[id] = entry
      target = emitter
      entry.sent = target != null
    }
    entry.cancelTimeout = host.schedule(timeoutMs) { timeOut(id) }
    target?.emit(id, type, payload)
    return future
  }

  /** Completes request [id] with JS's [json]. Unknown and late ids are ignored. */
  fun respond(id: Int, json: String): Boolean = complete(id, AutoReply.Ok(json))

  /** Completes request [id] with an error Auto shows as [message]. */
  fun fail(id: Int, message: String): Boolean = complete(id, AutoReply.Failed(message))

  /** Request [id] fails with [STILL_LOADING]; one with an `onLateAnswer` stays pending for JS. */
  private fun timeOut(id: Int) {
    val entry = synchronized(lock) {
      val entry = pending[id] ?: return
      if (entry.onLateAnswer != null) entry.timedOut = true else pending.remove(id)
      entry
    }
    entry.future.set(AutoReply.Failed(STILL_LOADING))
  }

  private fun complete(id: Int, reply: AutoReply): Boolean {
    val entry = synchronized(lock) { pending.remove(id) } ?: return false
    if (entry.timedOut) {
      // After the timeout's failure is out, so Auto is told to ask again only once it has seen it.
      if (reply is AutoReply.Ok) {
        entry.future.addListener({ entry.onLateAnswer?.invoke() }, MoreExecutors.directExecutor())
      }
      return false
    }
    entry.cancelTimeout()
    entry.future.set(reply)
    return true
  }

  /** JS listens from now on: sends it every request still waiting. */
  fun attach(emitter: AutoEmitter) {
    val waiting = synchronized(lock) {
      this.emitter = emitter
      pending.filterValues { !it.sent }.onEach { it.value.sent = true }
    }
    waiting.forEach { (id, entry) -> emitter.emit(id, entry.type, entry.payload) }
  }

  /**
   * JS stopped listening (its runtime went away). Requests it was sent will
   * never be answered, so they fail now; new ones wait for the next [attach].
   */
  fun detach() {
    val lost = synchronized(lock) {
      emitter = null
      pending.filterValues { it.sent }.keys.toList()
    }
    lost.forEach { complete(it, AutoReply.Failed(STILL_LOADING)) }
  }

  companion object {
    val STILL_LOADING get() = NativeText.get("stillLoading")
  }
}
