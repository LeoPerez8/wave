package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** An artist YT Music's Artists search found (Core's `YtArtistCandidate`). */
data class YtArtistCandidate(
  val name: String,
  /** The artist's page (`UC…`). */
  val browseId: String,
  /** Subscribers or monthly audience, whichever the row shows; null when it shows neither. */
  val audience: Long?,
) {
  fun toMap(): Map<String, Any?> =
    mapOf("name" to name, "browseId" to browseId, "audience" to audience?.toDouble())
}

/** A YT Music artist page as far as Wave reads it (Core's `YtArtistPage`). */
data class YtArtistPage(
  val name: String,
  /** The page's top songs, in its order. */
  val songs: List<YtSong>,
  val albums: List<YtShelfItem.Album>,
  /** Singles and EPs. */
  val singles: List<YtShelfItem.Album>,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "name" to name,
      "songs" to songs.map(YtSong::toMap),
      "albums" to albums.map(YtShelfItem.Album::toMap),
      "singles" to singles.map(YtShelfItem.Album::toMap),
    )
}

/**
 * Reads YouTube Music's (WEB_REMIX) Artists search and artist pages (`browse`
 * with the artist's `UC…` id). The walk follows Metrolist's `ArtistPage`
 * (GPL-3.0): the header names the artist, the first `musicShelfRenderer` is
 * the top songs (song rows, read as search reads them), and the
 * `musicCarouselShelfRenderer`s titled "Albums" and "Singles…" hold album
 * tiles (read as the home reads them). Videos, playlists, live performances
 * and related artists have no place in Wave and are left out. YT Music is
 * asked in English ([YtClient]), so shelves are told apart by their titles.
 */
object YtArtistParser {
  private val json = Json { ignoreUnknownKeys = true }
  private val AUDIENCE = Regex("""^(\d+(?:\.\d+)?)\s*([KMB])?\s+(?:subscribers?|monthly audience|monthly listeners)\b""")
  private const val ARTIST_PAGE = "MUSIC_PAGE_TYPE_ARTIST"
  private const val ALBUMS = "Albums"
  private const val SINGLES = "Singles"
  private const val SEPARATOR = " • "

  /** The artists of an Artists search answer, in its order. Unreadable rows are skipped. */
  fun artists(body: String): List<YtArtistCandidate> {
    val root = json.parseToJsonElement(body).obj ?: return emptyList()
    return root.path("contents", "tabbedSearchResultsRenderer", "tabs").arr
      ?.firstOrNull()?.path("tabRenderer", "content", "sectionListRenderer", "contents").arr.orEmpty()
      .mapNotNull { it.path("musicShelfRenderer").obj }
      .flatMap { it["contents"].arr.orEmpty() }
      .mapNotNull { it.path("musicResponsiveListItemRenderer").obj?.let(::artistRow) }
  }

  /** "75.1M monthly audience", "2.4K subscribers", "3 subscribers" as a number; null for anything else. */
  fun audience(text: String): Long? {
    val match = AUDIENCE.find(text.trim()) ?: return null
    val (number, unit) = match.destructured
    val scale = when (unit) {
      "K" -> 1_000.0
      "M" -> 1_000_000.0
      "B" -> 1_000_000_000.0
      else -> 1.0
    }
    return Math.round(number.toDouble() * scale)
  }

  /** The artist page in [body], or null when it isn't one. */
  fun page(body: String): YtArtistPage? {
    val root = json.parseToJsonElement(body).obj ?: return null
    val header = root["header"].obj?.let {
      it.path("musicImmersiveHeaderRenderer").obj
        ?: it.path("musicVisualHeaderRenderer").obj
        ?: it.path("musicHeaderRenderer").obj
    } ?: return null
    val name = header.path("title", "runs").arr?.joinToString("") { it.path("text").string.orEmpty() }
      ?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val sections = root.path("contents", "singleColumnBrowseResultsRenderer", "tabs").arr
      ?.firstOrNull().path("tabRenderer", "content", "sectionListRenderer", "contents").arr
      ?: return null
    val songs = sections.firstNotNullOfOrNull { it.path("musicShelfRenderer").obj }
      ?.get("contents").arr.orEmpty()
      .mapNotNull { it.path("musicResponsiveListItemRenderer").obj?.let(YtSearchParser::songRow) }
      .distinctBy { it.videoId }
    val carousels = sections.mapNotNull { it.path("musicCarouselShelfRenderer").obj }
    fun albums(title: (String) -> Boolean): List<YtShelfItem.Album> =
      carousels.firstOrNull { shelfTitle(it)?.let(title) == true }
        ?.get("contents").arr.orEmpty()
        .mapNotNull { content ->
          content.path("musicTwoRowItemRenderer").obj?.let(YtHomeParser::tile) as? YtShelfItem.Album
        }
        .map { if (it.artists.isEmpty()) it.copy(artists = listOf(name)) else it }
        .distinctBy { it.browseId }
    return YtArtistPage(
      name = name,
      songs = songs,
      albums = albums { it == ALBUMS },
      singles = albums { it.startsWith(SINGLES) },
    )
  }

  /** An Artists search row: the name, then "Artist • 75.1M monthly audience". */
  private fun artistRow(row: JsonObject): YtArtistCandidate? {
    val endpoint = row.path("navigationEndpoint", "browseEndpoint")
    val pageType = endpoint.path(
      "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType",
    ).string
    if (pageType != ARTIST_PAGE) return null
    val browseId = endpoint.path("browseId").string?.takeIf(String::isNotEmpty) ?: return null
    val columns = row["flexColumns"].arr.orEmpty().map { column ->
      column.path("musicResponsiveListItemFlexColumnRenderer", "text", "runs").arr.orEmpty()
        .joinToString("") { it.path("text").string.orEmpty() }
    }
    val name = columns.firstOrNull()?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val audience = columns.getOrNull(1)?.split(SEPARATOR)?.firstNotNullOfOrNull(::audience)
    return YtArtistCandidate(name = name, browseId = browseId, audience = audience)
  }

  private fun shelfTitle(shelf: JsonObject): String? =
    shelf.path("header", "musicCarouselShelfBasicHeaderRenderer", "title", "runs").arr
      ?.joinToString("") { it.path("text").string.orEmpty() }?.trim()

  private fun JsonElement?.path(vararg keys: String): JsonElement? =
    keys.fold(this) { element, key -> (element as? JsonObject)?.get(key) }

  private val JsonElement?.obj: JsonObject? get() = this as? JsonObject
  private val JsonElement?.arr: JsonArray? get() = this as? JsonArray
  private val JsonElement?.string: String? get() = (this as? JsonPrimitive)?.contentOrNull
}
