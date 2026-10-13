package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real WEB_REMIX playlist pages (`browse` of `VL<playlistId>`, signed out): a
 * community playlist and one of YouTube Music's own, trimmed to their first
 * three songs (`fixtures/yt`).
 */
class YtPlaylistParserTest {
  private fun playlist(name: String) =
    YtPlaylistParser.playlist(Fixtures.file("yt/$name").readText()) ?: error("$name didn't parse")

  @Test
  fun readsTheTitleWhoMadeItAndTheCover() {
    val community = playlist("playlist-community.json")
    assertEquals("2000's", community.title)
    assertEquals("Casa de Rodapé 🐱", community.author)
    assertTrue(community.artworkUrl!!.endsWith("=s1200"))
    assertEquals("YouTube Music", playlist("playlist-curated.json").author)
  }

  @Test
  fun readsItsSongsInOrderWithTheirLengths() {
    val songs = playlist("playlist-curated.json").songs
    assertEquals(listOf("lp-EO5I60KA", "rtOvBOTyX00", "0yW7w8F2TVA"), songs.map { it.videoId })
    val first = songs[0]
    assertEquals("Thinking out Loud", first.title)
    assertEquals(listOf("Ed Sheeran"), first.artists)
    assertEquals(290_000L, first.durationMs)
    assertTrue(first.artworkUrl!!.startsWith("https://"))
  }

  @Test
  fun aMusicVideoHasNoAlbum() {
    val buttons = playlist("playlist-community.json").songs[2]
    assertEquals("Buttons (feat. Snoop Dogg)", buttons.title)
    assertEquals(listOf("The Pussycat Dolls"), buttons.artists)
    assertNull(buttons.album)
    assertEquals(236_000L, buttons.durationMs)
  }

  @Test
  fun anotherPageIsNoPlaylist() {
    assertNull(YtPlaylistParser.playlist(Fixtures.file("yt/album-page.json").readText()))
    assertNull(YtPlaylistParser.playlist("""{"contents":{}}"""))
  }
}
