package dev.leoperez.wave.stdio

import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.yt.YtClient
import expo.modules.wavenative.yt.ytHttpClient
import java.io.File
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The shared Kotlin as the desktop's JVM serves it over [host]: each method answers what the
 * phone's module answers JS for the same call, and fails with the same codes.
 *
 * - `search` `{query}`: YouTube Music's Songs search, its first page (`YtSearchPage.toMap`).
 * - `readTags` `{path}`: an audio file's tags (`RawTags.toMap`).
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

  suspend fun handle(method: String, params: JsonObject): JsonElement =
    when (method) {
      "search" -> jsonOf(yt.searchSongs(params.string("query")).toMap())
      "readTags" -> jsonOf(tags.read(File(params.string("path"))).toMap())
      else -> throw CodedError("ERR_UNKNOWN_METHOD", "No method $method")
    }

  private fun JsonObject.string(name: String): String =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
      ?: throw CodedError("ERR_BAD_PARAMS", "$name must be a string")
}
