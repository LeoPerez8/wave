package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A song YT Music found (the glossary's "YT Music song"). */
data class YtSong(
  val videoId: String,
  val title: String,
  /** As YT Music credits them, in order; never empty. */
  val artists: List<String>,
  val album: String?,
  /** The album's browse id (`MPREb_…`), which opens its tracklist. */
  val albumId: String?,
  val durationMs: Long?,
  /** The largest cover YT Music lists for the row. */
  val artworkUrl: String?,
  val explicit: Boolean,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "videoId" to videoId,
      "title" to title,
      "artists" to artists,
      "album" to album,
      "albumId" to albumId,
      "durationMs" to durationMs?.toDouble(),
      "artworkUrl" to artworkUrl,
      "explicit" to explicit,
    )
}

/** One page of song results, and the token that asks for the next. */
data class YtSearchPage(val songs: List<YtSong>, val continuation: String?) {
  fun toMap(): Map<String, Any?> =
    mapOf("songs" to songs.map(YtSong::toMap), "continuation" to continuation)
}

/**
 * Reads YouTube Music's (WEB_REMIX) search answers into songs and albums.
 * innertubex only sends the request; the walk over the renderer tree follows
 * Metrolist's `SearchPage`/`PageHelper` (GPL-3.0), simplified to the "Songs"
 * and "Albums" filters.
 *
 * A song row is a `musicResponsiveListItemRenderer`: the first flex column is
 * the title, the second is "Artist, Artist & Artist • Album • 3:45", with the
 * artists and the album linked to their pages. An album row links to the
 * album's page, and its second column is "Album • Artist & Artist • 2011"
 * ("Single", "EP" for those).
 */
object YtSearchParser {
  private val json = Json { ignoreUnknownKeys = true }
  private val DURATION = Regex("""^\d{1,2}[:.,]\d{2}(?:[:.,]\d{2})?$""")
  private val ARTIST_PAGES = setOf(
    "MUSIC_PAGE_TYPE_ARTIST",
    "MUSIC_PAGE_TYPE_LIBRARY_ARTIST",
    "MUSIC_PAGE_TYPE_USER_CHANNEL",
  )
  private const val ALBUM_PAGE = "MUSIC_PAGE_TYPE_ALBUM"
  private const val SEPARATOR = " • "
  private val YEAR = Regex("""^\d{4}$""")

  /** The songs of a search answer, first page or continuation. Unreadable rows are skipped. */
  fun songs(body: String): YtSearchPage {
    val root = json.parseToJsonElement(body).obj ?: return YtSearchPage(emptyList(), null)
    val shelves = root.path("contents", "tabbedSearchResultsRenderer", "tabs").arr
      ?.firstOrNull()?.path("tabRenderer", "content", "sectionListRenderer", "contents").arr
      ?.mapNotNull { it.path("musicShelfRenderer").obj }
      ?: listOfNotNull(root.path("continuationContents", "musicShelfContinuation").obj)
    val songs = shelves
      .flatMap { it["contents"].arr.orEmpty() }
      .mapNotNull { it.path("musicResponsiveListItemRenderer").obj?.let(::songRow) }
      .distinctBy { it.videoId }
    val continuation = shelves.firstNotNullOfOrNull { shelf ->
      shelf["continuations"].arr?.firstOrNull()?.path("nextContinuationData", "continuation").string
    }
    return YtSearchPage(songs, continuation)
  }

  /** The albums (singles and EPs among them) of an Albums search answer, in its order. Unreadable rows are skipped. */
  fun albums(body: String): List<YtShelfItem.Album> {
    val root = json.parseToJsonElement(body).obj ?: return emptyList()
    return root.path("contents", "tabbedSearchResultsRenderer", "tabs").arr
      ?.firstOrNull()?.path("tabRenderer", "content", "sectionListRenderer", "contents").arr.orEmpty()
      .mapNotNull { it.path("musicShelfRenderer").obj }
      .flatMap { it["contents"].arr.orEmpty() }
      .mapNotNull { it.path("musicResponsiveListItemRenderer").obj?.let(::albumRow) }
      .distinctBy { it.browseId }
  }

  /** An Albums search row (`musicResponsiveListItemRenderer` linking to an album page), or null. */
  private fun albumRow(row: JsonObject): YtShelfItem.Album? {
    if (pageType(row) != ALBUM_PAGE) return null
    val browseId = row.path("navigationEndpoint", "browseEndpoint", "browseId").string
      ?.takeIf(String::isNotEmpty) ?: return null
    val columns = row["flexColumns"].arr.orEmpty().map {
      it.path("musicResponsiveListItemFlexColumnRenderer", "text", "runs").arr.orEmpty()
        .mapNotNull { run -> run.obj }
    }
    val title = columns.firstOrNull()?.joinToString("") { it["text"].string.orEmpty() }?.trim()
      ?.takeIf(String::isNotEmpty) ?: return null
    val details = columns.getOrNull(1).orEmpty()
    val texts = details.mapNotNull { it["text"].string?.trim() }
    // Unlinked, the credit is the line's second part, after the release's type.
    val artists = details.filter { pageType(it) in ARTIST_PAGES || isChannelLink(it) }
      .mapNotNull { it["text"].string?.trim()?.takeIf(String::isNotEmpty) }
      .ifEmpty {
        details.joinToString("") { it["text"].string.orEmpty() }.split(SEPARATOR).getOrNull(1)?.trim()
          ?.takeIf { it.isNotEmpty() && !YEAR.matches(it) }?.let(::listOf).orEmpty()
      }
    return YtShelfItem.Album(
      browseId = browseId,
      title = title,
      artists = artists,
      year = texts.lastOrNull { YEAR.matches(it) }?.toInt(),
      artworkUrl = row.path("thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails").arr
        ?.lastOrNull()?.path("url").string,
    )
  }

  /** "3:45", "1:02:03" or with "." / "," (some locales) in milliseconds; null for anything else. */
  fun durationMs(text: String): Long? {
    val trimmed = text.trim()
    if (!DURATION.matches(trimmed)) return null
    return trimmed.split(':', '.', ',').fold(0L) { total, part -> total * 60 + part.toLong() } * 1000
  }

  /**
   * A song row (`musicResponsiveListItemRenderer`), as search, the home's
   * Quick picks and playlists list them; null when it isn't a song. The length
   * is in the second line (search) or a fixed column of its own (playlists).
   */
  fun songRow(row: JsonObject): YtSong? {
    val columns = row["flexColumns"].arr.orEmpty().map {
      it.path("musicResponsiveListItemFlexColumnRenderer", "text", "runs").arr.orEmpty()
        .mapNotNull { run -> run.obj }
    }
    val titleRun = columns.firstOrNull()?.firstOrNull() ?: return null
    val title = titleRun["text"].string?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val videoId = row.path("playlistItemData", "videoId").string
      ?: titleRun.path("navigationEndpoint", "watchEndpoint", "videoId").string
      ?: return null
    val details = columns.drop(1).flatten()
    val artists = details.filter { pageType(it) in ARTIST_PAGES || isChannelLink(it) }
      .mapNotNull { it["text"].string?.trim()?.takeIf(String::isNotEmpty) }
      .ifEmpty { unlinkedArtists(columns.getOrNull(1).orEmpty()) }
      .ifEmpty { return null }
    val albumRun = details.firstOrNull { pageType(it) == ALBUM_PAGE }
    return YtSong(
      videoId = videoId,
      title = title,
      artists = artists,
      album = albumRun?.get("text").string,
      albumId = albumRun?.path("navigationEndpoint", "browseEndpoint", "browseId").string,
      durationMs = details.firstNotNullOfOrNull { run -> run["text"].string?.let(::durationMs) }
        ?: row["fixedColumns"].arr?.firstOrNull()
          ?.path("musicResponsiveListItemFixedColumnRenderer", "text", "runs").arr?.firstOrNull()
          .path("text").string?.let(::durationMs),
      artworkUrl = row.path("thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails").arr
        ?.lastOrNull()?.path("url").string,
      explicit = row["badges"].arr.orEmpty().any {
        it.path("musicInlineBadgeRenderer", "icon", "iconType").string == "MUSIC_EXPLICIT_BADGE"
      },
    )
  }

  /** Without links, the credit is the line's first part ("Artist • Album • 3:45"). */
  private fun unlinkedArtists(runs: List<JsonObject>): List<String> {
    val line = runs.joinToString("") { it["text"].string.orEmpty() }
    val credit = line.substringBefore(SEPARATOR).trim()
    return if (credit.isEmpty() || durationMs(credit) != null) emptyList() else listOf(credit)
  }

  private fun pageType(run: JsonObject): String? =
    run.path(
      "navigationEndpoint", "browseEndpoint", "browseEndpointContextSupportedConfigs",
      "browseEndpointContextMusicConfig", "pageType",
    ).string

  private fun isChannelLink(run: JsonObject): Boolean =
    pageType(run) == null &&
      run.path("navigationEndpoint", "browseEndpoint", "browseId").string?.startsWith("UC") == true

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
