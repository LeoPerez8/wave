package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A YT Music playlist's first page: its head, the songs on that page in
 * YouTube Music's order, and the token for the next page.
 */
data class YtPlaylist(
  val title: String,
  /** Who made it ("YouTube Music" for its own mixes), when the page says. */
  val author: String?,
  /** The largest cover the page lists. */
  val artworkUrl: String?,
  val songs: List<YtSong>,
  /** The token for the page after this one; null when it's the last. */
  val continuation: String? = null,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "title" to title,
      "author" to author,
      "artworkUrl" to artworkUrl,
      "songs" to songs.map(YtSong::toMap),
      "continuation" to continuation,
    )
}

/** A later page of a YT Music playlist: its songs and the token for the next page. */
data class YtPlaylistMore(val songs: List<YtSong>, val continuation: String?) {
  fun toMap(): Map<String, Any?> =
    mapOf("songs" to songs.map(YtSong::toMap), "continuation" to continuation)
}

/**
 * Reads YouTube Music's (WEB_REMIX) playlist pages, the answer to `browse`
 * with `VL<playlistId>`, and the continuations they point to. The walk
 * follows Metrolist's `YouTube.playlist` and `PlaylistPage` (GPL-3.0): a
 * `musicResponsiveHeaderRenderer` with the title, the cover and the maker
 * (its "facepile"), then a `musicPlaylistShelfRenderer` of song rows, read as
 * search reads them ([YtSearchParser.songRow]). A page lists up to a hundred
 * rows; its last item, a `continuationItemRenderer`, holds the token for the
 * next, whose rows come in an `appendContinuationItemsAction`.
 */
object YtPlaylistParser {
  private val json = Json { ignoreUnknownKeys = true }

  /**
   * The playlist on the first page [body]: its head, that page's songs and
   * the token for the next page; null when it isn't a playlist page. Songs
   * YouTube Music greys out (removed, blocked in the country) are left out.
   * Following the pages, and the cap, are Core's (`readYtPlaylist`).
   */
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
    val items = shelf["contents"].arr.orEmpty()
    return YtPlaylist(
      title = title,
      author = (
        header.path("facepile", "avatarStackViewModel", "text", "content").string
          ?: header.path("straplineTextOne", "runs").arr?.firstOrNull().path("text").string
        )?.trim()?.takeIf(String::isNotEmpty),
      artworkUrl = header.path("thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails").arr
        ?.lastOrNull().path("url").string,
      songs = songs(items),
      continuation = continuationOf(items),
    )
  }

  /**
   * The page a continuation token led to ([body]): its songs, greyed-out
   * ones left out, and the token for the next page; null when [body] isn't
   * a playlist's continuation.
   */
  fun more(body: String): YtPlaylistMore? {
    val items = json.parseToJsonElement(body).path("onResponseReceivedActions").arr
      ?.firstNotNullOfOrNull { it.path("appendContinuationItemsAction", "continuationItems").arr }
      ?: return null
    return YtPlaylistMore(songs(items), continuationOf(items))
  }

  /** The playable songs among a page's [items]: greyed-out rows can't be played. */
  private fun songs(items: List<JsonElement>): List<YtSong> =
    items.mapNotNull { it.path("musicResponsiveListItemRenderer").obj }
      .filter { it["musicItemRendererDisplayPolicy"].string != GREYED_OUT }
      .mapNotNull(YtSearchParser::songRow)

  /** The token for the page after the one whose rows are [items], or null on the last. */
  private fun continuationOf(items: List<JsonElement>): String? =
    items.firstNotNullOfOrNull {
      it.path("continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token").string
    }

  private const val GREYED_OUT = "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT"

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
