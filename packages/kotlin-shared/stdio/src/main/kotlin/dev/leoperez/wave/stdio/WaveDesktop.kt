package dev.leoperez.wave.stdio

import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.yt.YtClient
import expo.modules.wavenative.yt.YtException
import expo.modules.wavenative.yt.YtFailure
import expo.modules.wavenative.yt.YtPages
import expo.modules.wavenative.yt.YtRadioStart
import expo.modules.wavenative.yt.ytHttpClient
import java.io.File
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * The shared Kotlin as the desktop's JVM serves it over [host]: each method answers what the
 * phone's module answers JS for the same call, and fails with the same codes.
 *
 * - `search` `{query}`: YouTube Music's Songs search, its first page (`YtSearchPage.toMap`).
 * - `readTags` `{path}`: an audio file's tags (`RawTags.toMap`).
 * - `resolveStream` `{videoId, fresh?}`: where the audio engine fetches a YT Music song from: the
 *   address, the headers to send, its type, itag and length. `fresh` drops the address googlevideo
 *   just turned down (403/410) first. The address and headers are the session's: never logged.
 * - `setYtMusic` `{enabled}`: YT Music on or off (Settings), as the phone's `setEnabled`.
 * - `artist` `{browseId}`, `album` `{browseId}`, `searchArtists` `{query}`, `songRadio` `{videoId}`,
 *   `artistRadio` `{browseId}`, `startedRadio` `{playlistId, params?}`, `radioMore`
 *   `{continuation}` and `related` `{videoId}`: YouTube Music's pages as the phone's
 *   `WaveYtMusic` and `WaveYtDownloads` modules answer them (Discover, artist pages, the Magic
 *   Queue and Related).
 *
 * Wave's data (the YouTube session and visitor data) lives in [dataDir].
 */
class WaveDesktop(
  host: JsonLines,
  dataDir: File,
  http: YtHttp = ::ytHttpClient,
  online: () -> Boolean = ::reachesYouTube,
) {
  val yt = YtClient(DesktopYtPlatform(dataDir, host, http, online))
  private val tags = AudioTagReader(primary = JAudioTaggerReader())
  private val pages = YtPages(yt)

  suspend fun handle(method: String, params: JsonObject): JsonElement =
    when (method) {
      "search" -> jsonOf(yt.searchSongs(params.string("query")).toMap())
      "readTags" -> {
        val read = tags.read(File(params.string("path")))
        jsonOf(read.toMap() + ("artworkBase64" to read.artwork
          ?.takeIf { it.size <= 8 * 1024 * 1024 }
          ?.let { java.util.Base64.getEncoder().encodeToString(it) }))
      }
      "resolveStream" -> resolveStream(params.string("videoId"), params.flag("fresh") ?: false)
      "setYtMusic" -> {
        yt.enabled = params.flag("enabled") ?: throw CodedError("ERR_BAD_PARAMS", "enabled must be a boolean")
        JsonNull
      }
      "artist" -> jsonOf(pages.artist(params.browseId()).toMap())
      "album" -> jsonOf(pages.album(params.browseId()).toMap())
      "searchArtists" -> jsonOf(yt.searchArtists(params.string("query")).map { it.toMap() })
      "songRadio" -> jsonOf(pages.songRadio(params.videoId()).toMap())
      "artistRadio" -> jsonOf(pages.artistRadio(params.browseId()).toMap())
      "startedRadio" -> jsonOf(
        pages.startedRadio(YtRadioStart(params.string("playlistId"), params.optionalString("params"))).toMap(),
      )
      "radioMore" -> jsonOf(pages.radioMore(params.string("continuation")).toMap())
      "related" -> jsonOf(pages.related(params.videoId()).toMap())
      else -> throw CodedError("ERR_UNKNOWN_METHOD", "No method $method")
    }

  /**
   * The engine plays AAC (itag 140/141) where YouTube has it: Symphonia's MP4 reader is the one
   * the desktop's gapless handover is proven on (docs/spec-desktop.md, Audio engine).
   */
  private suspend fun resolveStream(videoId: String, fresh: Boolean): JsonElement {
    if (!VIDEO_ID.matches(videoId)) throw CodedError("ERR_BAD_PARAMS", "videoId must be a video id")
    if (!yt.enabled) throw YtException(YtFailure.DISABLED)
    if (fresh) yt.streams.reject(videoId)
    val stream = yt.streams.resolve(videoId, preferM4a = true)
    return jsonOf(
      mapOf(
        "url" to stream.url,
        "headers" to stream.headers,
        "mimeType" to stream.mimeType,
        "itag" to stream.itag,
        "contentLength" to stream.contentLength?.toDouble(),
        "expiresAtMs" to stream.expiresAtMs.toDouble(),
        "loudnessDb" to stream.loudnessDb,
      ),
    )
  }

  private fun JsonObject.flag(name: String): Boolean? =
    (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

  private fun JsonObject.string(name: String): String =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
      ?: throw CodedError("ERR_BAD_PARAMS", "$name must be a string")

  private fun JsonObject.optionalString(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

  private fun JsonObject.videoId(): String =
    string("videoId").takeIf(VIDEO_ID::matches) ?: throw CodedError("ERR_BAD_PARAMS", "videoId must be a video id")

  private fun JsonObject.browseId(): String =
    string("browseId").takeIf(BROWSE_ID::matches) ?: throw CodedError("ERR_BAD_PARAMS", "browseId must be a browse id")

  private companion object {
    val VIDEO_ID = Regex("[A-Za-z0-9_-]{11}")
    val BROWSE_ID = Regex("[A-Za-z0-9_-]{2,128}")
  }
}
