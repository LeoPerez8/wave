package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real WEB_REMIX Artists searches and artist pages, trimmed of tracking noise (`fixtures/yt`). */
class YtArtistParserTest {
  private fun body(name: String) = Fixtures.file("yt/$name").readText()

  @Test
  fun readsEveryArtistOfAnArtistsSearch() {
    val artists = YtArtistParser.artists(body("search-artists.json"))
    assertEquals(7, artists.size)
    assertEquals(
      YtArtistCandidate(name = "Daft Punk", browseId = "UCRr1xG_2WIDs18a6cIiCxeA", audience = 75_100_000L),
      artists.first(),
    )
    assertEquals(
      YtArtistCandidate(name = "Daft Punk's Karaoke Band", browseId = "UCeMvmMQswZlx62mKYeJJ4oA", audience = 3L),
      artists[4],
    )
  }

  @Test
  fun namesakesComeWithHowFollowedEachIs() {
    val nirvanas = YtArtistParser.artists(body("search-artists-namesakes.json")).filter { it.name == "Nirvana" }
    assertEquals(
      listOf(55_500_000L, 2_400L, 16L, 10L, 2L),
      nirvanas.map { it.audience },
    )
    assertTrue(nirvanas.all { it.browseId.startsWith("UC") })
  }

  @Test
  fun aSearchWithoutArtistsHasNone() {
    assertTrue(YtArtistParser.artists(body("search-artists-none.json")).isEmpty())
    assertTrue(YtArtistParser.artists("""{"contents":{}}""").isEmpty())
  }

  @Test
  fun readsAudiencesInEveryUnit() {
    assertEquals(75_100_000L, YtArtistParser.audience("75.1M monthly audience"))
    assertEquals(2_400L, YtArtistParser.audience("2.4K subscribers"))
    assertEquals(1_200_000_000L, YtArtistParser.audience("1.2B subscribers"))
    assertEquals(3L, YtArtistParser.audience("3 subscribers"))
    assertNull(YtArtistParser.audience("Artist"))
  }

  @Test
  fun readsTheArtistsNameAndTopSongs() {
    val page = YtArtistParser.page(body("artist-page.json"))!!
    assertEquals("Daft Punk", page.name)
    assertEquals(5, page.songs.size)
    val song = page.songs.first()
    assertEquals("khnokW3Mw24", song.videoId)
    assertEquals("Instant Crush (feat. Julian Casablancas)", song.title)
    assertEquals(listOf("Daft Punk", "Julian Casablancas"), song.artists)
    assertEquals("Random Access Memories", song.album)
    assertEquals("MPREb_K8qWMWVqXGi", song.albumId)
    assertNull("an artist page lists plays, not lengths", song.durationMs)
    assertTrue(song.artworkUrl!!.startsWith("https://"))
  }

  @Test
  fun readsTheArtistsAlbumsAndSingles() {
    val page = YtArtistParser.page(body("artist-page.json"))!!
    assertEquals(10, page.albums.size)
    assertEquals(
      YtShelfItem.Album(
        browseId = "MPREb_OgeEnoHTsCm",
        title = "Random Access Memories (Drumless Edition)",
        artists = listOf("Daft Punk"),
        year = 2023,
        artworkUrl = page.albums.first().artworkUrl,
      ),
      page.albums.first(),
    )
    assertNotNull(page.albums.first().artworkUrl)
    assertEquals(10, page.singles.size)
    assertEquals("GLBTM (Studio Outtakes)", page.singles.first().title)
    assertEquals("MPREb_X1DQ1j0PPrX", page.singles.first().browseId)
    assertEquals(2023, page.singles.first().year)
    assertEquals(listOf("Daft Punk"), page.singles.first().artists)
  }

  @Test
  fun leavesOutVideosPlaylistsAndOtherArtists() {
    val page = YtArtistParser.page(body("artist-page.json"))!!
    val ids = page.albums.map { it.browseId } + page.singles.map { it.browseId }
    assertTrue(ids.all { it.startsWith("MPREb_") })
  }

  @Test
  fun anArtistWithoutSinglesHasNone() {
    val page = YtArtistParser.page(body("artist-page-no-singles.json"))!!
    assertEquals("Nirvana", page.name)
    assertEquals(5, page.songs.size)
    assertEquals("Rainbow Chaser", page.songs.first().title)
    assertEquals(10, page.albums.size)
    assertTrue(page.singles.isEmpty())
  }

  @Test
  fun anAnswerThatIsNotAnArtistPageIsNone() {
    assertNull(YtArtistParser.page("""{"contents":{}}"""))
    assertNull(YtArtistParser.page(body("album-page.json")))
  }
}
