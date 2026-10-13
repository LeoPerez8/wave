package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A song on a YT Music album page. */
data class YtAlbumTrack(
  val videoId: String,
  val title: String,
  /** Its own credit, else the album's. */
  val artists: List<String>,
  /** Its number on the album, when the page says. */
  val trackNumber: Int?,
  val durationMs: Long?,
  val explicit: Boolean,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "videoId" to videoId,
      "title" to title,
      "artists" to artists,
      "trackNumber" to trackNumber,
      "durationMs" to durationMs?.toDouble(),
      "explicit" to explicit,
    )
}

/** A YT Music album page: the album and its tracklist (the first page of it). */
data class YtAlbum(
  val title: String,
  /** Who the album is credited to, in order; may be empty. */
  val artists: List<String>,
  val year: Int?,
  /** The largest cover the page lists. */
  val artworkUrl: String?,
  /** The album's playlist (`OLAK5uy_…`), which plays it in order. */
  val playlistId: String?,
  val tracks: List<YtAlbumTrack>,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "title" to title,
      "artists" to artists,
      "year" to year,
      "artworkUrl" to artworkUrl,
      "playlistId" to playlistId,
      "tracks" to tracks.map(YtAlbumTrack::toMap),
    )
}

/**
 * Reads YouTube Music's (WEB_REMIX) album pages, the answer to `browse` with
 * an album's `MPREb_…` id. The walk follows Metrolist's `AlbumPage` and
 * `YouTube.album` (GPL-3.0): a `musicResponsiveHeaderRenderer` with the title,
 * the credit ("strapline") and "Album • 2013", then a shelf of numbered
 * `musicResponsiveListItemRenderer` rows.
 */
object YtAlbumParser {
  private val json = Json { ignoreUnknownKeys = true }
  private val YEAR = Regex("""^\d{4}$""")
  private val ARTIST_PAGES = setOf(
    "MUSIC_PAGE_TYPE_ARTIST",
    "MUSIC_PAGE_TYPE_LIBRARY_ARTIST",
    "MUSIC_PAGE_TYPE_USER_CHANNEL",
  )
  /** What separates names in a credit without links ("A, B & C"). */
  private val CREDIT_SEPARATORS = setOf(",", "&", "•", "and")

  /** The album on [body], or null when it isn't an album page. */
  fun album(body: String): YtAlbum? {
    val root = json.parseToJsonElement(body).obj ?: return null
    val page = root.path("contents", "twoColumnBrowseResultsRenderer").obj ?: return null
    val header = page["tabs"].arr?.firstOrNull()
      ?.path("tabRenderer", "content", "sectionListRenderer", "contents").arr
      ?.firstNotNullOfOrNull { it.path("musicResponsiveHeaderRenderer").obj }
      ?: return null
    val title = header.path("title", "runs").arr?.firstOrNull().path("text").string
      ?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val artists = credit(header.path("straplineTextOne", "runs").arr.orEmpty().mapNotNull { it.obj })
    val tracks = page.path("secondaryContents", "sectionListRenderer", "contents").arr.orEmpty()
      .mapNotNull { it.path("musicShelfRenderer").obj }
      .flatMap { it["contents"].arr.orEmpty() }
      .mapNotNull { it.path("musicResponsiveListItemRenderer").obj?.let { row -> track(row, artists) } }
    return YtAlbum(
      title = title,
      artists = artists,
      year = header.path("subtitle", "runs").arr.orEmpty()
        .mapNotNull { it.path("text").string?.trim() }
        .lastOrNull { YEAR.matches(it) }?.toInt(),
      artworkUrl = header.path("thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails").arr
        ?.lastOrNull().path("url").string,
      playlistId = root.path("microformat", "microformatDataRenderer", "urlCanonical").string
        ?.substringAfter("list=", "")?.takeIf(String::isNotEmpty),
      tracks = tracks,
    )
  }

  private fun track(row: JsonObject, albumArtists: List<String>): YtAlbumTrack? {
    val columns = row["flexColumns"].arr.orEmpty().map {
      it.path("musicResponsiveListItemFlexColumnRenderer", "text", "runs").arr.orEmpty().mapNotNull { run -> run.obj }
    }
    val titleRun = columns.firstOrNull()?.firstOrNull() ?: return null
    val title = titleRun["text"].string?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val videoId = row.path("playlistItemData", "videoId").string
      ?: titleRun.path("navigationEndpoint", "watchEndpoint", "videoId").string
      ?: return null
    val artists = columns.getOrNull(1).orEmpty()
      .filter { pageType(it) in ARTIST_PAGES }
      .mapNotNull { it["text"].string?.trim()?.takeIf(String::isNotEmpty) }
    return YtAlbumTrack(
      videoId = videoId,
      title = title,
      artists = artists.ifEmpty { albumArtists },
      trackNumber = row.path("index", "runs").arr?.firstOrNull().path("text").string?.trim()?.toIntOrNull(),
      durationMs = row["fixedColumns"].arr?.firstOrNull()
        ?.path("musicResponsiveListItemFixedColumnRenderer", "text", "runs").arr?.firstOrNull()
        .path("text").string?.let(YtSearchParser::durationMs),
      explicit = row["badges"].arr.orEmpty().any {
        it.path("musicInlineBadgeRenderer", "icon", "iconType").string == "MUSIC_EXPLICIT_BADGE"
      },
    )
  }

  /** The names in a credit: the linked artists, else the text split at its separators. */
  private fun credit(runs: List<JsonObject>): List<String> {
    val linked = runs.filter { pageType(it) in ARTIST_PAGES }.mapNotNull { it["text"].string?.trim() }
    if (linked.isNotEmpty()) return linked.filter(String::isNotEmpty)
    return runs.mapNotNull { it["text"].string?.trim() }
      .filter { it.isNotEmpty() && it !in CREDIT_SEPARATORS }
  }

  private fun pageType(run: JsonObject): String? =
    run.path(
      "navigationEndpoint", "browseEndpoint", "browseEndpointContextSupportedConfigs",
      "browseEndpointContextMusicConfig", "pageType",
    ).string

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
