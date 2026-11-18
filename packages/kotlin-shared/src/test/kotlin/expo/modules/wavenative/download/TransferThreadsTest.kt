package expo.modules.wavenative.download

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.awaitCancellation
import org.junit.Assert.*
import org.junit.Test

/** Cancelling a job reaches its YouTube attempt wherever it's stuck. */
class TransferThreadsTest {
  @Test fun cancellingAJobInterruptsItsAttemptWhereverItWaits() {
    val threads = TransferThreads()
    val waiting = CountDownLatch(1)
    var outcome: Throwable? = null
    var interruptedAfter: Boolean? = null
    val attempt = Thread {
      outcome = runCatching { threads.run("song") { waiting.countDown(); CountDownLatch(1).await() } }.exceptionOrNull()
      interruptedAfter = Thread.currentThread().isInterrupted
    }
    attempt.start()
    assertTrue(waiting.await(5, TimeUnit.SECONDS))
    threads.cancel("other")
    threads.cancel("song")
    attempt.join(5_000)
    assertFalse(attempt.isAlive)
    assertTrue(outcome is InterruptedException)
    // The thread goes on to other work without the cancel.
    assertEquals(false, interruptedAfter)
  }

  @Test fun aCancelAfterTheAttemptEndedReachesNothing() {
    val threads = TransferThreads()
    assertEquals("done", threads.run("song") { "done" })
    threads.cancel("song")
    assertFalse(Thread.currentThread().isInterrupted)
  }

  @Test fun anAttemptStuckResolvingStopsWaitingAtOnceWhenCancelled() {
    val threads = TransferThreads()
    val resolving = CountDownLatch(1)
    var outcome: Throwable? = null
    val attempt = Thread {
      outcome = runCatching {
        threads.run("song") {
          interruptibly<String> {
            resolving.countDown()
            // A resolve that doesn't stop when asked: the attempt doesn't wait for it.
            try { awaitCancellation() } finally { Thread.sleep(60_000) }
          }
        }
      }.exceptionOrNull()
    }
    attempt.start()
    assertTrue(resolving.await(5, TimeUnit.SECONDS))
    threads.cancel("song")
    attempt.join(5_000)
    assertFalse(attempt.isAlive)
    assertTrue(outcome is InterruptedException)
  }

  @Test fun anInterruptibleWaitGivesTheResultOrTheFailure() {
    assertEquals(42, interruptibly { 42 })
    val failure = runCatching { interruptibly<Int> { throw IllegalStateException("No stream") } }.exceptionOrNull()
    assertTrue(failure is IllegalStateException)
    assertEquals("No stream", failure!!.message)
  }
}
