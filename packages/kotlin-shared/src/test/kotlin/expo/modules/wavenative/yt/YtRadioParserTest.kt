package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real WEB_REMIX radio answers (`next`, signed out): the first page of a
 * song's radio (`RDAMVM<videoId>`) trimmed to five of its fifty songs
 * (`radio-song.json`: the seed, an explicit song, two collaborations, one
 * crediting an artist without a link, and an official video), and a
 * continuation of another song's radio trimmed to two (`radio-more.json`).
 * An artist's radio starts from their page's Mix button (`artist-page.json`).
 */
class YtRadioParserTest {
  private fun page(name: String) =
    YtRadioParser.page(Fixtures.file("yt/$name").readText()) ?: error("$name didn't parse")

  @Test
  fun readsTheRadiosSongsInOrder() {
    val songs = page("radio-song.json").songs
    assertEquals(
      listOf("6Tde9cPnkp0", "phLb_SoPBlA", "-5qqrMu_AZc", "Rr1Cdli5nE8", "eooxjRHXaJA"),
      songs.map { it.song.videoId },
    )
    val notLikeUs = songs[1].song
    assertEquals("Not Like Us", notLikeUs.title)
    assertEquals(listOf("Kendrick Lamar"), notLikeUs.artists)
    assertEquals("Not Like Us", notLikeUs.album)
    assertTrue(notLikeUs.albumId!!.startsWith("MPREb_"))
    assertEquals(275_000L, notLikeUs.durationMs)
    assertTrue(notLikeUs.explicit)
    assertTrue(notLikeUs.artworkUrl!!.contains("w544-h544"))
    assertFalse(songs[2].song.explicit)
  }

  @Test
  fun readsEveryArtistOfACollaborationLinkedOrNot() {
    val songs = page("radio-song.json").songs
    assertEquals(listOf("Coolio", "L.V."), songs[2].song.artists)
    assertEquals(listOf("Future", "Metro Boomin", "Kendrick Lamar"), songs[3].song.artists)
    assertEquals("WE DON'T TRUST YOU", songs[3].song.album)
  }

  @Test
  fun tellsMusicVideosFromSongs() {
    val songs = page("radio-song.json").songs
    assertEquals(listOf(false, false, false, false, true), songs.map { it.video })
    val video = songs[4].song
    assertEquals(listOf("Tommy Wright III"), video.artists)
    assertNull(video.album)
  }

  @Test
  fun readsTheTokenForMore() {
    assertEquals(
      "CDISOxILNmNjZTdBVGo0Z2MiEVJEQU1WTTZUZGU5Y1Bua3AwMgR3QUVCODH6ARBENjI1QUI0MDI5NEQzODFEGAo%3D",
      page("radio-song.json").continuation,
    )
  }

  @Test
  fun readsAContinuationsSongsAndItsTokenForMore() {
    val more = page("radio-more.json")
    assertEquals(listOf("Smooth Criminal", "Don't You Want Me"), more.songs.map { it.song.title })
    assertEquals(listOf("The Human League"), more.songs[1].song.artists)
    assertTrue(more.continuation!!.startsWith("CGMSPhIL"))
  }

  @Test
  fun anotherAnswerIsNoRadio() {
    assertNull(YtRadioParser.page(Fixtures.file("yt/album-page.json").readText()))
    assertNull(YtRadioParser.page("""{"contents":{}}"""))
  }

  @Test
  fun readsWhereAnArtistsRadioStarts() {
    val start = YtRadioParser.artistRadio(Fixtures.file("yt/artist-page.json").readText())
    assertEquals(YtRadioStart(playlistId = "RDEMni3jl65KF37F9JYsJM8DGg", params = "wAEB"), start)
    assertNull(YtRadioParser.artistRadio(Fixtures.file("yt/album-page.json").readText()))
  }

  @Test
  fun anArtistsRadioTellsJsWhereItStarted() {
    val more = page("radio-more.json")
    val radio = YtArtistRadio(more, YtRadioStart(playlistId = "RDEMabc", params = null)).toMap()
    assertEquals(more.toMap()["songs"], radio["songs"])
    assertEquals(more.continuation, radio["continuation"])
    assertEquals(mapOf("playlistId" to "RDEMabc", "params" to null), radio["start"])
  }
}
