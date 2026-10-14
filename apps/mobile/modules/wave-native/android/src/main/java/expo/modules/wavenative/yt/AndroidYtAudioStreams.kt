package expo.modules.wavenative.yt

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.runBlocking

/**
 * YouTube for downloads on the phone: the process-wide resolver ([YtClient.streams]), so
 * playback and downloads share addresses and the token web view, and googlevideo over HTTP.
 * Never logs an address or its headers: they're the session's.
 */
class AndroidYtAudioStreams(context: Context) : YtAudioStreams {
  private val client = YtClient.get(context)

  override fun resolve(videoId: String): YtStream {
    // A cached address skips the resolver's own check; a download still needs YT Music on.
    if (!client.enabled) throw YtException(YtFailure.DISABLED)
    // Called from the download worker's thread, as playback's data source does.
    return runBlocking { client.streams.resolve(videoId, preferM4a = true) }
  }

  override fun reject(videoId: String) = client.streams.reject(videoId)

  override fun open(stream: YtStream, start: Long, end: Long): YtRange {
    val connection = connect(YtMediaUrls.withRange(stream.url, start, end), stream)
    val code = connection.responseCode
    if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
      connection.disconnect()
      return YtRange(code, null)
    }
    return YtRange(code, connection.inputStream)
  }

  override fun headLength(stream: YtStream): Long? {
    val connection = connect(stream.url, stream).apply { requestMethod = "HEAD" }
    return try {
      connection.contentLengthLong.takeIf { connection.responseCode == HttpURLConnection.HTTP_OK && it > 0 }
    } finally {
      connection.disconnect()
    }
  }

  /** Whether the phone has a network: without one, a broken transfer is offline, not YouTube's fault. */
  fun hasNetwork(): Boolean = client.hasNetwork()

  private fun connect(url: String, stream: YtStream): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = TIMEOUT_MS
      readTimeout = TIMEOUT_MS
      instanceFollowRedirects = true
      stream.headers.forEach(::setRequestProperty)
    }

  private companion object {
    const val TIMEOUT_MS = 20_000
  }
}

/** How long a downloaded M4A plays, read from its samples as the phone's extractor finds them. */
object AndroidM4aDuration {
  /**
   * The time of [file]'s last audio sample, in milliseconds: reading every sample through also
   * proves the container holds playable audio to its end. Throws [IOException] when it doesn't.
   */
  fun of(file: File, isCancelled: () -> Boolean = { false }): Long {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IOException("No audio track")
      extractor.selectTrack(track)
      var lastUs = -1L
      while (extractor.sampleTime >= 0) {
        if (isCancelled()) throw java.util.concurrent.CancellationException("Download cancelled")
        lastUs = maxOf(lastUs, extractor.sampleTime)
        if (!extractor.advance()) break
      }
      if (lastUs <= 0) throw IOException("No audio samples")
      return lastUs / 1000
    } catch (e: IOException) {
      throw e
    } catch (e: java.util.concurrent.CancellationException) {
      throw e
    } catch (e: Exception) {
      throw IOException("Unreadable audio", e)
    } finally {
      extractor.release()
    }
  }
}
