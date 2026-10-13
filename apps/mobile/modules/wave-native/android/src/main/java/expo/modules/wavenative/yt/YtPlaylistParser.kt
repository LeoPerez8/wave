package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A YT Music playlist page: the playlist and its songs (the first page of them). */
data class YtPlaylist(
  val title: String,
  /** Who made it ("YouTube Music" for its own mixes), when the page says. */
  val author: String?,
  /** The largest cover the page lists. */
  val artworkUrl: String?,
  val songs: List<YtSong>,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "title" to title,
      "author" to author,
      "artworkUrl" to artworkUrl,
      "songs" to songs.map(YtSong::toMap),
    )
}

/**
 * Reads YouTube Music's (WEB_REMIX) playlist pages, the answer to `browse`
 * with `VL<playlistId>`. The walk follows Metrolist's `YouTube.playlist` and
 * `PlaylistPage` (GPL-3.0): a `musicResponsiveHeaderRenderer` with the title,
 * the cover and the maker (its "facepile"), then a `musicPlaylistShelfRenderer`
 * of song rows, read as search reads them ([YtSearchParser.songRow]).
 */
object YtPlaylistParser {
  private val json = Json { ignoreUnknownKeys = true }

  /** The playlist on [body], or null when it isn't a playlist page. */
  fun playlist(body: String): YtPlaylist? {
    val root = json.parseToJsonElement(body).obj ?: return null
    val page = root.path("contents", "twoColumnBrowseResultsRenderer").obj ?: return null
    val shelf = page.path("secondaryContents", "sectionListRenderer", "contents").arr
      ?.firstNotNullOfOrNull { it.path("musicPlaylistShelfRenderer").obj } ?: return null
    val top = page["tabs"].arr?.firstOrNull()
      ?.path("tabRenderer", "content", "sectionListRenderer", "contents").arr?.firstOrNull()
    val header = top.path("musicResponsiveHeaderRenderer").obj
      ?: top.path("musicEditablePlaylistDetailHeaderRenderer", "header", "musicResponsiveHeaderRenderer").obj
      ?: return null
    val title = header.path("title", "runs").arr?.firstOrNull().path("text").string
      ?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return YtPlaylist(
      title = title,
      author = (
        header.path("facepile", "avatarStackViewModel", "text", "content").string
          ?: header.path("straplineTextOne", "runs").arr?.firstOrNull().path("text").string
        )?.trim()?.takeIf(String::isNotEmpty),
      artworkUrl = header.path("thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails").arr
        ?.lastOrNull().path("url").string,
      songs = shelf["contents"].arr.orEmpty()
        .mapNotNull { it.path("musicResponsiveListItemRenderer").obj?.let(YtSearchParser::songRow) }
        .distinctBy { it.videoId },
    )
  }

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
