package expo.modules.wavenative.yt

import com.metrolist.innertubex.models.YouTubeClient
import io.ktor.client.statement.bodyAsText

/**
 * YT Music pages beyond search: an album, a song's watch page and its lyrics.
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
}
