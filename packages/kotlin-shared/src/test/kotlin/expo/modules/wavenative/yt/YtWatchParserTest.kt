package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A real WEB_REMIX `next` answer for a song and the `browse` answers of its
 * lyrics and Related tabs, trimmed (`fixtures/yt`; the lyrics' text is
 * replaced, and the Related tab's answer lost its tracking fields and all but
 * the largest thumbnail of each row).
 */
class YtWatchParserTest {
  private fun fixture(name: String) = Fixtures.file("yt/$name").readText()

  @Test
  fun readsTheSongsAlbumAndWhereItsLyricsAre() {
    val song = YtWatchParser.song(fixture("next-song.json"))
    assertEquals("MPREb_K8qWMWVqXGi", song.albumId)
    assertEquals("MPLYt_K8qWMWVqXGi-8", song.lyricsBrowseId)
  }

  @Test
  fun readsWhereTheSongsRelatedTabIs() {
    assertEquals("MPTRt_K8qWMWVqXGi-8", YtWatchParser.song(fixture("next-song.json")).relatedBrowseId)
  }

  @Test
  fun readsTheRelatedTabsSongsInItsOrder() {
    val songs = YtWatchParser.related(fixture("related-song.json")).songs
    assertEquals(20, songs.size)
    val first = songs.first()
    assertEquals("cC_9nc4QOgQ", first.videoId)
    assertEquals("Killer Queen", first.title)
    assertEquals(listOf("Queen"), first.artists)
    assertEquals("Sheer Heart Attack", first.album)
    assertEquals("MPREb_AeFVIDnzTTK", first.albumId)
    assertEquals("MUSIC_VIDEO_TYPE_ATV", first.videoType)
    assertEquals(
      listOf("Daft Punk", "Pharrell Williams", "Nile Rodgers"),
      songs[1].artists,
    )
    assertEquals("For A Better Day", songs.last().title)
  }

  @Test
  fun leavesOutOtherPerformancesOfTheSongPlaying() {
    // "Other performances" lists covers and live takes of Get Lucky, the song playing.
    val songs = YtWatchParser.related(fixture("related-song.json")).songs
    assertTrue(songs.none { it.title.startsWith("Anna McLuckie") })
    assertTrue(songs.none { "Halestorm" in it.artists })
  }

  @Test
  fun readsTheRelatedTabsSimilarArtists() {
    val artists = YtWatchParser.related(fixture("related-song.json")).artists
    assertEquals(10, artists.size)
    assertEquals("Justice", artists.first().name)
    assertEquals("UCcJLC91v0A0iD-CMUWdZkig", artists.first().browseId)
    assertEquals(536_000L, artists.first().audience)
    assertEquals("Kavinsky", artists[1].name)
  }

  @Test
  fun readsEachSimilarArtistsPhoto() {
    // Related's artists row shows each artist's photo over their name.
    val artists = YtWatchParser.related(fixture("related-song.json")).artists
    assertEquals(
      "https://yt3.googleusercontent.com/55PSu47gaRpDqL6mWN69tNb8bl7mFUsM_XZLoi9XxJXssZX_CnNdTgDlZjVK2zgoUegtOkAqgSXrTcI=w544-h544-p-l90-rj",
      artists.first().artworkUrl,
    )
    assertTrue(artists.all { it.artworkUrl?.startsWith("https://") == true })
  }

  @Test
  fun aRelatedTabWithNothingReadableHasNoSongsOrArtists() {
    val related = YtWatchParser.related("""{"contents":{"sectionListRenderer":{"contents":[{"musicDescriptionShelfRenderer":{}}]}}}""")
    assertTrue(related.songs.isEmpty())
    assertTrue(related.artists.isEmpty())
    assertTrue(YtWatchParser.related("{}").songs.isEmpty())
  }

  @Test
  fun aSongWithoutALyricsTabOrAlbumHasNeither() {
    val body = """
      {"contents":{"singleColumnMusicWatchNextResultsRenderer":{"tabbedRenderer":{"watchNextTabbedResultsRenderer":{"tabs":[
        {"tabRenderer":{"title":"Up next","content":{"musicQueueRenderer":{"content":{"playlistPanelRenderer":{"contents":[
          {"playlistPanelVideoRenderer":{"longBylineText":{"runs":[{"text":"Someone"},{"text":" • "},{"text":"2020"}]}}}]}}}}}},
        {"tabRenderer":{"title":"Lyrics","unselectable":true}}]}}}}}
    """
    val song = YtWatchParser.song(body)
    assertNull(song.albumId)
    assertNull(song.lyricsBrowseId)
    assertNull(song.relatedBrowseId)
  }

  @Test
  fun readsTheLyricsText() {
    assertEquals(
      "First line of the song\r\nSecond line\r\n\r\nA line after a break",
      YtWatchParser.lyrics(fixture("song-lyrics.json")),
    )
  }

  @Test
  fun aLyricsPageWithoutLyricsHasNone() {
    assertNull(YtWatchParser.lyrics("""{"contents":{"sectionListRenderer":{"contents":[{"messageRenderer":{}}]}}}"""))
    assertNull(YtWatchParser.lyrics("""{"contents":{}}"""))
  }
}
