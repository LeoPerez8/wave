package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real WEB_REMIX answers to `browse` of `FEmusic_home` (signed out: the first
 * page and the continuation it points to) and of `FEmusic_explore` (the same
 * carousels, with albums, chart rows and music videos), trimmed to a few
 * items per shelf (`fixtures/yt`).
 */
class YtHomeParserTest {
  private fun home(name: String) = YtHomeParser.home(Fixtures.file("yt/$name").readText())

  @Test
  fun readsTheShelvesInOrderAndTheNextPage() {
    val page = home("home-signed-out.json")
    assertEquals(listOf("Trending community playlists", "Quick picks"), page.shelves.map { it.title })
    assertTrue("a token for the next page", page.continuation!!.isNotEmpty())
  }

  @Test
  fun readsPlaylistTiles() {
    val playlist = home("home-signed-out.json").shelves[0].items[0] as YtShelfItem.Playlist
    assertEquals("PLGRY1G015gD0Wn9cQuJqHwyrikKyPb7dZ", playlist.playlistId)
    assertEquals("2000's", playlist.title)
    assertEquals("Casa de Rodapé 🐱 • 15M views", playlist.credit)
    assertTrue(playlist.artworkUrl!!.endsWith("=s576"))
  }

  @Test
  fun readsQuickPicksAsSongs() {
    val songs = home("home-signed-out.json").shelves[1].items.map { (it as YtShelfItem.Song).song }
    assertEquals(listOf("FV_SqGu4IzE", "V-uIp-WuD60", "nBrZRV37Zfw"), songs.map { it.videoId })
    val first = songs[0]
    assertEquals("Amor Factura", first.title)
    assertEquals(listOf("Ricardo Arjona", "Grupo Firme"), first.artists)
    assertEquals("Amor Factura", first.album)
    assertEquals("MPREb_QIX6ZSIenDm", first.albumId)
    assertNull("a play count isn't a length", first.durationMs)
    assertTrue(first.artworkUrl!!.startsWith("https://"))
  }

  @Test
  fun leavesOutShelvesWaveDoesntShow() {
    // The taste builder ("pick artists you like") is a prompt, not recommendations.
    val titles = home("home-signed-out.json").shelves.map { it.title }
    assertTrue(titles.none { it.isEmpty() })
    // Moods are buttons and podcast episodes aren't songs: those shelves have nothing to show.
    assertEquals(
      listOf("New albums & singles", "Trending", "New music videos"),
      home("explore-shelves.json").shelves.map { it.title },
    )
  }

  @Test
  fun readsAlbumTiles() {
    val album = home("explore-shelves.json").shelves[0].items[0] as YtShelfItem.Album
    assertEquals("MPREb_g3H4u5nW8xD", album.browseId)
    assertEquals("Rey Vaqueiro - Ao Vivo em Belém do Pará", album.title)
    assertEquals(listOf("Rey Vaqueiro"), album.artists)
    assertNull(album.year)
    assertTrue(album.artworkUrl!!.contains("w544-h544"))
  }

  @Test
  fun readsSongTilesWithTheirArtists() {
    val song = (home("explore-shelves.json").shelves[2].items[1] as YtShelfItem.Song).song
    assertEquals("La4g9CSXvus", song.videoId)
    assertEquals("PARADIXE", song.title)
    assertEquals(listOf("El Americano 4KT", "Feid"), song.artists)
    assertNull(song.album)
    assertTrue(song.artworkUrl!!.startsWith("https://"))
  }

  @Test
  fun readsAContinuationPage() {
    val page = home("home-continuation.json")
    assertEquals(listOf("Calm tunes", "Throwbacks"), page.shelves.map { it.title })
    val relax = page.shelves[0].items[1] as YtShelfItem.Playlist
    assertEquals("RDCLAK5uy_m6NvYpXUfCq6apREWwehPCDLji5YxnagQ", relax.playlistId)
    assertEquals("Relax FM", relax.title)
  }

  @Test
  fun anythingElseIsAnEmptyHome() {
    val page = YtHomeParser.home("""{"contents":{}}""")
    assertEquals(emptyList<YtShelf>(), page.shelves)
    assertNull(page.continuation)
  }
}
