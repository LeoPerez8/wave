package expo.modules.wavenative.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
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

  private val sung = LyricFrame(previous = "Tudo o que eu sinto", current = "Mais real ainda", next = "Quando fecho os olhos")
  private val after = LyricFrame(previous = "Mais real ainda", current = "Quando fecho os olhos", next = null)

  private fun showing(): AutoLyricsState =
    AutoLyricsState().apply {
      init(MemoryStore(saved = true))
      setCarConnected(true)
    }

  private val authority = "dev.leoperez.wave.artwork"
  private val cover = "/data/files/artwork/${"a".repeat(40)}.jpg"

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
  fun `the lines JS sent belong to their item`() {
    val state = showing()
    state.showLines("entry-1", sung)

    assertEquals(sung, state.linesFor("entry-1"))
  }

  @Test
  fun `another item shows its own artwork until JS sends its lines`() {
    val state = showing()
    state.showLines("entry-1", sung)

    assertNull(state.linesFor("entry-2"))
  }

  @Test
  fun `turning the toggle off brings the artwork back at once`() {
    val state = showing()
    state.showLines("entry-1", sung)

    state.toggle()

    assertNull(state.linesFor("entry-1"))
  }

  @Test
  fun `Auto disconnecting brings the artwork back, and late lines don't show`() {
    val state = showing()
    state.showLines("entry-1", sung)

    state.setCarConnected(false)
    assertNull(state.linesFor("entry-1"))

    state.showLines("entry-1", after)
    assertNull(state.linesFor("entry-1"))
  }

  @Test
  fun `listeners hear about the toggle, the connection and the lines`() {
    val state = showing()
    var calls = 0
    state.listen { calls += 1 }

    state.toggle()
    state.setCarConnected(false)
    state.setCarConnected(false)
    state.showLines("entry-1", null)

    assertEquals(2, calls)
  }

  @Test
  fun `the same lines sent again don't wake the listeners`() {
    val state = showing()
    state.showLines("entry-1", sung)
    var calls = 0
    state.listen { calls += 1 }

    state.showLines("entry-1", sung.copy())

    assertEquals(0, calls)
  }

  @Test
  fun `with lyrics, the session shows a lyrics image in place of the item's artwork`() {
    val artwork = LyricArtworks()
    val state = showing()
    state.showLines("entry-1", sung)

    val uri = artwork.uriFor(authority, state.linesFor("entry-1"), cover)

    assertNotNull(uri)
    assertTrue(uri!!.startsWith("content://$authority/lyrics/"))
    assertEquals(LyricArtworks.Entry(sung, cover), artwork.find(uri.substringAfterLast('/')))
  }

  @Test
  fun `each new line is a new image, and the same line keeps its image`() {
    val artwork = LyricArtworks()

    val first = artwork.uriFor(authority, sung, cover)
    val again = artwork.uriFor(authority, sung.copy(), cover)
    val next = artwork.uriFor(authority, after, cover)

    assertEquals(first, again)
    assertNotEquals(first, next)
  }

  @Test
  fun `Auto disconnecting gives the phone's notification and lock screen their artwork back`() {
    val artwork = LyricArtworks()
    val state = showing()
    state.showLines("entry-1", sung)
    assertNotNull(artwork.uriFor(authority, state.linesFor("entry-1"), cover))

    state.setCarConnected(false)

    assertNull(artwork.uriFor(authority, state.linesFor("entry-1"), cover))
  }

  @Test
  fun `only the latest images are kept`() {
    val artwork = LyricArtworks()
    val oldest = artwork.uriFor(authority, sung, cover)!!.substringAfterLast('/')
    repeat(LyricArtworks.KEPT) { artwork.uriFor(authority, sung.copy(current = "Line $it"), cover) }

    assertNull(artwork.find(oldest))
    assertEquals(LyricArtworks.KEPT, artwork.liveIds().size)
  }

  @Test
  fun `another process's images are never mistaken for this one's`() {
    val first = LyricArtworks().uriFor(authority, sung, cover)
    val second = LyricArtworks().uriFor(authority, sung, cover)

    assertNotEquals(first, second)
  }
}
