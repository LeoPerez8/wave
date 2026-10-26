package expo.modules.wavenative.player

import androidx.media3.common.MediaMetadata
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

  private val sung = LyricsText(title = "Mais real ainda", artist = "Quando fecho os olhos")
  private val last = LyricsText(title = "Quando fecho os olhos", artist = null)

  /** The now-playing item's own metadata. */
  private val real = MediaMetadata.Builder().setTitle("Title").setArtist("Artist").setAlbumTitle("Album").build()

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
  fun `the text JS sent belongs to its item`() {
    val state = showing()
    state.showText("entry-1", sung)

    assertEquals(sung, state.textFor("entry-1"))
  }

  @Test
  fun `another item shows its own title and artist until JS sends its text`() {
    val state = showing()
    state.showText("entry-1", sung)

    assertNull(state.textFor("entry-2"))
  }

  @Test
  fun `turning the toggle off brings the real title and artist back at once`() {
    val state = showing()
    state.showText("entry-1", sung)

    state.toggle()

    assertNull(state.textFor("entry-1"))
  }

  @Test
  fun `Auto disconnecting brings the real title and artist back, and late text doesn't show`() {
    val state = showing()
    state.showText("entry-1", sung)

    state.setCarConnected(false)
    assertNull(state.textFor("entry-1"))

    state.showText("entry-1", last)
    assertNull(state.textFor("entry-1"))
  }

  @Test
  fun `listeners hear about the toggle, the connection and the text`() {
    val state = showing()
    var calls = 0
    state.listen { calls += 1 }

    state.toggle()
    state.setCarConnected(false)
    state.setCarConnected(false)
    state.showText("entry-1", null)

    assertEquals(2, calls)
  }

  @Test
  fun `the same text sent again doesn't wake the listeners`() {
    val state = showing()
    state.showText("entry-1", sung)
    var calls = 0
    state.listen { calls += 1 }

    state.showText("entry-1", sung.copy())

    assertEquals(0, calls)
  }

  @Test
  fun `with lyrics, the title is the line being sung and the artist the next one`() {
    val state = showing()
    state.showText("entry-1", sung)

    val shown = real.withLyrics(state.textFor("entry-1"))

    assertEquals("Mais real ainda", shown.title.toString())
    assertEquals("Quando fecho os olhos", shown.artist.toString())
    assertEquals("Album", shown.albumTitle.toString())
  }

  @Test
  fun `on the last line the artist is the real one`() {
    val shown = real.withLyrics(last)

    assertEquals("Quando fecho os olhos", shown.title.toString())
    assertEquals("Artist", shown.artist.toString())
  }

  @Test
  fun `Auto disconnecting gives the phone's notification and lock screen the real title and artist back`() {
    val state = showing()
    state.showText("entry-1", sung)

    state.setCarConnected(false)

    val shown = real.withLyrics(state.textFor("entry-1"))
    assertEquals("Title", shown.title.toString())
    assertEquals("Artist", shown.artist.toString())
  }
}
