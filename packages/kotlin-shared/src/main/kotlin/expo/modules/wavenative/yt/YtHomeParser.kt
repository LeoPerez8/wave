// The response walk in this file follows Metrolist's home page classes
// (https://github.com/MetrolistGroup/Metrolist, GNU GPL version 3, Copyright (C) Metrolist
// contributors), and is credited here as derived code (upstream revision not recorded). Modified by
// Wave from 2026-10-13 on, and conveyed under the GNU GPL version 3 (LICENSE, NOTICE.md).

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
    val releaseType: String? = null,
  ) : YtShelfItem {
    override fun toMap(): Map<String, Any?> =
      mapOf(
        "kind" to "album",
        "releaseType" to releaseType,
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

/** A home shelf of playlists and nothing else, as Home's Community playlists takes it (Core's `YtPlaylistShelf`). */
data class YtPlaylistShelf(val title: String, val playlists: List<YtCommunityPlaylist>) {
  fun toMap(): Map<String, Any?> =
    mapOf("title" to title, "playlists" to playlists.map(YtCommunityPlaylist::toMap))
}

/** The playlist shelves of one page of the home, and the token that asks for the next. */
data class YtHomePlaylists(val shelves: List<YtPlaylistShelf>, val continuation: String?)

/** The home's playlist shelves as read, or YouTube Music answering as to someone signed out. */
sealed interface YtHomePlaylistsRead {
  data class Shelves(val shelves: List<YtPlaylistShelf>) : YtHomePlaylistsRead

  data object SignedOut : YtHomePlaylistsRead
}

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
 *
 * Wave asks for the account's home for one thing, Home's Community playlists
 * ([playlistShelves]), which keeps the shelves of playlists and discards the rest.
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
  /** What a playlist page's browse id adds before the playlist's id. */
  private const val PLAYLIST_BROWSE = "VL"

  /** Playlists YouTube Music makes itself: Liked Music and Episodes for Later. */
  private val AUTO_PLAYLISTS = setOf("LM", "SE")

  /** Every radio and mix id starts so (Supermix `RDTMAK5uy_`, My Mix `RDAMPL`…)… */
  private const val MIX_PREFIX = "RD"

  /** …except YouTube Music's editorial playlists, fixed lists anyone can save. */
  private const val EDITORIAL_PREFIX = "RDCLAK5uy_"

  /** Pages of the home [readPlaylistShelves] reads at most: the first and two more. */
  const val PLAYLIST_PAGES = 3

  /** The shelves on [body] (a first page or a continuation); none when it's neither. */
  fun home(body: String): YtHomePage {
    val list = sectionList(body) ?: return YtHomePage(emptyList(), null)
    val shelves = carousels(list).mapNotNull(::shelf)
    return YtHomePage(shelves, continuation(list))
  }

  /**
   * The shelves of playlists on [body] (a first page or a continuation), in
   * its order; none when it's neither. A shelf counts when every tile on it
   * opens a playlist page; one with a song, an album, an artist or anything
   * else is discarded whole. Of a shelf that counts, mixes and the playlists
   * YouTube Music makes for the account are discarded, and a shelf left with
   * nothing is too. Nothing else of the home is kept.
   */
  fun playlistShelves(body: String): YtHomePlaylists {
    val list = sectionList(body) ?: return YtHomePlaylists(emptyList(), null)
    return YtHomePlaylists(carousels(list).mapNotNull(::playlistShelf), continuation(list))
  }

  /**
   * The home's playlist shelves over its first pages: the page [first]
   * answers, then each page a token leads to ([next]), up to [pages] pages,
   * in YouTube Music's order. Any page answered as to someone signed out
   * ([answeredSignedOut]) makes it [YtHomePlaylistsRead.SignedOut]: that's
   * the anonymous home, not the account's.
   */
  inline fun readPlaylistShelves(
    first: () -> String,
    next: (String) -> String,
    pages: Int = PLAYLIST_PAGES,
  ): YtHomePlaylistsRead {
    val body = first()
    if (answeredSignedOut(body)) return YtHomePlaylistsRead.SignedOut
    var page = playlistShelves(body)
    val shelves = page.shelves.toMutableList()
    val asked = mutableSetOf<String>()
    var read = 1
    while (read < pages) {
      val token = page.continuation?.takeIf(asked::add) ?: break
      val more = next(token)
      if (answeredSignedOut(more)) return YtHomePlaylistsRead.SignedOut
      page = playlistShelves(more)
      shelves += page.shelves
      read += 1
    }
    return YtHomePlaylistsRead.Shelves(shelves)
  }

  /**
   * Whether YouTube Music says it answered [body] as to someone signed out
   * (its `responseContext` reports `logged_in` 0): asked with the account's
   * cookie, YouTube has quietly stopped accepting it. An answer that doesn't
   * say isn't taken as signed out.
   */
  fun answeredSignedOut(body: String): Boolean {
    val root = json.parseToJsonElement(body).obj ?: return false
    return root.path("responseContext", "serviceTrackingParams").arr.orEmpty()
      .flatMap { it.path("params").arr.orEmpty() }
      .any { it.path("key").string == "logged_in" && it.path("value").string == "0" }
  }

  private fun sectionList(body: String): JsonObject? {
    val root = json.parseToJsonElement(body).obj ?: return null
    return root.path("contents", "singleColumnBrowseResultsRenderer", "tabs").arr
      ?.firstOrNull().path("tabRenderer", "content", "sectionListRenderer").obj
      ?: root.path("continuationContents", "sectionListContinuation").obj
  }

  private fun carousels(list: JsonObject): List<JsonObject> =
    list["contents"].arr.orEmpty().mapNotNull { it.path("musicCarouselShelfRenderer").obj }

  private fun continuation(list: JsonObject): String? =
    list["continuations"].arr?.firstOrNull()?.path("nextContinuationData", "continuation").string

  private fun shelfTitle(shelf: JsonObject): String? =
    shelf.path("header", "musicCarouselShelfBasicHeaderRenderer", "title", "runs").arr
      ?.joinToString("") { it.path("text").string.orEmpty() }?.trim()
      ?.takeIf(String::isNotEmpty)

  private fun playlistShelf(shelf: JsonObject): YtPlaylistShelf? {
    val title = shelfTitle(shelf) ?: return null
    val tiles = shelf["contents"].arr.orEmpty().map { content ->
      content.path("musicTwoRowItemRenderer").obj
        ?.takeIf { playlistId(it["navigationEndpoint"]) != null } ?: return null
    }
    val playlists = tiles.mapNotNull(::communityPlaylist).distinctBy { it.playlistId }
    return if (playlists.isEmpty()) null else YtPlaylistShelf(title, playlists)
  }

  /** A playlist tile as a community playlist; null for a mix, Liked Music or a tile without a title. */
  private fun communityPlaylist(tile: JsonObject): YtCommunityPlaylist? {
    val playlistId = playlistId(tile["navigationEndpoint"]) ?: return null
    if (playlistId in AUTO_PLAYLISTS) return null
    if (playlistId.startsWith(MIX_PREFIX) && !playlistId.startsWith(EDITORIAL_PREFIX)) return null
    val title = tile.path("title", "runs").arr?.firstOrNull().path("text").string
      ?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return YtCommunityPlaylist(
      playlistId = playlistId,
      title = title,
      // Who made it is the linked name on the line under the title; an editorial playlist's line lists artists.
      author = linkedArtists(tile.path("subtitle", "runs").arr.orEmpty().mapNotNull { it.obj }).firstOrNull(),
      artworkUrl = tile.path("thumbnailRenderer", "musicThumbnailRenderer", "thumbnail", "thumbnails")
        .arr?.lastOrNull().path("url").string,
    )
  }

  private fun shelf(shelf: JsonObject): YtShelf? {
    val title = shelfTitle(shelf) ?: return null
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
        releaseType = subtitle.mapNotNull { it["text"].string?.trim()?.lowercase() }
          .firstOrNull { it in setOf("single", "ep", "album") },
        artists = linkedArtists(subtitle),
        year = subtitle.mapNotNull { it["text"].string?.trim() }.lastOrNull { YEAR.matches(it) }?.toInt(),
        artworkUrl = artworkUrl,
      )
      PLAYLIST_PAGE -> playlistId(endpoint)?.let { playlistId ->
        YtShelfItem.Playlist(
          playlistId = playlistId,
          title = title,
          credit = subtitle.joinToString("") { it["text"].string.orEmpty() }.trim().takeIf(String::isNotEmpty),
          artworkUrl = artworkUrl,
        )
      }
      else -> null
    }
  }

  /**
   * The playlist [endpoint] (a navigation endpoint) opens: its playlist page's
   * browse id (`VL…`) without the `VL`. Null when it opens anything else.
   */
  internal fun playlistId(endpoint: JsonElement?): String? =
    endpoint.path("browseEndpoint", "browseId").string
      ?.takeIf { pageType(endpoint) == PLAYLIST_PAGE }
      ?.removePrefix(PLAYLIST_BROWSE)?.takeIf(String::isNotEmpty)

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
