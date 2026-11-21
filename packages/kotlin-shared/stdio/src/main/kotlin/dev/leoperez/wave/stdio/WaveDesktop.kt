package dev.leoperez.wave.stdio

import expo.modules.wavenative.lyrics.LyricsReader
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.yt.YtClient
import expo.modules.wavenative.yt.YtException
import expo.modules.wavenative.yt.YtFailure
import expo.modules.wavenative.yt.YtPlaylistWrites
import expo.modules.wavenative.yt.YtPlaylistEdit
import expo.modules.wavenative.yt.YtPages
import expo.modules.wavenative.yt.YtRadioStart
import expo.modules.wavenative.yt.YtSignInPage
import expo.modules.wavenative.yt.ytHttpClient
import java.io.File
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import expo.modules.wavenative.download.DurableDownloads
import expo.modules.wavenative.tags.AlbumPlace
import expo.modules.wavenative.tags.SongTagWriter
import expo.modules.wavenative.tags.TagWriteFailure
import expo.modules.wavenative.tags.TagWriteFile
import expo.modules.wavenative.tags.TagWriteStepException
import expo.modules.wavenative.yt.YtAudioStreams
import expo.modules.wavenative.recognize.ShazamHttp
import expo.modules.wavenative.recognize.UrlConnectionShazamHttp

/**
 * The shared Kotlin as the desktop's JVM serves it over [host]: each method answers what the
 * phone's module answers JS for the same call, and fails with the same codes.
 *
 * - `search` `{query}`: YouTube Music's Songs search, its first page (`YtSearchPage.toMap`).
 * - `readTags` `{path}`: an audio file's tags (`RawTags.toMap`), its embedded lyrics and cover.
 * - `resolveStream` `{videoId, fresh?}`: where the audio engine fetches a YT Music song from: the
 *   address, the headers to send, its type, itag and length. `fresh` drops the address googlevideo
 *   just turned down (403/410) first. The address and headers are the session's: never logged.
 * - `setYtMusic` `{enabled}`: YT Music on or off (Settings), as the phone's `setEnabled`.
 * - `tags.writeSong`: Fix Songs' tag write, the phone's `writeLyricsAndGenre`.
 * - `downloads.*`, `download.*`, `soulseek.*`: downloads ([DesktopDownloads], [downloadCall]).
 * - `artist` `{browseId}`, `album` `{browseId}`, `searchArtists` `{query}`, `searchAlbums`
 *   `{query}`, `songRadio` `{videoId}`,
 *   `artistRadio` `{browseId}`, `startedRadio` `{playlistId, params?}`, `radioMore`
 *   `{continuation}` and `related` `{videoId}`: YouTube Music's pages as the phone's
 *   `WaveYtMusic` and `WaveYtDownloads` modules answer them (Discover, artist pages, the Magic
 *   Queue and Related).
 * - `readLyrics` `{path}`: a track's lyrics as found, `{embedded, sidecar}`, either null (`LyricsReader`).
 * - `ytLyrics` `{videoId}`: YT Music's lyrics for a song (plain text), or null when it has none.
 * - `ytSignIn` `{cookie, dataSyncId?, sessionIndex?}`: signs in with what the host read from its
 *   sign-in browser, once YouTube Music says whose account it is; `ytSignOut`, `ytSession` and
 *   `ytCheckSession` are the phone's `signOut`, `getSession` and `checkSession`. Each answers
 *   Core's `YtSession`: who is signed in, never the cookie.
 * - `libraryPlaylists`: the account's YouTube Music playlists (`YtLibraryPlaylist.toMap`).
 * - `recognize.*`: Recognize over audio the host captures ([DesktopRecognize]).
 *
 * The visitor data lives in [dataDir]; the YouTube session is the host's to keep
 * ([HostSessionStore]).
 */
class WaveDesktop(
  host: JsonLines,
  dataDir: File,
  http: YtHttp = ::ytHttpClient,
  online: () -> Boolean = ::reachesYouTube,
  audioStreams: (YtClient) -> YtAudioStreams = ::JvmYtAudioStreams,
  shazam: ShazamHttp = UrlConnectionShazamHttp(),
) : java.io.Closeable {
  private val platform = DesktopYtPlatform(dataDir, host, http, online)
  val yt = YtClient(platform)
  private val tags = AudioTagReader(primary = JAudioTaggerReader())
  val downloads = DesktopDownloads(host, dataDir, yt, online, audioStreams(yt))
  private val pages = YtPages(yt)
  private val playlists = YtPlaylistWrites(yt)
  private val recognize = DesktopRecognize(host, dataDir, shazam)

  suspend fun handle(method: String, params: JsonObject): JsonElement {
    // Before anything asks YouTube: the account the host kept from the last run.
    platform.sessionStore.restore()
    return answer(method, params)
  }

  private suspend fun answer(method: String, params: JsonObject): JsonElement =
    if (method.startsWith("recognize.")) withContext(Dispatchers.IO) { recognize.call(method, params) }
    else when (method) {
      "search" -> jsonOf(yt.searchSongs(params.string("query")).toMap())
      "readTags" -> {
        val read = tags.read(File(params.string("path")))
        // Lyrics too, for Search's lyrics index; the phone reads them apart.
        jsonOf(read.toMap() + ("lyrics" to read.lyrics) + ("artworkBase64" to read.artwork
          ?.takeIf { it.size <= 8 * 1024 * 1024 }
          ?.let { java.util.Base64.getEncoder().encodeToString(it) }))
      }
      "resolveStream" -> resolveStream(params.string("videoId"), params.flag("fresh") ?: false)
      "readLyrics" -> LyricsReader(tags).read(File(params.string("path"))).let {
        jsonOf(mapOf("embedded" to it.embedded, "sidecar" to it.sidecar))
      }
      "ytLyrics" -> ytLyrics(params.string("videoId"))
      "setYtMusic" -> {
        yt.enabled = params.flag("enabled") ?: throw CodedError("ERR_BAD_PARAMS", "enabled must be a boolean")
        JsonNull
      }
      "ownPlaylist" -> jsonOf(playlists.ownPlaylist(params.string("playlistId"))?.toMap())
      "createPlaylist" -> {
        val ids = (params["videoIds"] as? JsonArray)?.map {
          (it as? JsonPrimitive)?.takeIf { value -> value.isString }?.contentOrNull?.takeIf(VIDEO_ID::matches)
            ?: throw CodedError("ERR_BAD_PARAMS", "videoIds must contain video ids")
        } ?: throw CodedError("ERR_BAD_PARAMS", "videoIds must be an array")
        val privacy = params.string("privacy").takeIf { it in YtPlaylistEdit.PRIVACIES }
          ?: throw CodedError("ERR_BAD_PARAMS", "Invalid privacy")
        JsonPrimitive(playlists.create(params.string("title"), ids, privacy))
      }
      "editPlaylist" -> {
        val edits = (params["edits"] as? JsonArray)?.map { value ->
          val fields = (value as? JsonObject)?.mapValues { (_, item) -> (item as? JsonPrimitive)?.contentOrNull }
            ?: throw CodedError("ERR_BAD_PARAMS", "Invalid playlist edit")
          YtPlaylistEdit.of(fields) ?: throw CodedError("ERR_BAD_PARAMS", "Invalid playlist edit")
        } ?: throw CodedError("ERR_BAD_PARAMS", "edits must be an array")
        playlists.edit(params.string("playlistId"), edits)
        JsonNull
      }
      "ytSignIn" -> {
        val credentials = YtSignInPage.credentials(
          params.string("cookie"), params.optionalString("dataSyncId"), params.optionalString("sessionIndex"),
        ) ?: throw YtException(YtFailure.FAILED)
        jsonOf(yt.signIn(credentials).toMap())
      }
      "ytSignOut" -> {
        yt.session.signOut()
        jsonOf(yt.session.state.toMap())
      }
      "ytSession" -> jsonOf(yt.session.state.toMap())
      "ytCheckSession" -> jsonOf(yt.checkSession().toMap())
      "libraryPlaylists" -> jsonOf(pages.libraryPlaylists().map { it.toMap() })
      "playlist" -> jsonOf(pages.playlist(params.string("playlistId")).toMap())
      "playlistMore" -> jsonOf(pages.playlistMore(params.string("continuation")).toMap())
      "tags.writeSong" -> withContext(Dispatchers.IO) { writeSong(params) }
      else -> withContext(Dispatchers.IO) { downloadCall(method, params) }
    }

  override fun close() {
    recognize.close()
    downloads.close()
  }

  /**
   * The phone's `writeLyricsAndGenre` (Fix Songs): what Core found online, written into the file's
   * tags (`TagWriteReport.toMap`), or `{failed}` with the step that failed.
   */
  private fun writeSong(params: JsonObject): JsonElement {
    val file = File(params.string("path"))
    val before = TagWriteFile.of(file)
    return try {
      jsonOf(
        SongTagWriter().write(
          file,
          params.text("lyrics"),
          params.text("genre"),
          AlbumPlace(params.int("trackNumber"), params.int("discNumber"), params.int("year")),
          params.int("advisory")?.takeIf { it == 0 || it == 1 },
        ).toMap(),
      )
    } catch (e: TagWriteStepException) {
      jsonOf(mapOf("failed" to TagWriteFailure.of(e, before).toMap()))
    }
  }

  /**
   * The phone's `WaveSoulseek` and `YtDownload` modules: the download journal (`downloads.*`),
   * YT Music's pages a download's tags come from (`download.*`) and Download in best quality
   * (`soulseek.*`). Blocking work, on the IO threads.
   */
  @Suppress("UNCHECKED_CAST")
  private suspend fun downloadCall(method: String, params: JsonObject): JsonElement {
    val jobs = downloads.jobs
    return when (method) {
      "downloads.enqueue" -> {
        val id = jobs.enqueue(
          params.map("song") ?: throw CodedError("ERR_BAD_PARAMS", "song must be an object"),
          params.text("equivalentId"),
          params.map("recording") ?: emptyMap(),
          params.text("source"),
          params.map("origin"),
        )
        downloads.changed()
        JsonPrimitive(id)
      }
      "downloads.enqueueAll" -> {
        val asked = (plainOf(params["requests"] ?: JsonNull) as? List<Map<String, Any?>> ?: emptyList()).map { request ->
          DurableDownloads.Request(
            song = request["song"] as? Map<String, Any?> ?: throw CodedError("ERR_BAD_PARAMS", "song must be an object"),
            equivalentId = request["equivalentId"] as? String,
            recording = request["recording"] as? Map<String, Any?> ?: emptyMap(),
            source = request["source"] as? String,
            origin = request["origin"] as? Map<String, Any?>,
          )
        }
        jsonOf(jobs.enqueueAll(asked).also { if (it.isNotEmpty()) downloads.changed() })
      }
      "downloads.snapshot" -> jsonOf(jobs.snapshot())
      "downloads.changes" -> jsonOf(jobs.changesSince(params.long("revision")).toMap())
      "downloads.forgetCompleted" ->
        JsonPrimitive(jobs.forgetCompleted(params.string("id"), params.long("generation")).also { if (it) downloads.changed() })
      "downloads.claim" -> jsonOf(jobs.claim(params.string("id")))
      "downloads.renew" -> JsonPrimitive(jobs.renew(params.string("id"), params.long("generation"), params.string("token")))
      "downloads.submit" -> {
        val payload = plainOf(params["payload"] ?: JsonNull) as? Map<String, Any?>
          ?: throw CodedError("ERR_BAD_PARAMS", "payload must be an object")
        JsonPrimitive(
          jobs.submit(params.string("id"), params.long("generation"), params.string("token"), params.string("decision"), payload)
            .also { downloads.changed() },
        )
      }
      "downloads.refreshPolicy" -> JsonPrimitive(jobs.refreshPolicy(params.strings("roots"), params.strings("excluded")))
      "downloads.pauseYoutube" -> { downloads.pauseYoutube(params.long("until"), params.long("level")); JsonNull }
      "downloads.youtubePause" -> jsonOf(jobs.youtubePause()?.let { mapOf("until" to it.until, "level" to it.level) })
      "downloads.cancel" -> { jobs.cancel(params.string("id"), downloads.transport); downloads.changed(); JsonNull }
      "downloads.move" -> { jobs.moveQueued(params.strings("ids")); downloads.changed(); JsonNull }
      "downloads.start" -> { downloads.start(); JsonNull }
      "downloads.stop" -> { downloads.stop(); JsonNull }
      "download.album" -> jsonOf(YtPages(yt).album(params.string("browseId")).toMap())
      "download.watchSong" -> {
        val song = YtPages(yt).song(params.string("videoId"))
        jsonOf(mapOf("albumId" to song.albumId, "lyricsBrowseId" to song.lyricsBrowseId))
      }
      "download.lyrics" -> jsonOf(YtPages(yt).lyrics(params.string("browseId")))
      "soulseek.session" -> jsonOf(downloads.soulseek.session())
      "soulseek.turnOn" -> jsonOf(downloads.soulseek.turnOn())
      "soulseek.turnOff" -> jsonOf(downloads.soulseek.turnOff())
      "soulseek.search" -> jsonOf(downloads.soulseek.search(params.string("query")).map { it.toMap() })
      "artist" -> jsonOf(pages.artist(params.browseId()).toMap())
      "album" -> jsonOf(pages.album(params.browseId()).toMap())
      "searchArtists" -> jsonOf(yt.searchArtists(params.string("query")).map { it.toMap() })
      "searchAlbums" -> jsonOf(yt.searchAlbums(params.string("query")).map { it.toMap() })
      "songRadio" -> jsonOf(pages.songRadio(params.videoId()).toMap())
      "artistRadio" -> jsonOf(pages.artistRadio(params.browseId()).toMap())
      "startedRadio" -> jsonOf(
        pages.startedRadio(YtRadioStart(params.string("playlistId"), params.optionalString("params"))).toMap(),
      )
      "radioMore" -> jsonOf(pages.radioMore(params.string("continuation")).toMap())
      "related" -> jsonOf(pages.related(params.videoId()).toMap())
      else -> throw CodedError("ERR_UNKNOWN_METHOD", "No method $method")
    }
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

  private suspend fun ytLyrics(videoId: String): JsonElement {
    if (!VIDEO_ID.matches(videoId)) throw CodedError("ERR_BAD_PARAMS", "videoId must be a video id")
    val pages = YtPages(yt)
    val browseId = pages.song(videoId).lyricsBrowseId ?: return JsonNull
    return JsonPrimitive(pages.lyrics(browseId))
  }

  private fun JsonObject.flag(name: String): Boolean? =
    (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

  private fun JsonObject.text(name: String): String? =
    (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

  private fun JsonObject.int(name: String): Int? =
    (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.toInt()

  private fun JsonObject.long(name: String): Long =
    (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.toLong()
      ?: throw CodedError("ERR_BAD_PARAMS", "$name must be a number")

  @Suppress("UNCHECKED_CAST")
  private fun JsonObject.map(name: String): Map<String, Any?>? =
    (this[name] as? JsonObject)?.let { plainOf(it) as Map<String, Any?> }

  private fun JsonObject.strings(name: String): List<String> =
    (this[name] as? JsonArray)?.map {
      (it as? JsonPrimitive)?.takeIf { item -> item.isString }?.content
        ?: throw CodedError("ERR_BAD_PARAMS", "$name must hold strings")
    } ?: throw CodedError("ERR_BAD_PARAMS", "$name must be a list")

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
