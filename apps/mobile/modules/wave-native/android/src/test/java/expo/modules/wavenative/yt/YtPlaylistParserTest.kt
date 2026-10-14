package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real WEB_REMIX playlist pages (`browse` of `VL<playlistId>`, signed out): a
 * community playlist and one of YouTube Music's own, trimmed to their first
 * three songs (`fixtures/yt`). Whole playlists are read from a 200-song
 * playlist's first page and its continuation (`playlist-long*.json`), and from
 * two later continuations of a 1,157-song one: one listing songs YouTube Music
 * greys out (`playlist-continuation-unavailable.json`, its last page) and one
 * that points to a next page (`playlist-continuation-more.json`). All are
 * trimmed to a few songs.
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

  /**
   * Reads the whole playlist whose first page is [first], answering each
   * continuation from [pages] (token to fixture); a token it doesn't know
   * fails the test. [asked] collects the tokens asked for.
   */
  private fun readWhole(
    first: String,
    pages: Map<String, String>,
    asked: MutableList<String> = mutableListOf(),
    maxSongs: Int = YtPlaylistParser.MAX_SONGS,
    maxPages: Int = YtPlaylistParser.MAX_PAGES,
  ): YtPlaylist? = runBlocking {
    YtPlaylistParser.read(Fixtures.file("yt/$first").readText(), maxSongs, maxPages) { token ->
      asked += token
      Fixtures.file("yt/${pages[token] ?: error("unexpected continuation $token")}").readText()
    }
  }

  @Test
  fun readsEveryPageInOrder() {
    // A 200-song playlist: its first page and the continuation it points to (the last).
    val whole = readWhole("playlist-long.json", mapOf(LONG_NEXT to "playlist-long-continuation.json"))!!
    assertEquals("Pop Music Playlist - Timeless Pop Songs (Updated Weekly 2026)", whole.title)
    assertEquals(
      listOf("ekr2nIex040", "kPa7bsKwL-c", "euCqAq6BRa4", "KNtJGQkC-WI", "ZSM3w1v-A_Y", "gdZLi9oWNZg"),
      whole.songs.map { it.videoId },
    )
    assertFalse(whole.truncated)
  }

  @Test
  fun leavesOutSongsYouTubeMusicGreysOut() {
    val whole = readWhole("playlist-long.json", mapOf(LONG_NEXT to "playlist-continuation-unavailable.json"))!!
    // "Skyfall" and "I Don't Wanna Miss a Thing" are listed, greyed out and unplayable.
    assertEquals(
      listOf("D9g2szHsoz0", "UfcvO2t8Ntg", "ePyRrb2-fzs"),
      whole.songs.drop(3).map { it.videoId },
    )
  }

  @Test
  fun stopsAtTheCap() {
    val asked = mutableListOf<String>()
    val whole = readWhole(
      "playlist-long.json",
      mapOf(LONG_NEXT to "playlist-long-continuation.json"),
      asked,
      maxSongs = 4,
    )!!
    assertEquals(listOf("ekr2nIex040", "kPa7bsKwL-c", "euCqAq6BRa4", "KNtJGQkC-WI"), whole.songs.map { it.videoId })
    assertTrue(whole.truncated)

    assertTrue(readWhole("playlist-long.json", emptyMap(), asked, maxSongs = 3)!!.truncated)
    assertEquals("no page asked for past the cap", 1, asked.size)
  }

  @Test
  fun stopsAPlaylistThatNeverEnds() {
    // A continuation that points back at itself: the same songs, page after page.
    val more = "playlist-continuation-more.json"
    val asked = mutableListOf<String>()
    val endless = mapOf(LONG_NEXT to more, MORE_NEXT to more)
    val whole = readWhole("playlist-long.json", endless, asked, maxPages = 5)!!
    assertEquals(4, asked.size)
    assertTrue(whole.truncated)
    assertEquals(5, whole.songs.size)
  }

  @Test
  fun failsWhenAPageFails() {
    assertThrows(IOException::class.java) {
      runBlocking {
        YtPlaylistParser.read(Fixtures.file("yt/playlist-long.json").readText()) { throw IOException("reset") }
      }
    }
    // An answer that isn't the next page fails the read too, rather than ending it there.
    assertThrows(IllegalStateException::class.java) {
      readWhole("playlist-long.json", mapOf(LONG_NEXT to "home-continuation.json"))
    }
  }

  @Test
  fun anotherPageIsNoWholePlaylist() {
    assertNull(readWhole("album-page.json", emptyMap()))
  }

  private companion object {
    /** The continuation `playlist-long.json` points to. */
    const val LONG_NEXT =
      "4qmFsgKHARIkVkxQTE1DOUtOa0luY0t0UHpnWS01cm1odmo3ZmF4OGZkeG9qGjplaDVRVkRwRFIxRnBSVVJaTTFKRlRYZFBWRnBIVW10UmVrMXFaekZSZWxXU0FRTUl1Z1R3QVFBJTNEmgIiUExNQzlLTmtJbmNLdFB6Z1ktNXJtaHZqN2ZheDhmZHhvag%3D%3D"

    /** The continuation `playlist-continuation-more.json` points to. */
    const val MORE_NEXT =
      "4qmFsgJlEhRWTFBMMTVCMUU3N0JCNTcwODU1NRo4ZWg5UVZEcERUWGRKU1doQmVVNXFUWGROYTFGM1VsUmFSVTR3VFhkUFZHY3hrZ0VEQ0xvRThBRUGaAhJQTDE1QjFFNzdCQjU3MDg1NTU%3D"
  }
}
