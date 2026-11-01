package expo.modules.wavenative.recognize

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The module's one live session, as JS addresses it. */
class RecognizeSessionsTest {
  private val events = CopyOnWriteArrayList<String>()
  private val failed = CountDownLatch(1)
  private val sessions = RecognizeSessions(
    recognize = { RecognizeOutcome.NoMatch },
    onHeard = { id, ms, _ -> events += "heard $id $ms" },
    onCaptureFailed = { id -> events += "failed $id"; failed.countDown() },
  )

  /** Silence until stopped; with [failsAtOnce], a microphone that errors on its first read. */
  private class FakeAudio(private val failsAtOnce: Boolean = false) : RecognizeAudio {
    private val stopped = CountDownLatch(1)
    val released = CountDownLatch(1)

    override fun read(buffer: ShortArray): Int {
      if (failsAtOnce) return -1
      return if (stopped.await(10, TimeUnit.MILLISECONDS)) -1 else buffer.size
    }

    override fun stop() = stopped.countDown()

    override fun release() = released.countDown()
  }

  @Test
  fun `JS has the session's id, its own request number, before the capture can report`() {
    sessions.start(7, FakeAudio(failsAtOnce = true)) { id -> events += "started $id" }

    assertTrue(failed.await(5, TimeUnit.SECONDS))
    assertEquals(listOf("started 7", "failed 7"), events.toList())
  }

  @Test
  fun `stopping every session, as going to the background does, isn't a capture failure`() {
    val audio = FakeAudio()
    sessions.start(3, audio) {}
    sessions.stopAll()

    assertTrue("the capture lets the audio go", audio.released.await(5, TimeUnit.SECONDS))
    assertFalse(failed.await(200, TimeUnit.MILLISECONDS))
    assertTrue(events.none { it.startsWith("failed") })
  }

  @Test
  fun `a new session stops the one before without reporting it failed`() {
    val first = FakeAudio()
    sessions.start(1, first) {}
    sessions.start(2, FakeAudio()) {}

    assertTrue(first.released.await(5, TimeUnit.SECONDS))
    assertNull(sessions.get(1))
    assertFalse(failed.await(200, TimeUnit.MILLISECONDS))
    sessions.stopAll()
  }

  @Test
  fun `stop leaves another session's capture alone`() {
    val audio = FakeAudio()
    sessions.start(4, audio) {}
    sessions.stop(5)

    assertTrue(sessions.get(4) != null)
    sessions.stop(4)
    assertNull(sessions.get(4))
    assertTrue(audio.released.await(5, TimeUnit.SECONDS))
  }

  @Test
  fun `asking a session that has ended says so, apart from other errors`() {
    sessions.start(8, FakeAudio()) {}
    sessions.stopAll()

    val error = runCatching { sessions.ask(8, last = false, windowMs = 12_000) }.exceptionOrNull()
    assertTrue("$error", error is RecognizeSessionEnded)
  }

  @Test
  fun `an ask whose request throws passes the error on as itself`() {
    val throwing = RecognizeSessions(
      recognize = { throw IllegalStateException("Disk full") },
      onHeard = { _, _, _ -> },
      onCaptureFailed = {},
    )
    throwing.start(9, FakeAudio()) {}

    val error = runCatching { throwing.ask(9, last = false, windowMs = 12_000) }.exceptionOrNull()
    assertTrue("$error", error is IllegalStateException)
    throwing.stopAll()
  }
}
