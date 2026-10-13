package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** What a song's watch page (`next`) says about it: its album and its lyrics tab. */
data class YtWatchSong(
  /** The album's browse id (`MPREb_…`), when the song is on one. */
  val albumId: String?,
  /** The browse id of the song's lyrics (`MPLYt_…`), when YT Music has some. */
  val lyricsBrowseId: String?,
)

/**
 * Reads YouTube Music's (WEB_REMIX) `next` answer for a song and the answer
 * to browsing its lyrics, as Metrolist's `NextPage` and `YouTube.lyrics` do
 * (GPL-3.0). YT Music's lyrics are plain text.
 */
object YtWatchParser {
  private val json = Json { ignoreUnknownKeys = true }
  private const val ALBUM_PAGE = "MUSIC_PAGE_TYPE_ALBUM"
  private const val LYRICS_PAGE = "MUSIC_PAGE_TYPE_TRACK_LYRICS"

  fun song(body: String): YtWatchSong {
    val tabs = json.parseToJsonElement(body).path(
      "contents", "singleColumnMusicWatchNextResultsRenderer", "tabbedRenderer",
      "watchNextTabbedResultsRenderer", "tabs",
    ).arr.orEmpty().mapNotNull { it.path("tabRenderer").obj }
    val playing = tabs.firstOrNull()
      ?.path("content", "musicQueueRenderer", "content", "playlistPanelRenderer", "contents").arr
      ?.firstNotNullOfOrNull { it.path("playlistPanelVideoRenderer").obj }
    val albumId = playing?.path("longBylineText", "runs").arr.orEmpty()
      .firstOrNull { pageType(it) == ALBUM_PAGE }
      .path("navigationEndpoint", "browseEndpoint", "browseId").string
    val lyricsId = tabs.firstNotNullOfOrNull { tab ->
      tab.path("endpoint").takeIf { pageType(tab) == LYRICS_PAGE }
        .path("browseEndpoint", "browseId").string
    }
    return YtWatchSong(albumId, lyricsId)
  }

  /** The text of a lyrics page, or null when it has none. */
  fun lyrics(body: String): String? =
    json.parseToJsonElement(body).path("contents", "sectionListRenderer", "contents").arr.orEmpty()
      .firstNotNullOfOrNull { it.path("musicDescriptionShelfRenderer", "description", "runs").arr }
      ?.joinToString("") { it.path("text").string.orEmpty() }
      ?.takeIf { it.isNotBlank() }

  /** The page an endpoint (or a tab's endpoint, or a run's) leads to. */
  private fun pageType(element: JsonElement?): String? {
    val endpoint = element.path("navigationEndpoint") ?: element.path("endpoint") ?: element
    return endpoint.path(
      "browseEndpoint", "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType",
    ).string
  }

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
