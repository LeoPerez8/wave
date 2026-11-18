package dev.leoperez.wave.stdio

import expo.modules.wavenative.download.RangeDownload
import expo.modules.wavenative.download.interruptibly
import expo.modules.wavenative.yt.YtAudioStreams
import expo.modules.wavenative.yt.YtClient
import expo.modules.wavenative.yt.YtException
import expo.modules.wavenative.yt.YtFailure
import expo.modules.wavenative.yt.YtMediaUrls
import expo.modules.wavenative.yt.YtRange
import expo.modules.wavenative.yt.YtStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * YouTube for downloads on the desktop, as `AndroidYtAudioStreams` is on the phone: the JVM's
 * resolver ([YtClient.streams]), shared with streaming, and googlevideo over HTTP. Never logs an
 * address or its headers: they're the session's.
 */
class JvmYtAudioStreams(private val client: YtClient) : YtAudioStreams {
  override fun resolve(videoId: String): YtStream {
    // A cached address skips the resolver's own check; a download still needs YT Music on.
    if (!client.enabled) throw YtException(YtFailure.DISABLED)
    // On the download step's thread; cancelling the job interrupts it, which ends the wait.
    return interruptibly { client.streams.resolve(videoId, preferM4a = true) }
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

  private fun connect(url: String, stream: YtStream): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = RangeDownload.REQUEST_TIMEOUT_MS
      readTimeout = RangeDownload.REQUEST_TIMEOUT_MS
      instanceFollowRedirects = true
      stream.headers.forEach(::setRequestProperty)
    }
}
