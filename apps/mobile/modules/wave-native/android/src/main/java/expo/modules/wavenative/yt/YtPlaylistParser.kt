package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A YT Music playlist: its head and its songs, in YouTube Music's order. */
data class YtPlaylist(
  val title: String,
  /** Who made it ("YouTube Music" for its own mixes), when the page says. */
  val author: String?,
  /** The largest cover the page lists. */
  val artworkUrl: String?,
  val songs: List<YtSong>,
  /** The playlist goes on past [songs]: the read stopped at its cap ([YtPlaylistParser.read]). */
  val truncated: Boolean = false,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "title" to title,
      "author" to author,
      "artworkUrl" to artworkUrl,
      "songs" to songs.map(YtSong::toMap),
      "truncated" to truncated,
    )
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
  /** The most songs a read keeps (the spec's cap): fifty full pages. */
  const val MAX_SONGS = 5_000

  /**
   * The most pages a read asks for, the first included. YouTube Music sends a
   * hundred rows a page, so this leaves room for rows Wave leaves out while
   * keeping a playlist whose pages never end from reading forever.
   */
  const val MAX_PAGES = 100

  private val json = Json { ignoreUnknownKeys = true }

  /** The playlist on [body] with the songs on that page, or null when it isn't a playlist page. */
  fun playlist(body: String): YtPlaylist? = firstPage(body)?.first

  /**
   * The whole playlist whose first page is [first], following its
   * continuations through [next] (a continuation token to its answer) until
   * the last page, [maxSongs] songs or [maxPages] pages; null when [first]
   * isn't a playlist page. Songs YouTube Music greys out (removed, blocked in
   * the country) are left out, and a song listed twice is kept once. A page
   * that fails, or an answer that isn't the next page, fails the whole read:
   * it never ends early looking complete.
   */
  suspend fun read(
    first: String,
    maxSongs: Int = MAX_SONGS,
    maxPages: Int = MAX_PAGES,
    next: suspend (continuation: String) -> String,
  ): YtPlaylist? {
    val (head, firstNext) = firstPage(first) ?: return null
    val songs = LinkedHashMap<String, YtSong>()
    fun keep(page: List<YtSong>) = page.forEach { songs.putIfAbsent(it.videoId, it) }
    keep(head.songs)
    var continuation = firstNext
    var pages = 1
    while (continuation != null && songs.size < maxSongs && pages < maxPages) {
      val items = continuationItems(next(continuation))
        ?: throw IllegalStateException("Not a playlist continuation")
      keep(songs(items))
      continuation = continuationOf(items)
      pages++
    }
    return head.copy(
      songs = songs.values.take(maxSongs),
      truncated = continuation != null || songs.size > maxSongs,
    )
  }

  /** The playlist on a first page, and the token for its next page. */
  private fun firstPage(body: String): Pair<YtPlaylist, String?>? {
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
    val playlist = YtPlaylist(
      title = title,
      author = (
        header.path("facepile", "avatarStackViewModel", "text", "content").string
          ?: header.path("straplineTextOne", "runs").arr?.firstOrNull().path("text").string
        )?.trim()?.takeIf(String::isNotEmpty),
      artworkUrl = header.path("thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails").arr
        ?.lastOrNull().path("url").string,
      songs = songs(items).distinctBy { it.videoId },
    )
    return playlist to continuationOf(items)
  }

  /** The items of a continuation answer, or null when [body] isn't one. */
  private fun continuationItems(body: String): JsonArray? =
    json.parseToJsonElement(body).path("onResponseReceivedActions").arr
      ?.firstNotNullOfOrNull { it.path("appendContinuationItemsAction", "continuationItems").arr }

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
