package expo.modules.wavenative.recognize

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

  @Test fun `JS takes a tap once, even if it came before JS was running`() {
    val tap = run.request()
    assertEquals(tap, run.take()?.tap)
    assertNull(run.take())
    assertTrue(run.listening)
  }

  @Test fun `a tap leaves the source to JS`() {
    run.request()
    assertEquals(false, run.take()?.microphone)
  }

  @Test fun `Use Microphone tells JS to listen through the microphone, for that tap only`() {
    val forced = run.request(microphone = true)
    assertEquals(true, run.take()?.microphone)
    run.ended(forced)
    run.request()
    assertEquals(false, run.take()?.microphone)
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
    assertNull(run.take())
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
