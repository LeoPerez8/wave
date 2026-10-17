package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A playlist on the account's YouTube Music library page (Core's `YtLibraryPlaylist`). */
data class YtLibraryPlaylist(
  /** Without the `VL` its page's browse id adds (a podcast: its show's browse id). */
  val playlistId: String,
  val title: String,
  /** The largest cover the tile lists. */
  val artworkUrl: String?,
  /** How many songs the tile says it has; null when it doesn't say. */
  val songCount: Int?,
  val kind: Kind,
) {
  /** Who the playlist comes from. */
  enum class Kind(val js: String) {
    /** The account made it (its menu can edit it). */
    OWN("own"),

    /** Saved from someone else, YouTube Music's editorial playlists included. */
    SAVED("saved"),

    /** YouTube Music makes it: Liked Music, Episodes for Later, Supermix and the mixes, podcasts. */
    GENERATED("generated"),
  }

  fun toMap(): Map<String, Any?> =
    mapOf(
      "playlistId" to playlistId,
      "title" to title,
      "artworkUrl" to artworkUrl,
      "songCount" to songCount,
      "kind" to kind.js,
    )
}

/** One page of the library's playlists, and the token for the next. */
data class YtLibraryPage(val playlists: List<YtLibraryPlaylist>, val continuation: String?)

/** The whole library read, or YouTube Music answering as to someone signed out. */
sealed interface YtLibraryRead {
  data class Playlists(val playlists: List<YtLibraryPlaylist>) : YtLibraryRead

  data object SignedOut : YtLibraryRead
}

/**
 * Reads the signed-in account's library playlists, the WEB_REMIX answer to
 * `browse` with `FEmusic_liked_playlists` and the continuations it points to.
 * The walk follows Metrolist's `LibraryPage` and ytmusicapi's
 * `get_library_playlists` (GPL-3.0 / MIT): a `gridRenderer` of
 * `musicTwoRowItemRenderer` tiles whose token is in the grid's
 * `nextContinuationData`, its next page a `gridContinuation`. The newer shape
 * other pages moved to (appended items ending in a `continuationItemRenderer`)
 * is read too. The New playlist tile, which opens no page, is left out.
 */
object YtLibraryParser {
  private val json = Json { ignoreUnknownKeys = true }
  private const val PLAYLIST_PAGE = "MUSIC_PAGE_TYPE_PLAYLIST"
  private const val PODCAST_PAGE = "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE"
  private const val PLAYLIST_BROWSE = "VL"

  /** Playlists YouTube Music makes itself: Liked Music and Episodes for Later. */
  private val AUTO_PLAYLISTS = setOf("LM", "SE")

  /** Every radio and mix id starts so (Supermix `RDTMAK5uy_`, My Mix `RDAMPL`…)… */
  private const val MIX_PREFIX = "RD"

  /** …except YouTube Music's editorial playlists, fixed lists anyone can save. */
  private const val EDITORIAL_PREFIX = "RDCLAK5uy_"

  private val SONG_COUNT = Regex("""^([\d,]+)\s+(?:songs?|tracks?)$""")

  /** Pages read at most: a library of a few thousand playlists, far past any real one. */
  const val PAGE_CAP = 100

  /**
   * The playlists on [body], a first page or a continuation, and the token for
   * the next page; null when it's neither (a sign-in prompt, something else).
   */
  fun page(body: String): YtLibraryPage? {
    val root = json.parseToJsonElement(body).obj ?: return null
    val grid = root.path("contents", "singleColumnBrowseResultsRenderer", "tabs").arr?.firstOrNull()
      .path("tabRenderer", "content", "sectionListRenderer", "contents").arr
      ?.firstNotNullOfOrNull { it.path("gridRenderer").obj }
      ?: root.path("continuationContents", "gridContinuation").obj
    val items = grid?.get("items").arr
      ?: root["onResponseReceivedActions"].arr
        ?.firstNotNullOfOrNull { it.path("appendContinuationItemsAction", "continuationItems").arr }
      ?: return null
    val continuation = grid?.get("continuations").arr?.firstOrNull()
      .path("nextContinuationData", "continuation").string
      ?: items.firstNotNullOfOrNull {
        it.path("continuationItemRenderer", "continuationEndpoint", "continuationCommand", "token").string
      }
    return YtLibraryPage(items.mapNotNull { it.path("musicTwoRowItemRenderer").obj?.let(::tile) }, continuation)
  }

  /** Whether [body] is YouTube Music asking to sign in in place of the library: the session isn't accepted. */
  fun asksToSignIn(body: String): Boolean {
    val root = json.parseToJsonElement(body).obj ?: return false
    return root.path("contents", "singleColumnBrowseResultsRenderer", "tabs").arr?.firstOrNull()
      .path("tabRenderer", "content", "sectionListRenderer", "contents").arr.orEmpty()
      .flatMap { it.path("itemSectionRenderer", "contents").arr.orEmpty() }
      .any { it.path("messageRenderer", "button", "buttonRenderer", "navigationEndpoint", "signInEndpoint") != null }
  }

  /**
   * The whole library: the page [first] answers, then each page a token
   * leads to ([next]), up to [PAGE_CAP] pages, in YouTube Music's order. An
   * answer that is neither a page nor a sign-in prompt is unreadable.
   */
  inline fun read(first: () -> String, next: (String) -> String): YtLibraryRead {
    val body = first()
    var page = page(body) ?: return if (asksToSignIn(body)) {
      YtLibraryRead.SignedOut
    } else {
      throw IllegalStateException("Not the library's playlists")
    }
    val playlists = page.playlists.toMutableList()
    val asked = mutableSetOf<String>()
    var pages = 1
    while (pages < PAGE_CAP) {
      val token = page.continuation?.takeIf(asked::add) ?: break
      page = page(next(token)) ?: throw IllegalStateException("Not a library continuation")
      playlists += page.playlists
      pages += 1
    }
    return YtLibraryRead.Playlists(playlists)
  }

  private fun tile(tile: JsonObject): YtLibraryPlaylist? {
    val endpoint = tile.path("navigationEndpoint")
    val browseId = endpoint.path("browseEndpoint", "browseId").string ?: return null
    val pageType = endpoint.path(
      "browseEndpoint", "browseEndpointContextSupportedConfigs",
      "browseEndpointContextMusicConfig", "pageType",
    ).string
    val playlistId = when (pageType) {
      PLAYLIST_PAGE -> browseId.removePrefix(PLAYLIST_BROWSE)
      PODCAST_PAGE -> browseId
      else -> return null
    }.takeIf(String::isNotEmpty) ?: return null
    val title = tile.path("title", "runs").arr?.firstOrNull().path("text").string
      ?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return YtLibraryPlaylist(
      playlistId = playlistId,
      title = title,
      artworkUrl = tile.path("thumbnailRenderer", "musicThumbnailRenderer", "thumbnail", "thumbnails")
        .arr?.lastOrNull().path("url").string,
      songCount = tile.path("subtitle", "runs").arr.orEmpty()
        .firstNotNullOfOrNull { run -> run.path("text").string?.trim()?.let(SONG_COUNT::find) }
        ?.groupValues?.get(1)?.replace(",", "")?.toIntOrNull(),
      kind = when {
        pageType == PODCAST_PAGE -> YtLibraryPlaylist.Kind.GENERATED
        playlistId in AUTO_PLAYLISTS -> YtLibraryPlaylist.Kind.GENERATED
        playlistId.startsWith(MIX_PREFIX) && !playlistId.startsWith(EDITORIAL_PREFIX) ->
          YtLibraryPlaylist.Kind.GENERATED
        editable(tile, playlistId) -> YtLibraryPlaylist.Kind.OWN
        else -> YtLibraryPlaylist.Kind.SAVED
      },
    )
  }

  /** Whether the tile's menu edits [playlistId]: only the account's own playlists have Edit. */
  private fun editable(tile: JsonObject, playlistId: String): Boolean =
    tile.path("menu", "menuRenderer", "items").arr.orEmpty().any { item ->
      val entry = item.path("menuNavigationItemRenderer")
      entry.path("navigationEndpoint", "playlistEditorEndpoint", "playlistId").string == playlistId ||
        entry.path("icon", "iconType").string == "EDIT"
    }

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
