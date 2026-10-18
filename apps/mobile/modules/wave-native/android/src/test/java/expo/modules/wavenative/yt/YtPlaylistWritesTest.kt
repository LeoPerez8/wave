package expo.modules.wavenative.yt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sharing a playlist on YT Music: reading the account's own playlist back
 * (built from the page's shape ytmusicapi's `get_playlist` reads; no
 * signed-in answer could be captured where this was written), the edit
 * actions, and the `SAPISIDHASH` header (checked against Python's hashlib).
 */
class YtPlaylistWritesTest {
  private fun row(videoId: String, setVideoId: String) =
    """{"musicResponsiveListItemRenderer":{"playlistItemData":{"videoId":"$videoId","playlistSetVideoId":"$setVideoId"}}}"""

  private fun page(header: String, rows: String) =
    """{"contents":{"twoColumnBrowseResultsRenderer":{
      "tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[{"$header":{}}]}}}}],
      "secondaryContents":{"sectionListRenderer":{"contents":[{"musicPlaylistShelfRenderer":{"contents":[$rows]}}]}}}}}"""

  @Test
  fun readsTheEntriesOfAnEditablePlaylist() {
    val more = """{"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"next"}}}}"""
    val read = YtOwnPlaylistParser.page(
      page("musicEditablePlaylistDetailHeaderRenderer", "${row("a", "1")},${row("b", "2")},$more"),
    )!!
    assertTrue(read.editable)
    assertEquals(listOf(YtOwnEntry("a", "1"), YtOwnEntry("b", "2")), read.entries)
    assertEquals("next", read.continuation)
  }

  @Test
  fun anotherAccountsPlaylistIsNotEditable() {
    val read = YtOwnPlaylistParser.page(page("musicResponsiveHeaderRenderer", row("a", "1")))!!
    assertFalse(read.editable)
  }

  @Test
  fun anAnswerThatIsNoPlaylistPageReadsAsNone() {
    assertNull(YtOwnPlaylistParser.page("""{"alerts":[]}"""))
  }

  @Test
  fun editsBecomeYouTubeMusicsActions() {
    val edits = listOf(
      mapOf("kind" to "add", "videoId" to "a"),
      mapOf("kind" to "remove", "videoId" to "b", "setVideoId" to "2"),
      mapOf("kind" to "move", "setVideoId" to "3", "before" to "4"),
      mapOf("kind" to "move", "setVideoId" to "3", "before" to null),
      mapOf("kind" to "rename", "title" to "Road trip"),
    ).map { YtPlaylistEdit.action(YtPlaylistEdit.of(it)!!).toString() }
    assertEquals(
      listOf(
        """{"action":"ACTION_ADD_VIDEO","addedVideoId":"a","dedupeOption":"DEDUPE_OPTION_SKIP"}""",
        """{"action":"ACTION_REMOVE_VIDEO","setVideoId":"2","removedVideoId":"b"}""",
        """{"action":"ACTION_MOVE_VIDEO_BEFORE","setVideoId":"3","movedSetVideoIdSuccessor":"4"}""",
        """{"action":"ACTION_MOVE_VIDEO_BEFORE","setVideoId":"3"}""",
        """{"action":"ACTION_SET_PLAYLIST_NAME","playlistName":"Road trip"}""",
      ),
      edits,
    )
    assertNull(YtPlaylistEdit.of(mapOf("kind" to "shuffle")))
  }

  @Test
  fun signsWithTheSessionsSapisid() {
    assertEquals("abc/DEF", YtPlaylistWrites.sapisid("HSID=x; SAPISID=abc/DEF; SID=y"))
    assertEquals("z", YtPlaylistWrites.sapisid("__Secure-3PAPISID=z"))
    assertNull(YtPlaylistWrites.sapisid("SID=y"))
    assertEquals(
      "SAPISIDHASH 1700000000_e01d02cf367d3d97a8bb84d4164d4f89ec596c0a",
      YtPlaylistWrites.sapisidHash("abc/DEF", 1_700_000_000),
    )
  }
}
