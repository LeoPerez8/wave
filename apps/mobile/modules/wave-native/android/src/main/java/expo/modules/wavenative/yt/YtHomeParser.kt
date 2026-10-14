package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Something on a YT Music home shelf that Wave can play or open (Core's `YtShelfItem`). */
sealed interface YtShelfItem {
  fun toMap(): Map<String, Any?>

  data class Song(val song: YtSong) : YtShelfItem {
    override fun toMap(): Map<String, Any?> = mapOf("kind" to "song", "song" to song.toMap())
  }

  data class Album(
    /** The album's page (`MPREb_…`). */
    val browseId: String,
    val title: String,
    val artists: List<String>,
    val year: Int?,
    val artworkUrl: String?,
  ) : YtShelfItem {
    override fun toMap(): Map<String, Any?> =
      mapOf(
        "kind" to "album",
        "browseId" to browseId,
        "title" to title,
        "artists" to artists,
        "year" to year,
        "artworkUrl" to artworkUrl,
      )
  }

  data class Playlist(
    /** Without the `VL` its page's browse id adds. */
    val playlistId: String,
    val title: String,
    /** The line under the title as YouTube Music writes it ("Owner • 15M views"). */
    val credit: String?,
    val artworkUrl: String?,
  ) : YtShelfItem {
    override fun toMap(): Map<String, Any?> =
      mapOf(
        "kind" to "playlist",
        "playlistId" to playlistId,
        "title" to title,
        "credit" to credit,
        "artworkUrl" to artworkUrl,
      )
  }
}

/** A home shelf ("Quick picks", "Mixed for you"…) with what Wave can show of it. */
data class YtShelf(val title: String, val items: List<YtShelfItem>) {
  fun toMap(): Map<String, Any?> = mapOf("title" to title, "items" to items.map(YtShelfItem::toMap))
}

/** One page of the home, and the token that asks for the next. */
data class YtHomePage(val shelves: List<YtShelf>, val continuation: String?)

/**
 * Reads YouTube Music's (WEB_REMIX) home, the answer to `browse` with
 * `FEmusic_home` and its continuations. The walk follows Metrolist's
 * `HomePage` (GPL-3.0): each `musicCarouselShelfRenderer` is a shelf, whose
 * items are `musicTwoRowItemRenderer` tiles (songs, albums, playlists) or
 * `musicResponsiveListItemRenderer` song rows (Quick picks).
 *
 * Only songs, albums and playlists are read. Anything else YouTube puts on
 * its home (artists, moods, podcasts, the taste builder, banners) has no
 * place in Wave, so a shelf of only those is left out.
 */
object YtHomeParser {
  private val json = Json { ignoreUnknownKeys = true }
  private val YEAR = Regex("""^\d{4}$""")
  private val ARTIST_PAGES = setOf(
    "MUSIC_PAGE_TYPE_ARTIST",
    "MUSIC_PAGE_TYPE_LIBRARY_ARTIST",
    "MUSIC_PAGE_TYPE_USER_CHANNEL",
  )
  private const val ALBUM_PAGE = "MUSIC_PAGE_TYPE_ALBUM"
  private const val PLAYLIST_PAGE = "MUSIC_PAGE_TYPE_PLAYLIST"

  /** The shelves on [body] (a first page or a continuation); none when it's neither. */
  fun home(body: String): YtHomePage {
    val root = json.parseToJsonElement(body).obj ?: return YtHomePage(emptyList(), null)
    val list = root.path("contents", "singleColumnBrowseResultsRenderer", "tabs").arr
      ?.firstOrNull().path("tabRenderer", "content", "sectionListRenderer").obj
      ?: root.path("continuationContents", "sectionListContinuation").obj
      ?: return YtHomePage(emptyList(), null)
    val shelves = list["contents"].arr.orEmpty()
      .mapNotNull { it.path("musicCarouselShelfRenderer").obj?.let(::shelf) }
    val continuation = list["continuations"].arr?.firstOrNull()
      ?.path("nextContinuationData", "continuation").string
    return YtHomePage(shelves, continuation)
  }

  private fun shelf(shelf: JsonObject): YtShelf? {
    val title = shelf.path("header", "musicCarouselShelfBasicHeaderRenderer", "title", "runs").arr
      ?.joinToString("") { it.path("text").string.orEmpty() }?.trim()
      ?.takeIf(String::isNotEmpty) ?: return null
    val items = shelf["contents"].arr.orEmpty().mapNotNull { content ->
      content.path("musicTwoRowItemRenderer").obj?.let(::tile)
        ?: content.path("musicResponsiveListItemRenderer").obj
          ?.let(YtSearchParser::songRow)?.let(YtShelfItem::Song)
    }
    return if (items.isEmpty()) null else YtShelf(title, items)
  }

  /** A `musicTwoRowItemRenderer` tile: a song, an album or a playlist; null for anything else. */
  internal fun tile(tile: JsonObject): YtShelfItem? {
    val title = tile.path("title", "runs").arr?.firstOrNull().path("text").string
      ?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val subtitle = tile.path("subtitle", "runs").arr.orEmpty().mapNotNull { it.obj }
    val artworkUrl = tile.path("thumbnailRenderer", "musicThumbnailRenderer", "thumbnail", "thumbnails")
      .arr?.lastOrNull().path("url").string
    val endpoint = tile.path("navigationEndpoint")
    endpoint.path("watchEndpoint", "videoId").string?.let { videoId ->
      val artists = linkedArtists(subtitle).ifEmpty { return null }
      val albumRun = subtitle.firstOrNull { pageType(it.path("navigationEndpoint")) == ALBUM_PAGE }
      return YtShelfItem.Song(
        YtSong(
          videoId = videoId,
          title = title,
          artists = artists,
          album = albumRun?.get("text").string,
          albumId = albumRun?.path("navigationEndpoint", "browseEndpoint", "browseId").string,
          durationMs = null,
          artworkUrl = artworkUrl,
          explicit = tile["subtitleBadges"].arr.orEmpty().any {
            it.path("musicInlineBadgeRenderer", "icon", "iconType").string == "MUSIC_EXPLICIT_BADGE"
          },
        ),
      )
    }
    val browseId = endpoint.path("browseEndpoint", "browseId").string ?: return null
    return when (pageType(endpoint)) {
      ALBUM_PAGE -> YtShelfItem.Album(
        browseId = browseId,
        title = title,
        artists = linkedArtists(subtitle),
        year = subtitle.mapNotNull { it["text"].string?.trim() }.lastOrNull { YEAR.matches(it) }?.toInt(),
        artworkUrl = artworkUrl,
      )
      PLAYLIST_PAGE -> YtShelfItem.Playlist(
        playlistId = browseId.removePrefix("VL"),
        title = title,
        credit = subtitle.joinToString("") { it["text"].string.orEmpty() }.trim().takeIf(String::isNotEmpty),
        artworkUrl = artworkUrl,
      )
      else -> null
    }
  }

  private fun linkedArtists(runs: List<JsonObject>): List<String> =
    runs.filter { pageType(it.path("navigationEndpoint")) in ARTIST_PAGES }
      .mapNotNull { it["text"].string?.trim()?.takeIf(String::isNotEmpty) }

  /** The page type [endpoint] (a navigation endpoint) opens. */
  private fun pageType(endpoint: JsonElement?): String? =
    endpoint.path(
      "browseEndpoint", "browseEndpointContextSupportedConfigs",
      "browseEndpointContextMusicConfig", "pageType",
    ).string

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
