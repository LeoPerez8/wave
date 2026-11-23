package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackRuntimeHoldTest {
  @Test
  fun `playing holds the runtime once, however often it is told`() {
    hold.update(playing = true)
    hold.update(playing = true)
    assertEquals(listOf("hold"), host.calls)
    assertTrue(hold.holding)
  }

  @Test
  fun `a short pause keeps the runtime, and playing again cancels the let-go`() {
    hold.update(playing = true)
    hold.update(playing = false)
    assertEquals(10 * 60_000L, host.letGoIn)
    hold.update(playing = true)
    assertNull(host.letGoIn)
    assertEquals(listOf("hold"), host.calls)
    assertTrue(hold.holding)
  }

  @Test
  fun `a long pause lets the runtime go, and playing again takes it back`() {
    hold.update(playing = true)
    hold.update(playing = false)
    hold.update(playing = false)
    hold.pauseOver()
    assertEquals(listOf("hold", "letGo"), host.calls)
    assertFalse(hold.holding)
    hold.update(playing = true)
    assertEquals(listOf("hold", "letGo", "hold"), host.calls)
  }

  @Test
  fun `a pause while not holding waits for nothing`() {
    hold.update(playing = false)
    assertNull(host.letGoIn)
    hold.pauseOver()
    assertEquals(emptyList<String>(), host.calls)
  }

  @Test
  fun `a stop lets go at once`() {
    hold.update(playing = true)
    hold.update(playing = false)
    hold.stop()
    assertNull(host.letGoIn)
    assertEquals(listOf("hold", "letGo"), host.calls)
    hold.stop()
    assertEquals(listOf("hold", "letGo"), host.calls)
  }

  /** The playback service as the hold sees it: the runtime and one pending let-go. */
  private class FakeHost : RuntimeHoldHost {
    val calls = mutableListOf<String>()
    var letGoIn: Long? = null

    override fun hold() {
      calls += "hold"
    }

    override fun letGo() {
      calls += "letGo"
    }

    override fun scheduleLetGo(delayMs: Long) {
      letGoIn = delayMs
    }

    override fun cancelLetGo() {
      letGoIn = null
    }
  }

  private val host = FakeHost()
  private val hold = PlaybackRuntimeHold(host)
}
