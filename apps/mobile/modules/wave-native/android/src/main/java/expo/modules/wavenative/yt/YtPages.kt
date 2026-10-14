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

  /** The playlist [playlistId] (without `VL`) and its first page of songs. */
  suspend fun playlist(playlistId: String): YtPlaylist = client.request {
    val body = client.innerTube.browse(YouTubeClient.WEB_REMIX, "VL$playlistId").bodyAsText()
    YtPlaylistParser.playlist(body) ?: throw IllegalStateException("Not a playlist page: $playlistId")
  }

  private companion object {
    const val HOME = "FEmusic_home"

    /** Continuation pages asked for after the first: enough for the home's usual dozen shelves. */
    const val HOME_MORE_PAGES = 3
  }
}
