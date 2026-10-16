package expo.modules.wavenative.yt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A song of YouTube Music's radio, which plays music videos too. */
data class YtRadioSong(
  val song: YtSong,
  /** A music video (official, user-uploaded or lyric video) rather than a song. */
  val video: Boolean,
) {
  fun toMap(): Map<String, Any?> = song.toMap() + ("video" to video)
}

/** A page of a radio: its songs in the order it plays them, and the token for the next. */
data class YtRadioPage(val songs: List<YtRadioSong>, val continuation: String?) {
  fun toMap(): Map<String, Any?> =
    mapOf("songs" to songs.map(YtRadioSong::toMap), "continuation" to continuation)
}

/** Where an artist's radio starts: the `next` request their page's Mix button makes. */
data class YtRadioStart(val playlistId: String, val params: String?)

/**
 * Reads YouTube Music's (WEB_REMIX) radio, the queue `next` answers with for
 * a radio playlist (`RDAMVM<videoId>` for a song's, the artist page's Mix for
 * an artist's), as Metrolist's `NextResult` reads it (GPL-3.0). The queue is
 * a `playlistPanelRenderer` of `playlistPanelVideoRenderer`s, the first being
 * what the radio started from; its `nextRadioContinuationData` asks for the
 * next fifty, which come back in a `playlistPanelContinuation`.
 *
 * A queue item's byline is "Artist, Artist & Artist • Album • 2024" for a
 * song and "Artist • 13K views • 372 likes" for a video, the artists linked
 * to their pages when YouTube Music has one.
 */
object YtRadioParser {
  private val json = Json { ignoreUnknownKeys = true }
  private const val ALBUM_PAGE = "MUSIC_PAGE_TYPE_ALBUM"
  private const val SONG = "MUSIC_VIDEO_TYPE_ATV"
  private const val SEPARATOR = "•"
  private val JOINERS = setOf(",", "&", "")

  /** The radio page in [body], first or continuation; null when it isn't one. */
  fun page(body: String): YtRadioPage? {
    val root = json.parseToJsonElement(body).obj ?: return null
    val panel = root.path("continuationContents", "playlistPanelContinuation").obj
      ?: root.path(
        "contents", "singleColumnMusicWatchNextResultsRenderer", "tabbedRenderer",
        "watchNextTabbedResultsRenderer", "tabs",
      ).arr?.firstOrNull()
        .path("tabRenderer", "content", "musicQueueRenderer", "content", "playlistPanelRenderer").obj
      ?: return null
    val songs = panel["contents"].arr.orEmpty()
      .mapNotNull { it.path("playlistPanelVideoRenderer").obj?.let(::item) }
    val continuation = panel["continuations"].arr.orEmpty().firstNotNullOfOrNull {
      it.path("nextRadioContinuationData", "continuation").string
    }
    return YtRadioPage(songs, continuation)
  }

  /** Where the radio of the artist whose page is [body] starts, or null without a Mix button. */
  fun artistRadio(body: String): YtRadioStart? {
    val header = json.parseToJsonElement(body).path("header").obj ?: return null
    val endpoint = header.values.firstNotNullOfOrNull {
      it.path("startRadioButton", "buttonRenderer", "navigationEndpoint", "watchEndpoint").obj
    } ?: return null
    val playlistId = endpoint["playlistId"].string?.takeIf(String::isNotEmpty) ?: return null
    return YtRadioStart(playlistId, endpoint["params"].string)
  }

  private fun item(item: JsonObject): YtRadioSong? {
    val videoId = item["videoId"].string?.takeIf(String::isNotEmpty) ?: return null
    val title = item.path("title", "runs").arr?.joinToString("") { it.path("text").string.orEmpty() }
      ?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val byline = item.path("longBylineText", "runs").arr.orEmpty().mapNotNull { it.obj }
    val artists = byline.takeWhile { it["text"].string?.trim() != SEPARATOR }
      .mapNotNull { it["text"].string?.trim()?.takeUnless { text -> text in JOINERS } }
      .ifEmpty { return null }
    val albumRun = byline.firstOrNull { pageType(it) == ALBUM_PAGE }
    val type = item.path(
      "navigationEndpoint", "watchEndpoint", "watchEndpointMusicSupportedConfigs",
      "watchEndpointMusicConfig", "musicVideoType",
    ).string
    val song = YtSong(
      videoId = videoId,
      title = title,
      artists = artists,
      album = albumRun?.get("text").string,
      albumId = albumRun?.path("navigationEndpoint", "browseEndpoint", "browseId").string,
      durationMs = item.path("lengthText", "runs").arr?.firstOrNull().path("text").string
        ?.let(YtSearchParser::durationMs),
      artworkUrl = item.path("thumbnail", "thumbnails").arr?.lastOrNull().path("url").string,
      explicit = item["badges"].arr.orEmpty().any {
        it.path("musicInlineBadgeRenderer", "icon", "iconType").string == "MUSIC_EXPLICIT_BADGE"
      },
    )
    return YtRadioSong(song, video = type != null && type != SONG)
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
