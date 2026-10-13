package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoLyricsTest {
  /** A toggle store in memory, standing in for SharedPreferences. */
  private class MemoryStore(var saved: Boolean = false) : LyricsToggleStore {
    override fun load() = saved

    override fun save(on: Boolean) {
      saved = on
    }
  }

  private fun showing(): AutoLyricsState =
    AutoLyricsState().apply {
      init(MemoryStore(saved = true))
      setCarConnected(true)
    }

  @Test
  fun `the toggle is off on a fresh install`() {
    val state = AutoLyricsState().apply { init(MemoryStore()) }
    assertFalse(state.on)
  }

  @Test
  fun `the toggle is remembered`() {
    val store = MemoryStore()
    AutoLyricsState().apply { init(store) }.toggle()

    val next = AutoLyricsState().apply { init(store) }

    assertTrue(next.on)
  }

  @Test
  fun `the button shows the toggle's state`() {
    assertEquals("Lyrics off", AutoLyrics.label(on = false))
    assertEquals("Lyrics on", AutoLyrics.label(on = true))
  }

  @Test
  fun `the line JS sent shows under the title of its item`() {
    val state = showing()
    state.showLine("entry-1", "First line")

    assertEquals("First line", state.lineFor("entry-1"))
  }

  @Test
  fun `another item shows its artist until JS sends its line`() {
    val state = showing()
    state.showLine("entry-1", "First line")

    assertNull(state.lineFor("entry-2"))
  }

  @Test
  fun `turning the toggle off brings the artist back at once`() {
    val state = showing()
    state.showLine("entry-1", "First line")

    state.toggle()

    assertNull(state.lineFor("entry-1"))
  }

  @Test
  fun `Auto disconnecting brings the artist back, and a late line doesn't show`() {
    val state = showing()
    state.showLine("entry-1", "First line")

    state.setCarConnected(false)
    assertNull(state.lineFor("entry-1"))

    state.showLine("entry-1", "Second line")
    assertNull(state.lineFor("entry-1"))
  }

  @Test
  fun `listeners hear about the toggle, the connection and the line`() {
    val state = showing()
    var calls = 0
    state.listen { calls += 1 }

    state.toggle()
    state.setCarConnected(false)
    state.setCarConnected(false)
    state.showLine("entry-1", null)

    assertEquals(2, calls)
  }
}
