package expo.modules.wavenative.yt

import android.content.Context
import expo.modules.wavenative.download.RangeDownload
import expo.modules.wavenative.download.RangeSource
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.runBlocking

/** What was downloaded: the stream YouTube served (M4A, as it is) and its size. */
data class YtAudioFile(val itag: Int, val bitrate: Int, val mimeType: String, val bytes: Long) {
  fun toMap(): Map<String, Any?> =
    mapOf("itag" to itag, "bitrate" to bitrate, "mimeType" to mimeType, "bytes" to bytes.toDouble())
}

/**
 * Downloads a YT Music song's audio as YouTube serves it, without
 * re-encoding: the best M4A (AAC) stream the account gets, 256 kbps (itag
 * 141) with Premium, 128 kbps (itag 140) without. M4A takes every tag a
 * download gets; YouTube's Opus streams come in WebM, which doesn't.
 *
 * The audio is fetched in ranges into a part file ([RangeDownload]); an
 * address YouTube stops accepting (403/410) is resolved again and the
 * download goes on from where it was.
 */
class YtAudioDownload(context: Context) {
  private val client = YtClient.get(context)
  private val resolver = YtStreamResolver(context)

  /**
   * Downloads [videoId]'s audio into [part], reporting bytes received and the
   * total. Cancelling the calling coroutine stops it; on any failure or
   * cancellation [part] is deleted.
   */
  suspend fun download(videoId: String, part: File, onProgress: (Long, Long) -> Unit): YtAudioFile {
    val job = currentCoroutineContext()[Job]
    return client.request {
      var stream = resolver.resolve(videoId, preferM4a = true)
      if (!stream.mimeType.startsWith(M4A_MIME)) throw YtException(YtFailure.FAILED)
      val length = stream.contentLength
        ?: YtMediaUrls.contentLength(stream.url)
        ?: headLength(stream)
        ?: throw IOException("YouTube didn't say how long the file is")
      var refreshes = 0
      val source = RangeSource { start, end ->
        val connection = open(stream, start, end)
        val code = connection.responseCode
        if (code == HttpURLConnection.HTTP_FORBIDDEN || code == HttpURLConnection.HTTP_GONE) {
          connection.disconnect()
          // The address expired or was refused: a fresh one carries on from here.
          if (refreshes++ < MAX_REFRESHES) stream = runBlocking { resolver.resolve(videoId, preferM4a = true) }
          throw IOException("HTTP $code for the audio")
        }
        if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
          connection.disconnect()
          throw IOException("HTTP $code for the audio")
        }
        connection.inputStream
      }
      RangeDownload().download(
        source,
        length,
        part,
        onProgress = { onProgress(it, length) },
        isCancelled = { job?.isActive == false },
      )
      YtAudioFile(stream.itag, stream.bitrate, stream.mimeType, length)
    }
  }

  private fun open(stream: YtStream, start: Long, end: Long): HttpURLConnection =
    (URL(YtMediaUrls.withRange(stream.url, start, end)).openConnection() as HttpURLConnection).apply {
      connectTimeout = TIMEOUT_MS
      readTimeout = TIMEOUT_MS
      instanceFollowRedirects = true
      stream.headers.forEach(::setRequestProperty)
    }

  /** The file's length from a HEAD request, when neither the stream nor its address says. */
  private fun headLength(stream: YtStream): Long? {
    val connection = (URL(stream.url).openConnection() as HttpURLConnection).apply {
      requestMethod = "HEAD"
      connectTimeout = TIMEOUT_MS
      readTimeout = TIMEOUT_MS
      stream.headers.forEach(::setRequestProperty)
    }
    return try {
      connection.contentLengthLong.takeIf { connection.responseCode == HttpURLConnection.HTTP_OK && it > 0 }
    } finally {
      connection.disconnect()
    }
  }

  private companion object {
    const val M4A_MIME = "audio/mp4"
    const val TIMEOUT_MS = 20_000
    /** How many fresh addresses one download may ask for. */
    const val MAX_REFRESHES = 3
  }
}
