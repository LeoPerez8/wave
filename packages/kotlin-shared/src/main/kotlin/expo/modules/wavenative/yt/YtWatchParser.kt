package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** What a song's watch page (`next`) says about it: its album, its lyrics tab and its Related tab. */
data class YtWatchSong(
  /** The album's browse id (`MPREb_…`), when the song is on one. */
  val albumId: String?,
  /** The browse id of the song's lyrics (`MPLYt_…`), when YT Music has some. */
  val lyricsBrowseId: String?,
  /** The browse id of the song's Related tab (`MPTRt_…`), when it has one. */
  val relatedBrowseId: String? = null,
)

/**
 * A song's Related tab as Now Playing's Related view reads it: its songs
 * ("You might also like") and similar artists, each in the tab's order. Its
 * other performances of the song, playlists and "About the artist" are left out.
 */
data class YtRelated(val songs: List<YtSong>, val artists: List<YtArtistCandidate>) {
  fun toMap(): Map<String, Any?> =
    mapOf("songs" to songs.map(YtSong::toMap), "artists" to artists.map(YtArtistCandidate::toMap))
}

/**
 * Reads YouTube Music's (WEB_REMIX) `next` answer for a song and the answers
 * to browsing its lyrics and its Related tab, as Metrolist's `NextPage`,
 * `YouTube.lyrics` and `RelatedPage` do (GPL-3.0). YT Music's lyrics are
 * plain text.
 */
object YtWatchParser {
  private val json = Json { ignoreUnknownKeys = true }
  private const val ALBUM_PAGE = "MUSIC_PAGE_TYPE_ALBUM"
  private const val LYRICS_PAGE = "MUSIC_PAGE_TYPE_TRACK_LYRICS"
  private const val RELATED_PAGE = "MUSIC_PAGE_TYPE_TRACK_RELATED"

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
    fun tabId(page: String) = tabs.firstNotNullOfOrNull { tab ->
      tab.path("endpoint").takeIf { pageType(tab) == page }
        .path("browseEndpoint", "browseId").string
    }
    return YtWatchSong(albumId, tabId(LYRICS_PAGE), tabId(RELATED_PAGE))
  }

  /**
   * The songs and similar artists of a Related tab (the answer to browsing
   * [YtWatchSong.relatedBrowseId]). Its shelves are carousels titled in the
   * request's language, so they're told apart by what they hold: the songs
   * are the first carousel of song rows (later ones are other performances
   * of the song playing), the artists the first carousel of artist tiles.
   * Unreadable rows are skipped.
   */
  fun related(body: String): YtRelated {
    val carousels = json.parseToJsonElement(body).path("contents", "sectionListRenderer", "contents").arr
      .orEmpty().mapNotNull { it.path("musicCarouselShelfRenderer", "contents").arr }
    val songs = carousels.asSequence()
      .map { shelf ->
        shelf.mapNotNull { it.path("musicResponsiveListItemRenderer").obj?.let(YtSearchParser::songRow) }
      }
      .firstOrNull { it.isNotEmpty() }.orEmpty()
      .distinctBy { it.videoId }
    val artists = carousels.asSequence()
      .map { shelf -> shelf.mapNotNull { it.path("musicTwoRowItemRenderer").obj?.let(YtArtistParser::artistTile) } }
      .firstOrNull { it.isNotEmpty() }.orEmpty()
      .distinctBy { it.browseId }
    return YtRelated(songs, artists)
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
