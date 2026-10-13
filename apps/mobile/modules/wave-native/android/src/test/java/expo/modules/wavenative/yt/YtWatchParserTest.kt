package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A real WEB_REMIX `next` answer for a song and the `browse` answer of its
 * lyrics tab, trimmed (`fixtures/yt`; the lyrics' text is replaced).
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
