package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** An entry of a playlist the account made: the song's video id and the entry's own id (`setVideoId`). */
data class YtOwnEntry(val videoId: String, val setVideoId: String) {
  fun toMap(): Map<String, Any?> = mapOf("videoId" to videoId, "setVideoId" to setVideoId)
}

/** A playlist the account made: who sees it (null when its page didn't say) and its entries. */
data class YtOwnPlaylist(val privacy: String?, val entries: List<YtOwnEntry>) {
  fun toMap(): Map<String, Any?> = mapOf("privacy" to privacy, "entries" to entries.map(YtOwnEntry::toMap))
}

/**
 * One page of a playlist as its owner sees it: whether they can edit it, who
 * sees it (`PRIVATE`, `UNLISTED` or `PUBLIC`, from the first page's editable
 * header; null when it doesn't say), its entries, and the next page's token.
 */
data class YtOwnPage(
  val editable: Boolean,
  val entries: List<YtOwnEntry>,
  val continuation: String?,
  val privacy: String? = null,
)

/**
 * Reads a playlist page (`browse` with `VL<playlistId>`, and its
 * continuations) for what editing it needs, as ytmusicapi's
 * `get_playlist` does (MIT): every row's `playlistItemData` (greyed-out rows
 * too, as they still hold a place), whether the header is the editable
 * one YouTube Music only shows the playlist's owner, and the privacy that
 * header holds.
 */
object YtOwnPlaylistParser {
  private val json = Json { ignoreUnknownKeys = true }

  /** The first page [body]; null when it isn't a playlist page (a deleted playlist's answer). */
  fun page(body: String): YtOwnPage? {
    val root = json.parseToJsonElement(body).obj ?: return null
    val page = root.path("contents", "twoColumnBrowseResultsRenderer").obj ?: return null
    val top = page["tabs"].arr?.firstOrNull()
      ?.path("tabRenderer", "content", "sectionListRenderer", "contents").arr?.firstOrNull()
    val header = top.path("musicEditablePlaylistDetailHeaderRenderer").obj
    val editable = header != null
    val privacy = header.path("editHeader", "musicPlaylistEditHeaderRenderer", "privacy").string
    val items = page.path("secondaryContents", "sectionListRenderer", "contents").arr
      ?.firstNotNullOfOrNull { it.path("musicPlaylistShelfRenderer", "contents").arr }
      .orEmpty()
    return YtOwnPage(editable, entries(items), continuationOf(items), privacy)
  }

  /** A continuation page [body]: its entries and the next token; null when it isn't one. */
  fun more(body: String): YtOwnPage? {
    val items = json.parseToJsonElement(body).path("onResponseReceivedActions").arr
      ?.firstNotNullOfOrNull { it.path("appendContinuationItemsAction", "continuationItems").arr }
      ?: return null
    return YtOwnPage(true, entries(items), continuationOf(items))
  }

  private fun entries(items: List<JsonElement>): List<YtOwnEntry> =
    items.mapNotNull { item ->
      val data = item.path("musicResponsiveListItemRenderer", "playlistItemData")
      val videoId = data.path("videoId").string ?: return@mapNotNull null
      val setVideoId = data.path("playlistSetVideoId").string ?: return@mapNotNull null
      YtOwnEntry(videoId, setVideoId)
    }

  private fun continuationOf(items: List<JsonElement>): String? =
    items.firstNotNullOfOrNull {
      it.path("continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token").string
    }

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
