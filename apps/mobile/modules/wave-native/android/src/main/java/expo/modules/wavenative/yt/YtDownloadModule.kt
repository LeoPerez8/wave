package expo.modules.wavenative.yt

import android.content.Context
import android.media.MediaScannerConnection
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.wavenative.artwork.AndroidArtworkProcessor
import expo.modules.wavenative.artwork.ArtworkStore
import expo.modules.wavenative.download.DownloadFiles
import expo.modules.wavenative.scan.LibraryScanner
import expo.modules.wavenative.scan.artworkToMap
import expo.modules.wavenative.scan.trackToMap
import expo.modules.wavenative.tags.AudioTagReader
import expo.modules.wavenative.tags.DownloadTagWriter
import expo.modules.wavenative.tags.DownloadTags
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.tags.MediaRetrieverTagReader
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Optional YT Music metadata and the existing tag/publication/scanner boundary.
 * WaveSoulseek acquires and validates MP3 audio. Received tags must be checked
 * before saveDownload; no YouTube audio acquisition API remains.
 */
class YtDownloadModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: YtClient
    get() = YtClient.get(context)


  override fun definition() = ModuleDefinition {
    Name("WaveYtDownloads")



    /** The album page with browse id [browseId]: title, artists, year, cover and tracklist. */
    AsyncFunction("album") Coroutine { browseId: String ->
      coded { YtPages(client).album(browseId).toMap() }
    }

    /** What [videoId]'s watch page says: `{ albumId, lyricsBrowseId }`, either null. */
    AsyncFunction("watchSong") Coroutine { videoId: String ->
      coded {
        val song = YtPages(client).song(videoId)
        mapOf("albumId" to song.albumId, "lyricsBrowseId" to song.lyricsBrowseId)
      }
    }

    /** YT Music's lyrics at [browseId] (plain text), or null. */
    AsyncFunction("lyrics") Coroutine { browseId: String ->
      coded { YtPages(client).lyrics(browseId) }
    }

    /**
     * Tags the downloaded part file with [tags] (Core's `ytDownloadTags`) and
     * the cover at [artworkUrl], moves it to [targetPath] (or the first free
     * "Name (2).mp3") and reads it as a scan does. Resolves `{ path, track,
     * artwork }`; rejects with `ERR_YT_STORAGE` (the part file is deleted).
     */
    AsyncFunction("saveDownload") Coroutine {
        videoId: String,
        partPath: String,
        targetPath: String,
        tags: Map<String, Any?>,
        artworkUrl: String?,
      ->
      val part = File(partPath)
      try {
        val fields = DownloadTags.fromJs(tags) ?: throw IllegalArgumentException("Malformed tags: $tags")
        val cover = artworkUrl?.let { url -> withContext(Dispatchers.IO) { runCatching { fetchImage(url) }.getOrNull() } }
        withContext(Dispatchers.IO) {
          try {
            DownloadTagWriter().write(part, fields, cover)
            val saved = DownloadFiles.moveIntoPlace(part, File(targetPath))
            val (track, artwork) = singleFileScanner().index(saved)
            MediaScannerConnection.scanFile(context, arrayOf(saved.path), null, null)
            mapOf(
              "path" to saved.path,
              "track" to trackToMap(track),
              "artwork" to artwork?.let(::artworkToMap),
            )
          } catch (e: Exception) {
            part.delete()
            throw CodedException(STORAGE, "Couldn't save the download: ${e.message}", e)
          }
        }
      } finally {
      }
    }

    /** Gives up on a downloaded part file: deletes it. */
    AsyncFunction("discardDownload") { videoId: String, partPath: String ->
      File(partPath).delete()
    }

  }

  /** Runs [block], turning a [YtException] into its code and a cancellation into `ERR_YT_CANCELLED`. */
  private suspend fun <T> coded(block: suspend () -> T): T =
    try {
      block()
    } catch (e: YtException) {
      throw CodedException(e.failure.code, e.message, e.cause)
    } catch (e: CancellationException) {
      throw CodedException(CANCELLED, "Download cancelled", e)
    }

  /** The cover's bytes; throws when it isn't there or too large to be a cover. */
  private fun fetchImage(url: String): ByteArray {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = TIMEOUT_MS
      readTimeout = TIMEOUT_MS
    }
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) {
        throw IllegalStateException("HTTP ${connection.responseCode} for the cover")
      }
      val bytes = connection.inputStream.use { it.readNBytes(ArtworkStore.MAX_IMAGE_BYTES + 1) }
      check(bytes.isNotEmpty() && bytes.size <= ArtworkStore.MAX_IMAGE_BYTES) { "Not a cover" }
      return bytes
    } finally {
      connection.disconnect()
    }
  }

  /** Reads a saved download the way a scan does (same tag reader and artwork store). */
  private fun singleFileScanner() =
    LibraryScanner(
      tagReader = AudioTagReader(primary = JAudioTaggerReader(), fallback = MediaRetrieverTagReader()),
      artworkStore = ArtworkStore(File(context.filesDir, "artwork"), AndroidArtworkProcessor()),
    )

  private companion object {
    const val CANCELLED = "ERR_YT_CANCELLED"
    const val STORAGE = "ERR_YT_STORAGE"
    const val PROGRESS_INTERVAL_MS = 250L
    const val TIMEOUT_MS = 20_000
  }
}
