package expo.modules.wavenative.yt

import com.metrolist.innertubex.models.YouTubeClient
import io.ktor.client.statement.bodyAsText

/**
 * YT Music pages beyond search: an album, an artist, a playlist, a song's
 * watch page and its lyrics. Requests go through [YtClient] (refused while YT
 * Music is off, failures as a [YtException]); the parsers read the answers.
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

  /** The artist page [browseId] (`UC…`): their top songs, albums and singles. */
  suspend fun artist(browseId: String): YtArtistPage = client.request {
    val body = client.innerTube.browse(YouTubeClient.WEB_REMIX, browseId).bodyAsText()
    YtArtistParser.page(body) ?: throw IllegalStateException("Not an artist page: $browseId")
  }

  /**
   * The top artists of YouTube Music's charts page, in the chart's order
   * ([YtArtistParser.chartArtists]). Asked signed out, on a session of its
   * own, and without choosing a country, so YouTube Music picks one.
   */
  suspend fun chartArtists(): List<YtArtistCandidate> = client.request {
    client.signedOut { tube ->
      YtArtistParser.chartArtists(tube.browse(YouTubeClient.WEB_REMIX, CHARTS).bodyAsText())
    }
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
   * (`UC…`), as their page's Mix button starts it, the token for the next,
   * and where it started (for [startedRadio] next time).
   */
  suspend fun artistRadio(browseId: String): YtArtistRadio = client.request {
    val page = client.innerTube.browse(YouTubeClient.WEB_REMIX, browseId).bodyAsText()
    val start = YtRadioParser.artistRadio(page)
      ?: throw IllegalStateException("No radio on the artist page: $browseId")
    YtArtistRadio(startRadio(start), start)
  }

  /**
   * The first page of an artist's radio from where [artistRadio] once found
   * it starts, without reading their page; fails as [YtFailure.FAILED] when
   * YouTube Music no longer starts a radio there.
   */
  suspend fun startedRadio(start: YtRadioStart): YtRadioPage = client.request { startRadio(start) }

  private suspend fun startRadio(start: YtRadioStart): YtRadioPage =
    radio(videoId = null, playlistId = start.playlistId, params = start.params ?: RADIO_PARAMS)

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

  /**
   * The playlists in the signed-in account's library, page after page, in
   * YouTube Music's order ([YtLibraryParser]). Needs the session: signed out,
   * or with one YouTube stopped accepting (a 401 expires it; an answer as to
   * someone signed out expires it here), it fails with [YtFailure.SIGNED_OUT].
   */
  suspend fun libraryPlaylists(): List<YtLibraryPlaylist> = client.request {
    val session = client.session.state as? YtSessionState.SignedIn
      ?: throw YtException(YtFailure.SIGNED_OUT)
    val read = YtLibraryParser.read(
      first = { client.innerTube.browse(YouTubeClient.WEB_REMIX, LIBRARY_PLAYLISTS).bodyAsText() },
    ) { token -> client.innerTube.browse(YouTubeClient.WEB_REMIX, continuation = token).bodyAsText() }
    when (read) {
      is YtLibraryRead.Playlists -> read.playlists
      YtLibraryRead.SignedOut -> {
        client.session.checked(session.credentials, YtAccountMenu.SignedOut)
        throw YtException(YtFailure.SIGNED_OUT)
      }
    }
  }

  private companion object {
    /** What YouTube Music's own Start radio sends with a radio's `next`. */
    const val RADIO_PARAMS = "wAEB"

    /** The account's library page of playlists. */
    const val LIBRARY_PLAYLISTS = "FEmusic_liked_playlists"

    /** YouTube Music's charts page (not the account's home). */
    const val CHARTS = "FEmusic_charts"
  }
}
