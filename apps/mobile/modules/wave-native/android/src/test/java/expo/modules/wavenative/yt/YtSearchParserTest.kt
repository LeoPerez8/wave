package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real WEB_REMIX song-search responses, trimmed of tracking noise (`fixtures/yt`). */
class YtSearchParserTest {
  private fun page(name: String) = YtSearchParser.songs(Fixtures.file("yt/$name").readText())

  @Test
  fun readsEverySongOfTheShelf() {
    val page = page("search-songs.json")
    assertEquals(20, page.songs.size)
    assertEquals(20, page.songs.map { it.videoId }.toSet().size)
  }

  @Test
  fun readsASongsTitleArtistsAlbumLengthAndCover() {
    val song = page("search-songs.json").songs.first()
    assertEquals("4D7u5KF7SP8", song.videoId)
    assertEquals("Get Lucky (feat. Pharrell Williams and Nile Rodgers)", song.title)
    assertEquals(listOf("Daft Punk", "Pharrell Williams", "Nile Rodgers"), song.artists)
    assertEquals("Random Access Memories", song.album)
    assertEquals("MPREb_K8qWMWVqXGi", song.albumId)
    assertEquals(370_000L, song.durationMs)
    val artwork = song.artworkUrl!!
    assertTrue(artwork.startsWith("https://"))
    assertTrue("the largest cover", artwork.contains("w120-h120"))
    assertFalse(song.explicit)
  }

  @Test
  fun marksExplicitSongs() {
    val songs = page("search-songs-explicit.json").songs
    assertEquals("HUMBLE.", songs[0].title)
    assertTrue(songs[0].explicit)
    assertFalse("the clean version", songs[2].explicit)
  }

  @Test
  fun keepsTheContinuationForMoreResults() {
    assertNotNull(page("search-songs.json").continuation)
  }

  @Test
  fun skipsWhatIsNotASong() {
    // A misspelt query opens with a "Did you mean" section before the songs.
    val page = page("search-songs-empty.json")
    assertTrue(page.songs.isNotEmpty())
    assertTrue(page.songs.all { it.videoId.isNotEmpty() && it.title.isNotEmpty() })
  }

  @Test
  fun anAnswerWithoutSongsHasNone() {
    val page = YtSearchParser.songs("""{"contents":{}}""")
    assertTrue(page.songs.isEmpty())
    assertNull(page.continuation)
  }

  @Test
  fun readsEveryAlbumOfAnAlbumsSearch() {
    val albums = YtSearchParser.albums(Fixtures.file("yt/search-albums.json").readText())
    assertEquals(8, albums.size)
    val album = albums.first()
    assertEquals("MPREb_GIfNGta2miN", album.browseId)
    assertEquals("Watch The Throne (Deluxe)", album.title)
    assertEquals(listOf("JAŸ-Z", "Kanye West"), album.artists)
    assertEquals(2011, album.year)
    assertEquals("album", album.releaseType)
    assertEquals("album", album.toMap()["releaseType"])
    assertTrue("the largest cover", album.artworkUrl!!.contains("w544-h544"))
    assertEquals(listOf("Kanye West"), albums[1].artists)
  }

  @Test
  fun aSearchWithoutAlbumsHasNone() {
    assertTrue(YtSearchParser.albums(Fixtures.file("yt/search-artists-none.json").readText()).isEmpty())
    assertTrue(YtSearchParser.albums("""{"contents":{}}""").isEmpty())
  }

  @Test
  fun readsDurationsInEveryNotation() {
    assertEquals(370_000L, YtSearchParser.durationMs("6:10"))
    assertEquals(3_723_000L, YtSearchParser.durationMs("1:02:03"))
    assertEquals(370_000L, YtSearchParser.durationMs("6.10"))
    assertNull(YtSearchParser.durationMs("1.9B plays"))
  }
}
