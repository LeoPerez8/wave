package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real WEB_REMIX playlist pages (`browse` of `VL<playlistId>`, signed out): a
 * community playlist and one of YouTube Music's own, trimmed to their first
 * three songs (`fixtures/yt`). Continuations come from a 200-song playlist's
 * first page and its last continuation (`playlist-long*.json`), and from two
 * later continuations of a 1,157-song one: one listing songs YouTube Music
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

  private fun more(name: String) =
    YtPlaylistParser.more(Fixtures.file("yt/$name").readText()) ?: error("$name didn't parse")

  @Test
  fun aFirstPageSaysWhereThePlaylistGoesOn() {
    // A 200-song playlist's first page ends with the token for its next.
    val first = playlist("playlist-long.json")
    assertEquals("Pop Music Playlist - Timeless Pop Songs (Updated Weekly 2026)", first.title)
    assertEquals(listOf("ekr2nIex040", "kPa7bsKwL-c", "euCqAq6BRa4"), first.songs.map { it.videoId })
    assertEquals(LONG_NEXT, first.continuation)
    assertNull(playlist("playlist-curated.json").continuation)
  }

  @Test
  fun readsAContinuationsSongsAndTheTokenForTheNext() {
    val page = more("playlist-continuation-more.json")
    // Its second row is greyed out.
    assertEquals(listOf("c7tOAGY59uQ", "VUjdiDeJ0xg"), page.songs.map { it.videoId })
    assertEquals(MORE_NEXT, page.continuation)
  }

  @Test
  fun theLastContinuationGoesNowhere() {
    val last = more("playlist-long-continuation.json")
    assertEquals(listOf("KNtJGQkC-WI", "ZSM3w1v-A_Y", "gdZLi9oWNZg"), last.songs.map { it.videoId })
    assertNull(last.continuation)
  }

  @Test
  fun leavesOutSongsYouTubeMusicGreysOut() {
    // "Skyfall" and "I Don't Wanna Miss a Thing" are listed, greyed out and unplayable.
    assertEquals(
      listOf("D9g2szHsoz0", "UfcvO2t8Ntg", "ePyRrb2-fzs"),
      more("playlist-continuation-unavailable.json").songs.map { it.videoId },
    )
  }

  @Test
  fun anotherAnswerIsNoContinuation() {
    assertNull(YtPlaylistParser.more(Fixtures.file("yt/home-continuation.json").readText()))
    assertNull(YtPlaylistParser.more(Fixtures.file("yt/playlist-long.json").readText()))
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
