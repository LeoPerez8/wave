package expo.modules.wavenative.yt

import com.metrolist.innertubex.models.YouTubeClient
import io.ktor.client.statement.bodyAsText

/**
 * YT Music pages beyond search: the home's shelves (Discover), an album, an
 * artist, a playlist, a song's watch page and its lyrics.
 * Requests go through [YtClient] (refused while YT Music is off, failures as a
 * [YtException]); the parsers read the answers.
 */
class YtPages(private val client: YtClient) {
  /** The album with browse id [browseId] (`MPREb_…`) and its tracklist. */
  suspend fun album(browseId: String): YtAlbum = client.request {
    val body = client.innerTube.browse(YouTubeClient.WEB_REMIX, browseId).bodyAsText()
    YtAlbumParser.album(body) ?: throw IllegalStateException("Not an album page: $browseId")
  }

  /** What [videoId]'s watch page says about it: its album and its lyrics. */
  suspend fun song(videoId: String): YtWatchSong = client.request {
    YtWatchParser.song(client.innerTube.next(YouTubeClient.WEB_REMIX, videoId).bodyAsText())
  }

  /** The lyrics at [browseId] (a watch page's lyrics tab), plain text; null when there are none. */
  suspend fun lyrics(browseId: String): String? = client.request {
    YtWatchParser.lyrics(client.innerTube.browse(YouTubeClient.WEB_REMIX, browseId).bodyAsText())
  }

  /**
   * YouTube Music's home for the session's account: its shelves, from the
   * first page and the next few YouTube Music links on to (the home loads
   * more as it's scrolled; Wave asks for them at once).
   */
  suspend fun home(): List<YtShelf> = client.request {
    val tube = client.innerTube
    var page = YtHomeParser.home(tube.browse(YouTubeClient.WEB_REMIX, HOME).bodyAsText())
    val shelves = page.shelves.toMutableList()
    for (more in 1..HOME_MORE_PAGES) {
      val next = page.continuation ?: break
      page = YtHomeParser.home(tube.browse(YouTubeClient.WEB_REMIX, continuation = next).bodyAsText())
      shelves += page.shelves
    }
    shelves
  }

  /** The artist page [browseId] (`UC…`): their top songs, albums and singles. */
  suspend fun artist(browseId: String): YtArtistPage = client.request {
    val body = client.innerTube.browse(YouTubeClient.WEB_REMIX, browseId).bodyAsText()
    YtArtistParser.page(body) ?: throw IllegalStateException("Not an artist page: $browseId")
  }

  /**
   * The playlist [playlistId] (without `VL`): its head, its first page of
   * songs and the token for the next page ([playlistMore]).
   */
  suspend fun playlist(playlistId: String): YtPlaylist = client.request {
    val body = client.innerTube.browse(YouTubeClient.WEB_REMIX, "VL$playlistId").bodyAsText()
    YtPlaylistParser.playlist(body) ?: throw IllegalStateException("Not a playlist page: $playlistId")
  }

  /** The playlist page [continuation] leads to: its songs and the token for the next. */
  suspend fun playlistMore(continuation: String): YtPlaylistMore = client.request {
    val body = client.innerTube.browse(YouTubeClient.WEB_REMIX, continuation = continuation).bodyAsText()
    YtPlaylistParser.more(body) ?: throw IllegalStateException("Not a playlist continuation")
  }

  /**
   * The first page of [videoId]'s radio (the queue YouTube Music plays after
   * it, starting with the song itself) and the token for the next page.
   */
  suspend fun songRadio(videoId: String): YtRadioPage = client.request {
    radio(videoId = videoId, playlistId = "RDAMVM$videoId", params = RADIO_PARAMS)
  }

  /**
   * The first page of the radio of the artist whose page is [browseId]
   * (`UC…`), as their page's Mix button starts it, and the token for the next.
   */
  suspend fun artistRadio(browseId: String): YtRadioPage = client.request {
    val page = client.innerTube.browse(YouTubeClient.WEB_REMIX, browseId).bodyAsText()
    val start = YtRadioParser.artistRadio(page)
      ?: throw IllegalStateException("No radio on the artist page: $browseId")
    radio(videoId = null, playlistId = start.playlistId, params = start.params ?: RADIO_PARAMS)
  }

  /** The radio page [continuation] leads to: its songs and the token for the next. */
  suspend fun radioMore(continuation: String): YtRadioPage = client.request {
    val body = client.innerTube.next(
      YouTubeClient.WEB_REMIX, videoId = null, playlistId = null, playlistSetVideoId = null,
      index = null, params = null, continuation = continuation,
    ).bodyAsText()
    YtRadioParser.page(body) ?: throw IllegalStateException("Not a radio continuation")
  }

  private suspend fun radio(videoId: String?, playlistId: String, params: String): YtRadioPage {
    val body = client.innerTube.next(
      YouTubeClient.WEB_REMIX, videoId = videoId, playlistId = playlistId, playlistSetVideoId = null,
      index = null, params = params,
    ).bodyAsText()
    return YtRadioParser.page(body) ?: throw IllegalStateException("Not a radio: $playlistId")
  }

  private companion object {
    const val HOME = "FEmusic_home"

    /** What YouTube Music's own Start radio sends with a radio's `next`. */
    const val RADIO_PARAMS = "wAEB"

    /** Continuation pages asked for after the first: enough for the home's usual dozen shelves. */
    const val HOME_MORE_PAGES = 3
  }
}
