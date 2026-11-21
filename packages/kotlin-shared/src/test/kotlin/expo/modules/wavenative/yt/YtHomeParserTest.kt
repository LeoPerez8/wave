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
 * items per shelf (`fixtures/yt`). `home-playlists-*.json` are a newer
 * recording of the signed-out home, read for its playlist shelves.
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

  private fun playlistShelves(name: String) =
    YtHomeParser.playlistShelves(Fixtures.file("yt/$name").readText())

  // `home-playlists-*.json`: the signed-out home recorded in November 2026 (its first page and the
  // continuation it points to), three tiles a shelf, tracking and menus left out.

  @Test
  fun keepsOnlyTheShelvesOfPlaylists_recordedHome() {
    // Song mixes is a shelf of songs and the taste builder a prompt: both are discarded.
    val page = playlistShelves("home-playlists-signed-out.json")
    assertEquals(listOf("Late night classics"), page.shelves.map { it.title })
    assertTrue("a token for the next page", page.continuation!!.isNotEmpty())
    val more = playlistShelves("home-playlists-continuation.json")
    assertEquals(
      listOf("Viva a sexta-feira", "Trending community playlists", "Today's biggest hits"),
      more.shelves.map { it.title },
    )
    // The older recordings: Quick picks (songs) goes, and Explore's albums, chart songs, music
    // videos, moods and episodes give no shelf of playlists.
    assertEquals(listOf("Trending community playlists"), playlistShelves("home-signed-out.json").shelves.map { it.title })
    assertEquals(emptyList<YtPlaylistShelf>(), playlistShelves("explore-shelves.json").shelves)
  }

  @Test
  fun readsEachPlaylistWithItsAuthorAndCover_recordedHome() {
    val community = playlistShelves("home-playlists-continuation.json").shelves[1].playlists
    assertEquals(
      listOf(
        "PLGRY1G015gD0Wn9cQuJqHwyrikKyPb7dZ",
        "PL7U9M7TbUtgE1k5RY2HO6JGfZQof204xJ",
        "PL6yJF7E4GFau-_2S5j_7KSWpV1uQgMpBJ",
      ),
      community.map { it.playlistId },
    )
    val first = community[0]
    assertEquals("2000's", first.title)
    assertEquals("Casa de Rodapé 🐱", first.author)
    assertTrue(first.artworkUrl!!.endsWith("=s576"))
    assertEquals("Rayssa Mello", community[2].author)
  }

  @Test
  fun anEditorialPlaylistIsKeptWithoutAnAuthor_recordedHome() {
    val shelf = playlistShelves("home-playlists-signed-out.json").shelves.single()
    assertEquals(
      listOf("Presenting Pink Floyd", "80s and 90s Pop", "I Grew Up in the 80s"),
      shelf.playlists.map { it.title },
    )
    val first = shelf.playlists[0]
    assertEquals("RDCLAK5uy_nPN5nGhNWMuq-NC1COQ7_tMl2r5SxSgKE", first.playlistId)
    // Its line lists artists, none of them linked: nobody to credit.
    assertNull(first.author)
    assertTrue("a cover", first.artworkUrl!!.startsWith("https://"))
    // The older continuation's editorial Relax FM reads the same way.
    val relax = playlistShelves("home-continuation.json").shelves[0].playlists[1]
    assertEquals("RDCLAK5uy_m6NvYpXUfCq6apREWwehPCDLji5YxnagQ", relax.playlistId)
    assertNull(relax.author)
  }

  /** A hand-made home page of one shelf titled [title] holding [tiles] (not a recorded answer). */
  private fun handMadeHome(title: String, vararg tiles: String) =
    """{"continuationContents":{"sectionListContinuation":{"contents":[{"musicCarouselShelfRenderer":{
      "header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"runs":[{"text":"$title"}]}}},
      "contents":[${tiles.joinToString(",")}]}}]}}}"""

  private fun handMadeTile(browseId: String, pageType: String) =
    """{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"$browseId"}]},"navigationEndpoint":{
      "browseEndpoint":{"browseId":"$browseId","browseEndpointContextSupportedConfigs":{
      "browseEndpointContextMusicConfig":{"pageType":"$pageType"}}}}}}"""

  private fun handMadePlaylist(playlistId: String) = handMadeTile("VL$playlistId", "MUSIC_PAGE_TYPE_PLAYLIST")

  @Test
  fun mixesAndTheAccountsAutomaticPlaylistsAreDiscarded_handMadeRows() {
    // The fixtures are signed out, so they hold no mix: these rows follow the tile's real shape.
    val body = handMadeHome(
      "Mixed for you",
      handMadePlaylist("RDTMAK5uy_kset8DisdE7LSD4TNjEVvrKRTmG7a56E"),
      handMadePlaylist("PLkept"),
      handMadePlaylist("LM"),
      handMadePlaylist("RDAMPLPLsomething"),
      handMadePlaylist("PLkept"),
    )
    assertEquals(listOf("PLkept"), YtHomeParser.playlistShelves(body).shelves.single().playlists.map { it.playlistId })
    // A shelf of mixes alone leaves nothing to show.
    val mixes = handMadeHome("Mixed for you", handMadePlaylist("RDTMAK5uy_kset8DisdE7LSD4TNjEVvrKRTmG7a56E"))
    assertEquals(emptyList<YtPlaylistShelf>(), YtHomeParser.playlistShelves(mixes).shelves)
  }

  @Test
  fun aShelfThatMixesPlaylistsWithAnythingElseIsDiscarded_handMadeRows() {
    val body = handMadeHome(
      "Listen again",
      handMadePlaylist("PLmine"),
      handMadeTile("MPREb_album", "MUSIC_PAGE_TYPE_ALBUM"),
      handMadeTile("UCartist", "MUSIC_PAGE_TYPE_ARTIST"),
    )
    assertEquals(emptyList<YtPlaylistShelf>(), YtHomeParser.playlistShelves(body).shelves)
  }

  @Test
  fun readsTheFirstPagesOfTheHomeAndNoFurther() {
    val first = Fixtures.file("yt/home-playlists-signed-out.json").readText()
    val more = Fixtures.file("yt/home-playlists-continuation.json").readText()
    val asked = mutableListOf<String>()
    val shelves = shelvesOf(YtHomeParser.readPlaylistShelves({ first }, { token -> asked += token; more }, pages = 2))
    assertEquals(
      listOf("Late night classics", "Viva a sexta-feira", "Trending community playlists", "Today's biggest hits"),
      shelves.map { it.title },
    )
    assertEquals(listOf(YtHomeParser.home(first).continuation), asked)
    // Left to itself it stops after the first page and two more, however many the home has.
    var continuations = 0
    val endless = { """{"continuationContents":{"sectionListContinuation":{"contents":[],
      "continuations":[{"nextContinuationData":{"continuation":"token${continuations++}"}}]}}}""" }
    YtHomeParser.readPlaylistShelves({ first }, { endless() })
    assertEquals(2, continuations)
    val onePage = shelvesOf(YtHomeParser.readPlaylistShelves({ first }, { error("no second page is asked") }, pages = 1))
    assertEquals(listOf("Late night classics"), onePage.map { it.title })
  }

  private fun shelvesOf(read: YtHomePlaylistsRead): List<YtPlaylistShelf> =
    (read as YtHomePlaylistsRead.Shelves).shelves

  /**
   * [body] with the `responseContext` YouTube Music sends, saying whether it answered as to
   * someone signed in ([loggedIn]). The `home-playlists-*` fixtures were trimmed of it; this is
   * its shape in a signed-out `FEmusic_home` answer recorded on 2026-11-21 (and its continuation's).
   */
  private fun answered(body: String, loggedIn: Boolean) =
    """{"responseContext":{"serviceTrackingParams":[{"service":"GFEEDBACK","params":[
      {"key":"browse_id","value":"FEmusic_home"},{"key":"browse_id_prefix","value":""},
      {"key":"logged_in","value":"${if (loggedIn) 1 else 0}"}]}]},""" + body.trim().removePrefix("{")

  @Test
  fun aHomeAnsweredAsToSomeoneSignedOutIsNoReadOfTheAccount_recordedHome() {
    // YouTube stopped taking the cookie: it answers with the anonymous home, which isn't the account's.
    val first = Fixtures.file("yt/home-playlists-signed-out.json").readText()
    val more = Fixtures.file("yt/home-playlists-continuation.json").readText()
    assertEquals(
      YtHomePlaylistsRead.SignedOut,
      YtHomeParser.readPlaylistShelves({ answered(first, loggedIn = false) }, { error("no second page is asked") }),
    )
    // A continuation answered signed out spoils the read too.
    assertEquals(
      YtHomePlaylistsRead.SignedOut,
      YtHomeParser.readPlaylistShelves({ answered(first, loggedIn = true) }, { answered(more, loggedIn = false) }),
    )
    // Answered signed in, it's the account's home.
    val read = YtHomeParser.readPlaylistShelves(
      { answered(first, loggedIn = true) },
      { answered(more, loggedIn = true) },
      pages = 2,
    )
    assertEquals(
      listOf("Late night classics", "Viva a sexta-feira", "Trending community playlists", "Today's biggest hits"),
      shelvesOf(read).map { it.title },
    )
  }

  @Test
  fun anythingElseIsAnEmptyHome() {
    val page = YtHomeParser.home("""{"contents":{}}""")
    assertEquals(emptyList<YtShelf>(), page.shelves)
    assertNull(page.continuation)
  }
}
