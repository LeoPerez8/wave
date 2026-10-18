package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The account's library playlists: WEB_REMIX answers to `browse` of
 * `FEmusic_liked_playlists` and the continuation its grid points to
 * (`library-playlists*.json`). No signed-in answer could be captured where
 * this was written, so those two are built from the page's real shape (the
 * grid of `musicTwoRowItemRenderer` tiles Metrolist's `LibraryPage` and
 * ytmusicapi's `get_library_playlists` read: New playlist first, Liked Music
 * and Episodes for Later, the account's playlists with an Edit entry in
 * their menu, then a `gridContinuation`). The signed-out answer
 * (`library-playlists-signed-out.json`) is real.
 */
class YtLibraryParserTest {
  private fun body(name: String) = Fixtures.file("yt/$name").readText()

  private fun page(name: String) = YtLibraryParser.page(body(name)) ?: error("$name didn't parse")

  @Test
  fun readsThePlaylistsInOrderWithoutNewPlaylist() {
    val first = page("library-playlists.json")
    assertEquals(
      listOf(
        "LM", "SE", "PLQwVIlKxHM6rz0fDJVv_0UlXGEWf-bFys", "RDTMAK5uy_kset8DisdE7LSD4TNjEVvrKRTmG7a56E",
        "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG", "RDCLAK5uy_lBNUteBRencHzKelu5iDHwLF6mYqjL-JU",
        "MPSPPLwXgBmz5JDfHrJvmDHBu5r5b6s2bHzKgl",
      ),
      first.playlists.map { it.playlistId },
    )
  }

  @Test
  fun readsTheNameCoverAndSongCount() {
    val road = page("library-playlists.json").playlists[2]
    assertEquals("Road trip", road.title)
    assertEquals("https://yt3.ggpht.com/roadtrip=s576", road.artworkUrl)
    assertEquals(24, road.songCount)
    assertEquals(1234, page("library-playlists.json").playlists[4].songCount)
    assertEquals(1, page("library-playlists-continuation.json").playlists[0].songCount)
    assertNull("Liked Music's line has no count", page("library-playlists.json").playlists[0].songCount)
  }

  @Test
  fun tellsTheAccountsOwnFromSavedFromGenerated() {
    val kinds = page("library-playlists.json").playlists.map { it.kind }
    assertEquals(
      listOf(
        YtLibraryPlaylist.Kind.GENERATED, // Liked Music
        YtLibraryPlaylist.Kind.GENERATED, // Episodes for Later
        YtLibraryPlaylist.Kind.OWN,
        YtLibraryPlaylist.Kind.GENERATED, // My Supermix
        YtLibraryPlaylist.Kind.SAVED,
        YtLibraryPlaylist.Kind.SAVED, // YouTube Music's own list, saved: not a mix
        YtLibraryPlaylist.Kind.GENERATED, // a podcast
      ),
      kinds,
    )
    assertEquals(
      listOf(YtLibraryPlaylist.Kind.OWN, YtLibraryPlaylist.Kind.GENERATED, YtLibraryPlaylist.Kind.SAVED),
      page("library-playlists-continuation.json").playlists.map { it.kind },
    )
  }

  @Test
  fun followsTheContinuationToTheLastPage() {
    val first = page("library-playlists.json")
    assertTrue(first.continuation!!.startsWith("4qmFsgKl"))
    val more = page("library-playlists-continuation.json")
    assertEquals(listOf("Gym", "My Mix 1", "Old & new"), more.playlists.map { it.title })
    assertNull(more.continuation)

    val asked = mutableListOf<String>()
    val read = YtLibraryParser.read(first = { body("library-playlists.json") }) { token ->
      asked += token
      body("library-playlists-continuation.json")
    }
    assertEquals(listOf(first.continuation), asked)
    assertEquals(10, (read as YtLibraryRead.Playlists).playlists.size)
    assertEquals("Old & new", read.playlists.last().title)
  }

  @Test
  fun readsTheNewerContinuationShapeToo() {
    // YouTube Music has moved other pages' continuations to appended items ending in a token.
    val tile = """{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"Later"}]},"navigationEndpoint":
      {"browseEndpoint":{"browseId":"VLPLlater","browseEndpointContextSupportedConfigs":
      {"browseEndpointContextMusicConfig":{"pageType":"MUSIC_PAGE_TYPE_PLAYLIST"}}}}}}"""
    val more = YtLibraryParser.page(
      """{"onResponseReceivedActions":[{"appendContinuationItemsAction":{"continuationItems":[$tile,
      {"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"next"}}}}]}}]}""",
    )!!
    assertEquals(listOf("PLlater"), more.playlists.map { it.playlistId })
    assertEquals("next", more.continuation)
  }

  @Test
  fun aSignedOutAnswerAsksToSignIn() {
    val signedOut = body("library-playlists-signed-out.json")
    assertNull(YtLibraryParser.page(signedOut))
    assertTrue(YtLibraryParser.asksToSignIn(signedOut))
    assertFalse(YtLibraryParser.asksToSignIn(body("library-playlists.json")))
    assertEquals(YtLibraryRead.SignedOut, YtLibraryParser.read(first = { signedOut }) { error("no next page") })
  }

  @Test
  fun anythingElseIsUnreadable() {
    assertNull(YtLibraryParser.page("""{"contents":{}}"""))
    assertFalse(YtLibraryParser.asksToSignIn("""{"contents":{}}"""))
  }

  @Test
  fun mapsForJs() {
    val road = page("library-playlists.json").playlists[2]
    assertEquals(
      mapOf(
        "playlistId" to "PLQwVIlKxHM6rz0fDJVv_0UlXGEWf-bFys",
        "title" to "Road trip",
        "artworkUrl" to "https://yt3.ggpht.com/roadtrip=s576",
        "songCount" to 24,
        "kind" to "own",
      ),
      road.toMap(),
    )
  }
}
