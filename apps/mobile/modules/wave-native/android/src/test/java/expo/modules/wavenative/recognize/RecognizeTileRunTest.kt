package expo.modules.wavenative.recognize

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The tile's session, as the tile, its service and JS share it. */
class RecognizeTileRunTest {
  private val run = RecognizeTileRun()

  @Test fun `an idle tile's tap listens`() {
    assertEquals(RecognizeTileTap.LISTEN, run.tap())
  }

  @Test fun `a tap while the tile listens cancels`() {
    run.request()
    assertEquals(RecognizeTileTap.CANCEL, run.tap())
  }

  @Test fun `a tap while the card's session runs leaves it alone`() {
    run.cardRunning = true
    assertEquals(RecognizeTileTap.IGNORE, run.tap())
    run.cardRunning = false
    assertEquals(RecognizeTileTap.LISTEN, run.tap())
  }

  @Test fun `without the microphone a tap opens the card`() {
    assertEquals(RecognizeTileTap.OPEN_CARD, run.tap(microphone = false, notifications = true))
  }

  @Test fun `with no way to tell the result a tap opens the card`() {
    assertEquals(RecognizeTileTap.OPEN_CARD, run.tap(microphone = true, notifications = false))
  }

  @Test fun `with both a tap never opens the card`() {
    assertEquals(RecognizeTileTap.LISTEN, run.tap(microphone = true, notifications = true))
  }

  @Test fun `a tap that opens the card starts no tile session`() {
    run.tap(microphone = true, notifications = false)
    assertFalse(run.listening)
    assertEquals(0, run.take())
  }

  @Test fun `a permission lost mid-session doesn't stop a tap cancelling`() {
    run.request()
    assertEquals(RecognizeTileTap.CANCEL, run.tap(microphone = false, notifications = false))
  }

  @Test fun `a permission lost during a card session still leaves it alone`() {
    run.cardRunning = true
    assertEquals(RecognizeTileTap.IGNORE, run.tap(microphone = false, notifications = false))
  }

  @Test fun `every permission combination preserves the session that owns the tap`() {
    for (microphone in listOf(false, true)) {
      for (notifications in listOf(false, true)) {
        val idle = RecognizeTileRun()
        val expected = if (microphone && notifications) RecognizeTileTap.LISTEN else RecognizeTileTap.OPEN_CARD
        assertEquals(expected, idle.tap(microphone, notifications))
        assertFalse(idle.listening)
        assertEquals(0, idle.take())

        idle.cardRunning = true
        assertEquals(RecognizeTileTap.IGNORE, idle.tap(microphone, notifications))
        val session = idle.request()
        assertEquals(RecognizeTileTap.CANCEL, idle.tap(microphone, notifications))
        // Deciding what the tap does must not consume or end the session itself.
        assertEquals(session, idle.take())
        assertTrue(idle.listening)
      }
    }
  }

  @Test fun `rechecking a decision uses current permissions and card ownership`() {
    assertEquals(RecognizeTileTap.LISTEN, run.tap(true, true))
    assertEquals(RecognizeTileTap.OPEN_CARD, run.tap(false, true))
    assertEquals(RecognizeTileTap.OPEN_CARD, run.tap(true, false))
    assertEquals(RecognizeTileTap.LISTEN, run.tap(true, true))
    run.cardRunning = true
    assertEquals(RecognizeTileTap.IGNORE, run.tap(false, false))
    run.cardRunning = false
    assertEquals(RecognizeTileTap.OPEN_CARD, run.tap(false, false))
    assertFalse(run.listening)
    assertEquals(0, run.take())
  }

  @Test fun `JS takes a tap once, even if it came before JS was running`() {
    val tap = run.request()
    assertEquals(tap, run.take())
    assertEquals(0, run.take())
    assertTrue(run.listening)
  }

  @Test fun `a request tells JS it is waiting`() {
    var told = 0
    run.onRequested = { told++ }
    run.request()
    assertEquals(1, told)
  }

  @Test fun `a cancel before JS took the tap leaves nothing for it to take`() {
    run.request()
    run.cancel()
    assertEquals(0, run.take())
    assertFalse(run.listening)
  }

  @Test fun `a cancel names the tap it ended, once`() {
    val cancelled = mutableListOf<Int>()
    run.onCancelled = { cancelled += it }
    val tap = run.request()
    run.take()
    run.cancel()
    run.cancel()
    assertEquals(listOf(tap), cancelled)
  }

  @Test fun `the end of a cancelled session doesn't end the one after it`() {
    val first = run.request()
    run.take()
    run.cancel()
    run.request()
    run.ended(first)
    assertTrue(run.listening)
  }

  @Test fun `the end of the tap listening turns the tile off`() {
    val tap = run.request()
    run.ended(tap)
    assertFalse(run.listening)
    assertEquals(RecognizeTileTap.LISTEN, run.tap())
  }

  @Test fun `listeners hear each change until they leave`() {
    var heard = 0
    val leave = run.listen { heard++ }
    val tap = run.request()
    run.ended(tap)
    assertEquals(2, heard)
    leave()
    run.request()
    assertEquals(2, heard)
  }

  @Test fun `a new tap gets a new number`() {
    val first = run.request()
    run.ended(first)
    assertTrue(run.request() > first)
  }
}
