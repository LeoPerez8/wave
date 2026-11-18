package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real WEB_REMIX album pages (`browse` of an `MPREb_…` id), trimmed of tracking noise (`fixtures/yt`). */
class YtAlbumParserTest {
  private fun album(name: String) =
    YtAlbumParser.album(Fixtures.file("yt/$name").readText()) ?: error("$name didn't parse")

  @Test
  fun readsTheAlbumsTitleArtistsYearAndCover() {
    val album = album("album-page.json")
    assertEquals("Random Access Memories", album.title)
    assertEquals(listOf("Daft Punk"), album.artists)
    assertEquals(2013, album.year)
    assertEquals("OLAK5uy_kNhM2yaBTOVwrcZJepB1C9P3-n5_Sfy5c", album.playlistId)
    val cover = album.artworkUrl!!
    assertTrue("the largest cover: $cover", cover.startsWith("https://") && cover.contains("w544-h544"))
  }

  @Test
  fun readsEveryTrackWithItsNumberInOrder() {
    val tracks = album("album-page.json").tracks
    assertEquals((1..13).toList(), tracks.map { it.trackNumber })
    assertEquals(13, tracks.map { it.videoId }.toSet().size)
    val getLucky = tracks[7]
    assertEquals("5NV6Rdv1a3I", getLucky.videoId)
    assertEquals("Get Lucky (feat. Pharrell Williams and Nile Rodgers)", getLucky.title)
    assertEquals(listOf("Daft Punk", "Pharrell Williams", "Nile Rodgers"), getLucky.artists)
    assertEquals(370_000L, getLucky.durationMs)
    assertEquals(listOf("Daft Punk"), tracks[0].artists)
  }

  @Test
  fun aSinglesTrackWithoutItsOwnCreditTakesTheAlbums() {
    val single = album("album-single.json")
    assertEquals("Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)", single.title)
    assertEquals(listOf("Daft Punk", "Pharrell Williams", "Nile Rodgers"), single.artists)
    assertEquals(2013, single.year)
    val track = single.tracks.single()
    assertEquals(1, track.trackNumber)
    assertEquals(single.artists, track.artists)
    assertEquals(249_000L, track.durationMs)
  }

  @Test
  fun anAlbumCreditedWithoutLinksKeepsTheCreditsText() {
    val body = """
      {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
        {"musicResponsiveHeaderRenderer":{"title":{"runs":[{"text":"Now 100"}]},
          "subtitle":{"runs":[{"text":"Album"},{"text":" • "},{"text":"2018"}]},
          "straplineTextOne":{"runs":[{"text":"Various Artists"}]}}}]}}}}]}}}
    """
    val album = YtAlbumParser.album(body)
    assertNotNull(album)
    assertEquals(listOf("Various Artists"), album!!.artists)
    assertEquals(2018, album.year)
    assertEquals(emptyList<YtAlbumTrack>(), album.tracks)
    assertNull(album.artworkUrl)
  }

  @Test
  fun anAnswerThatIsntAnAlbumPageIsNull() {
    assertNull(YtAlbumParser.album("""{"contents":{"sectionListRenderer":{"contents":[]}}}"""))
    assertNull(YtAlbumParser.album("""{"error":{"code":404}}"""))
  }
}
