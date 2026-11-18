package expo.modules.wavenative.download

import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The threads YouTube attempts run on, by job id, so cancelling a job reaches its attempt wherever
 * it waits: resolving the stream's address ([interruptibly]), pausing between ranges, or reading.
 * [cancel] interrupts a thread only while it runs that job's attempt, and the interrupt ends with
 * the attempt, so the worker thread goes on to other work without it. The journal's step for the
 * job ends with the attempt, so its next attempt isn't held up behind it.
 */
class TransferThreads {
  private val threads = HashMap<String, Thread>()
  /** The attempts [cancel] interrupted, whose interrupt [run] clears as they end. */
  private val cancelled = HashSet<Thread>()

  /** Runs job [id]'s attempt on this thread, where [cancel] can reach it. */
  fun <T> run(id: String, attempt: () -> T): T {
    val thread = Thread.currentThread()
    synchronized(this) { threads[id] = thread }
    try {
      return attempt()
    } finally {
      synchronized(this) {
        threads.remove(id, thread)
        if (cancelled.remove(thread)) Thread.interrupted()
      }
    }
  }

  /** Interrupts job [id]'s attempt, if one is running. Never waits for it. */
  fun cancel(id: String) = synchronized(this) {
    val thread = threads[id] ?: return@synchronized
    cancelled += thread
    thread.interrupt()
  }
}

/** Where [interruptibly] runs its work, apart from the thread waiting for it. */
private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)

/**
 * Runs [block] and waits for its result on this thread, as `runBlocking` would, except that an
 * interrupt ends the wait at once with [InterruptedException], cancelling [block] without waiting
 * for it to stop (a resolve stuck in a call that ignores cancellation). [block]'s own failure is
 * thrown as it is.
 */
fun <T> interruptibly(block: suspend () -> T): T {
  val result = CompletableFuture<T>()
  val work = background.launch {
    try { result.complete(block()) } catch (e: Throwable) { result.completeExceptionally(e) }
  }
  try {
    return result.get()
  } catch (e: InterruptedException) {
    work.cancel()
    throw e
  } catch (e: ExecutionException) {
    throw e.cause ?: e
  }
}
