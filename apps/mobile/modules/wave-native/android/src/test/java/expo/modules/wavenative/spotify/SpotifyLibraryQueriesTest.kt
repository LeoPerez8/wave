package expo.modules.wavenative.spotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpotifyLibraryQueriesTest {
  @Test
  fun theLibraryIsAskedForPlaylistsOnlyFlattenedWithLikedSongsFromAnOffset() {
    val (operation, variables) = SpotifyLibraryQueries.library(offset = 50)
    assertEquals("libraryV3", operation.name)
    assertEquals(
      """{"filters":["Playlists"],"order":null,"textFilter":null,"features":["LIKED_SONGS"],"limit":50,"offset":50,"flatten":true,"expandedFolders":[],"folderUri":null,"includeFoldersWhenFlattening":true}""",
      variables.toString(),
    )
  }

  @Test
  fun likedSongsAreAskedForFiftyAtATime() {
    val (operation, variables) = SpotifyLibraryQueries.likedSongs(offset = 100)
    assertEquals("fetchLibraryTracks", operation.name)
    assertEquals("""{"offset":100,"limit":50}""", variables.toString())
  }

  @Test
  fun aPlaylistIsAskedForByItsUriFiveHundredAtATime() {
    val (operation, variables) = SpotifyLibraryQueries.playlist("spotify:playlist:37i9dQZF1DX0XUsuxWHRQd", offset = 500)!!
    assertEquals("fetchPlaylist", operation.name)
    assertEquals(
      """{"uri":"spotify:playlist:37i9dQZF1DX0XUsuxWHRQd","offset":500,"limit":500,"enableWatchFeedEntrypoint":false}""",
      variables.toString(),
    )
  }

  @Test
  fun anythingButAPlaylistUriIsNotAsked() {
    assertNull(SpotifyLibraryQueries.playlist("spotify:user:someone", offset = 0))
    assertNull(SpotifyLibraryQueries.playlist("spotify:playlist:a\"b", offset = 0))
  }
}
